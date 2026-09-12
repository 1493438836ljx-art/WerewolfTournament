// 引擎主状态机：createGame + reduce。
// 纯函数：reduce(state, action) -> { state, events }；随机性全部经 state.rngState。
// 流转：处理动作的即时效果后，advance() 持续推进直到出现 pending（等外部输入）或 game_over。
import type { Faction, Role, Seat } from "@wt/protocol";
import { Rng, seedFromString } from "./rng.js";
import { DEFAULT_CONFIG, validateConfig, type GameConfig } from "./config.js";
import {
  aliveOfRole,
  aliveSeats,
  EngineError,
  nextAliveSeat,
  seatState,
  type DawnQueueItem,
  type DeathCause,
  type EngineAction,
  type EngineEvent,
  type GameState,
  type PendingRequest,
  type ResponsePayload,
  type SeatState,
} from "./types.js";
import { checkWin } from "./win.js";
import { resolveWolfBallots, tally, weightedTally } from "./votes.js";
import { defaultAction } from "./defaults.js";

export interface CreateGameOptions {
  gameId: string;
  seed: string;
  players: Array<{ seat: Seat; agentId: string; name: string }>;
  config?: Partial<GameConfig>;
  /** 测试用：显式角色分配（seat -> role）；缺省由种子洗牌分配 */
  assignments?: Partial<Record<Seat, Role>>;
}

export interface EngineUpdate {
  state: GameState;
  events: EngineEvent[];
}

// ---------- 创建对局 ----------
export function createGame(opts: CreateGameOptions): EngineUpdate {
  const config: GameConfig = mergeConfig(opts.config);
  const errs = validateConfig(config);
  if (errs.length) throw new EngineError(errs.join("; "), "CONFIG");
  if (opts.players.length !== config.playerCount)
    throw new EngineError(`players ${opts.players.length} != playerCount ${config.playerCount}`, "CONFIG");

  const rng = new Rng(seedFromString(opts.seed));

  const rolePool: Role[] = [];
  for (const [role, n] of Object.entries(config.roleSet)) {
    for (let i = 0; i < (n ?? 0); i++) rolePool.push(role as Role);
  }
  rng.shuffle(rolePool);

  const seats: SeatState[] = opts.players.map((p, i) => {
    const role = opts.assignments?.[p.seat] ?? rolePool[i]!;
    return {
      seat: p.seat,
      agentId: p.agentId,
      name: p.name,
      role,
      faction: role === "werewolf" ? ("werewolf" as Faction) : ("village" as Faction),
      alive: true,
    };
  });

  const state: GameState = {
    gameId: opts.gameId,
    seed: opts.seed,
    config,
    seats,
    night: 0,
    day: 0,
    phase: { t: "night", no: 0 },
    pending: [],
    witchPotions: { heal: true, poison: true },
    seerChecks: [],
    votes: [],
    log: [],
    rngState: rng.snapshot(),
    penalties: {},
    disqualifications: [],
    currentKill: null,
    sheriffCandidates: [],
    collect: { wolfBallots: [], voteBallots: [] },
    nightActions: { night: 0, healUsed: false, poisonTarget: null },
  };

  const events = pushEvent(state, "game_started", {
    players: seats.map((s) => ({ seat: s.seat, name: s.name })),
  }, "public");

  startNight(state, events);
  return { state, events };
}

export function mergeConfig(partial?: Partial<GameConfig>): GameConfig {
  const d = DEFAULT_CONFIG;
  return {
    ...d,
    ...partial,
    witch: { ...d.witch, ...partial?.witch },
    hunter: { ...d.hunter, ...partial?.hunter },
    lastWords: { ...d.lastWords, ...partial?.lastWords },
    vote: { ...d.vote, ...partial?.vote },
    sheriff: { ...d.sheriff, ...partial?.sheriff },
    timeoutsMs: { ...d.timeoutsMs, ...partial?.timeoutsMs },
  };
}

// ---------- 事件工具 ----------
function pushEvent(
  s: GameState,
  kind: EngineEvent["kind"],
  payload: unknown,
  visibility: EngineEvent["visibility"],
): EngineEvent[] {
  const seq = s.log.length + 1;
  const ev: EngineEvent = { seq, kind, payload, visibility };
  s.log.push(ev);
  return [ev];
}

function rngOf(s: GameState): Rng {
  return new Rng(s.rngState);
}
function saveRng(s: GameState, r: Rng) {
  s.rngState = r.snapshot();
}

// ---------- 主入口 ----------
export function reduce(state: GameState, action: EngineAction): EngineUpdate {
  if (state.winner) throw new EngineError("game over", "GAME_OVER");
  const s: GameState = structuredClone(state);
  let events: EngineEvent[] = [];

  switch (action.t) {
    case "respond": {
      const req = takePending(s, action.seat);
      validateResponse(s, req, action.payload);
      events = applyRespond(s, req, action.payload);
      break;
    }
    case "timeout": {
      const req = takePending(s, action.seat);
      const rng = rngOf(s);
      const payload = defaultAction(req, rng);
      saveRng(s, rng);
      s.penalties[action.seat] = (s.penalties[action.seat] ?? 0) + 1;
      events = pushEvent(s, "timeout_default", { seat: action.seat, which: req.kind }, "public");
      events = [...events, ...applyRespond(s, req, payload)];
      break;
    }
    case "disqualify": {
      const st = seatState(s, action.seat);
      if (st.alive) {
        killSeat(s, action.seat, "disqualify", currentTurn(s));
        // DQ 的警长：直接撕徽（不再给行动机会）
        if (s.sheriff === action.seat) {
          s.sheriff = undefined;
          events = pushEvent(s, "sheriff_transfer", { from: action.seat, to: null }, "public");
        }
        s.disqualifications.push({ seat: action.seat, reason: action.reason });
        events = [
          ...events,
          ...pushEvent(s, "player_disqualified", { seat: action.seat, reason: action.reason }, "public"),
        ];
        s.collect.wolfBallots = s.collect.wolfBallots.filter((b) => b.voter !== action.seat);
        s.collect.voteBallots = s.collect.voteBallots.filter((b) => b.voter !== action.seat);
        s.pending = s.pending.filter((p) => p.seat !== action.seat);
        dropQueueHead(s, action.seat); // 若其正是队列当前环节，跳过
        const win = checkWin(s); // DQ 可能直接触发胜负（如刀死最后一狼）
        if (win) setWinner(s, win, events);
      }
      break;
    }
  }

  const adv = advance(s);
  return { state: s, events: [...events, ...adv.events] };
}

// ---------- pending / 队列管理 ----------
function takePending(s: GameState, seat: Seat): PendingRequest {
  const idx = s.pending.findIndex((p) => p.seat === seat);
  if (idx < 0) throw new EngineError(`座位 ${seat} 无待处理请求`, "NOT_PENDING");
  const [req] = s.pending.splice(idx, 1);
  return req!;
}

/** 队列头出队：仅当 head 属于 seat（respond 完成或 DQ 跳过） */
function dropQueueHead(s: GameState, seat: Seat) {
  const q = queueOf(s);
  if (q && q.length > 0 && queueItemSeat(q[0]!) === seat) q.shift();
}

function queueOf(s: GameState): DawnQueueItem[] | null {
  if (s.phase.t === "dawn") return s.phase.queue;
  if (s.phase.t === "day" && s.phase.step === "aftermath") return s.phase.queue ?? null;
  return null;
}

function queueItemSeat(item: DawnQueueItem): Seat {
  return item.seat;
}

// ---------- 响应校验 ----------
function validateResponse(s: GameState, req: PendingRequest, payload: ResponsePayload) {
  const isAlive = (x: Seat) => seatState(s, x).alive;
  switch (req.kind) {
    case "wolf_kill": {
      if (payload.t !== "wolf_kill") throw bad(req, payload);
      if (!req.killTargets.includes(payload.kill)) throw bad(req, payload);
      break;
    }
    case "seer_check": {
      if (payload.t !== "seer_check") throw bad(req, payload);
      if (!isAlive(payload.check)) throw bad(req, payload);
      break;
    }
    case "witch_action": {
      if (payload.t !== "witch_action") throw bad(req, payload);
      const { heal, poison } = payload;
      if (heal && (!req.healAvailable || req.killedTonight === null)) throw bad(req, payload);
      if (poison !== null && (!req.poisonAvailable || !isAlive(poison))) throw bad(req, payload);
      if (heal && poison !== null && s.config.witch.bothPotionsSameNight) throw bad(req, payload);
      if (heal && req.killedTonight === req.seat && !req.canSelfHeal) throw bad(req, payload);
      break;
    }
    case "hunter_shoot": {
      if (payload.t !== "hunter_shoot") throw bad(req, payload);
      if (payload.shoot !== null && !req.targets.includes(payload.shoot)) throw bad(req, payload);
      break;
    }
    case "speech": {
      if (payload.t !== "speech") throw bad(req, payload);
      if (payload.text.length === 0 || payload.text.length > s.config.speechCharLimit)
        throw bad(req, payload);
      break;
    }
    case "vote": {
      if (payload.t !== "vote") throw bad(req, payload);
      if (payload.target === null) {
        if (!req.abstainAllowed) throw bad(req, payload);
      } else if (!req.candidates.includes(payload.target)) throw bad(req, payload);
      break;
    }
    case "last_words": {
      if (payload.t !== "last_words") throw bad(req, payload);
      if (payload.text.length > s.config.speechCharLimit * 2) throw bad(req, payload);
      break;
    }
    case "sheriff_campaign": {
      if (payload.t !== "sheriff_campaign") throw bad(req, payload);
      break;
    }
    case "sheriff_speech": {
      if (payload.t !== "sheriff_speech") throw bad(req, payload);
      if (payload.text.length === 0 || payload.text.length > s.config.speechCharLimit) throw bad(req, payload);
      break;
    }
    case "sheriff_vote": {
      if (payload.t !== "sheriff_vote") throw bad(req, payload);
      if (payload.target === null) {
        if (!req.abstainAllowed) throw bad(req, payload);
      } else if (!req.candidates.includes(payload.target)) throw bad(req, payload);
      break;
    }
    case "sheriff_transfer": {
      if (payload.t !== "sheriff_transfer") throw bad(req, payload);
      if (payload.to !== null && !req.targets.includes(payload.to)) throw bad(req, payload);
      break;
    }
  }
}

function bad(req: PendingRequest, payload: ResponsePayload): EngineError {
  return new EngineError(`payload ${payload.t} 不匹配请求 ${req.kind} 或目标非法`, "BAD_PAYLOAD");
}

/** 供编排器预校验 agent 回复（不合法则按违规处理，而非喂给引擎） */
export function validateResponseFor(s: GameState, seat: Seat, payload: ResponsePayload): EngineError | null {
  const req = s.pending.find((p) => p.seat === seat);
  if (!req) return new EngineError(`座位 ${seat} 无待处理请求`, "NOT_PENDING");
  try {
    validateResponse(s, req, payload);
    return null;
  } catch (e) {
    return e instanceof EngineError ? e : new EngineError(String(e), "BAD_PAYLOAD");
  }
}

// ---------- 响应应用 ----------
function applyRespond(s: GameState, req: PendingRequest, payload: ResponsePayload): EngineEvent[] {
  const events: EngineEvent[] = [];
  switch (req.kind) {
    case "wolf_kill": {
      s.collect.wolfBallots.push({ voter: req.seat, kill: payload.t === "wolf_kill" ? payload.kill : null });
      const wolves = aliveOfRole(s, "werewolf").map((x) => x.seat);
      const voted = new Set(s.collect.wolfBallots.map((b) => b.voter));
      if (wolves.length > 0 && wolves.every((w) => voted.has(w))) {
        const tieBreak = Math.min(...wolves);
        s.currentKill = resolveWolfBallots(s.collect.wolfBallots, tieBreak);
        events.push(
          ...pushEvent(s, "wolf_target_locked", { night: s.night, target: s.currentKill }, { seats: wolves }),
        );
        // 女巫可动 -> 追加请求（预言家可能仍在 pending，无碍）
        const witchSeat = aliveOfRole(s, "witch")[0];
        if (witchSeat && (s.witchPotions.heal || s.witchPotions.poison)) {
          const canHeal = s.witchPotions.heal && s.currentKill !== null;
          const canSelfHeal =
            canHeal && s.currentKill === witchSeat.seat &&
            (s.night === 1 ? s.config.witch.firstNightSelfSave : !s.config.witch.selfSaveAfterFirstNight);
          s.pending.push(makeWitchRequest(s, witchSeat.seat, canHeal, canSelfHeal));
        }
      }
      break;
    }
    case "seer_check": {
      if (payload.t === "seer_check") {
        const target = seatState(s, payload.check);
        const result: "wolf" | "human" = target.role === "werewolf" ? "wolf" : "human";
        s.seerChecks.push({ night: s.night, target: payload.check, result });
        events.push(
          ...pushEvent(
            s,
            "seer_result",
            { night: s.night, seat: req.seat, target: payload.check, result },
            { seats: [req.seat] },
          ),
        );
      }
      break;
    }
    case "witch_action": {
      if (payload.t === "witch_action") {
        if (payload.heal) {
          s.witchPotions.heal = false;
          s.nightActions.healUsed = true;
          events.push(...pushEvent(s, "witch_heal_used", { night: s.night }, { seats: [req.seat] }));
        }
        if (payload.poison !== null) {
          s.witchPotions.poison = false;
          s.nightActions.poisonTarget = payload.poison;
          events.push(
            ...pushEvent(s, "witch_poison_used", { night: s.night, target: payload.poison }, { seats: [req.seat] }),
          );
        }
      }
      break;
    }
    case "hunter_shoot": {
      if (payload.t === "hunter_shoot") {
        events.push(
          ...pushEvent(s, "hunter_shot", { ...turnLabel(s), by: req.seat, target: payload.shoot }, "public"),
        );
        dropQueueHead(s, req.seat);
        if (payload.shoot !== null) {
          killSeat(s, payload.shoot, "hunter", currentTurn(s));
          const victim = seatState(s, payload.shoot);
          if (victim.role === "hunter") {
            insertQueue(s, { kind: "hunter", seat: payload.shoot, reason: "shot" });
          }
          const win = checkWin(s);
          if (win) setWinner(s, win, events);
        }
      }
      break;
    }
    case "speech": {
      if (payload.t === "speech") {
        events.push(
          ...pushEvent(
            s,
            "speech",
            {
              day: s.day,
              seat: req.seat,
              kind: req.pk ? "pk" : "speech",
              round: req.round,
              text: payload.text,
            },
            "public",
          ),
        );
        if (s.phase.t === "day") s.phase.cursor = (s.phase.cursor ?? 0) + 1;
      }
      break;
    }
    case "sheriff_campaign": {
      if (payload.t === "sheriff_campaign") {
        if (payload.run) s.sheriffCandidates.push(req.seat);
        if (s.phase.t === "day") s.phase.cursor = (s.phase.cursor ?? 0) + 1;
      }
      break;
    }
    case "sheriff_speech": {
      if (payload.t === "sheriff_speech") {
        events.push(
          ...pushEvent(
            s,
            "speech",
            { day: s.day, seat: req.seat, kind: "campaign", text: payload.text },
            "public",
          ),
        );
        if (s.phase.t === "day") s.phase.cursor = (s.phase.cursor ?? 0) + 1;
      }
      break;
    }
    case "sheriff_vote": {
      if (payload.t === "sheriff_vote") {
        s.collect.voteBallots.push({ voter: req.seat, target: payload.target });
      }
      break;
    }
    case "sheriff_transfer": {
      if (payload.t === "sheriff_transfer") {
        if (payload.to !== null && seatState(s, payload.to).alive) {
          s.sheriff = payload.to;
          events.push(...pushEvent(s, "sheriff_transfer", { from: req.seat, to: payload.to }, "public"));
        } else {
          s.sheriff = undefined;
          events.push(...pushEvent(s, "sheriff_transfer", { from: req.seat, to: null }, "public"));
        }
        dropQueueHead(s, req.seat);
      }
      break;
    }
    case "last_words": {
      if (payload.t === "last_words") {
        events.push(
          ...pushEvent(s, "last_words", { ...turnLabel(s), seat: req.seat, cause: req.cause, text: payload.text }, "public"),
        );
        dropQueueHead(s, req.seat);
        // 白天出局猎人的遗言在 queue 中位于开枪之前：遗言完成 -> 开枪环节由队列推进
      }
      break;
    }
    case "vote": {
      if (payload.t === "vote") {
        s.collect.voteBallots.push({ voter: req.seat, target: payload.target });
      }
      break;
    }
  }
  return events;
}

function makeWitchRequest(s: GameState, seat: Seat, canHeal: boolean, canSelfHeal: boolean): PendingRequest {
  return {
    kind: "witch_action",
    seat,
    alive: aliveSeats(s),
    night: s.night,
    killedTonight: s.config.witch.seesKillTarget ? s.currentKill : null,
    healAvailable: canHeal,
    poisonAvailable: s.witchPotions.poison,
    canSelfHeal,
    healBlocksPoison: true,
  };
}

// ---------- 死亡与胜负 ----------
function currentTurn(s: GameState): number {
  return s.phase.t === "day" ? s.day : s.night;
}
function turnLabel(s: GameState): { night?: number; day?: number } {
  return s.phase.t === "day" ? { day: s.day } : { night: s.night };
}

function killSeat(s: GameState, seat: Seat, cause: DeathCause, turn: number) {
  const st = seatState(s, seat);
  st.alive = false;
  st.death = { cause, turn };
  // 警长阵亡：进入警徽移交队列（DQ 由调用方处理撕徽）
  if (s.sheriff === seat && cause !== "disqualify" && s.config.sheriff.transferOnDeath) {
    insertQueue(s, { kind: "sheriff_transfer", seat });
  }
}

function setWinner(s: GameState, win: { faction: Faction; reason: string }, events: EngineEvent[]) {
  s.winner = win;
  s.phase = { t: "game_over" };
  s.pending = [];
  events.push(...pushEvent(s, "win", win, "public"));
  events.push(
    ...pushEvent(
      s,
      "reveal",
      { seats: s.seats.map((x) => ({ seat: x.seat, role: x.role, faction: x.faction })) },
      "public",
    ),
  );
}

/** 追加队列项；hunter 项插在首个 last_words 之前（枪链优先于遗言） */
function insertQueue(s: GameState, item: DawnQueueItem) {
  const q = queueOf(s);
  if (!q) return;
  if (item.kind === "hunter") {
    const idx = q.findIndex((x) => x.kind === "last_words");
    if (idx >= 0) q.splice(idx, 0, item);
    else q.push(item);
  } else {
    q.push(item);
  }
}

// ---------- 阶段推进 ----------
/**
 * 集中式推进：pending 空且未结束时持续流转，直到出现 pending 或 game_over。
 * 阶段单调推进（night→dawn→day→…→night），无回退，循环必然收敛。
 */
function advance(s: GameState): EngineUpdate {
  const events: EngineEvent[] = [];
  let guard = 0;
  while (
    !s.winner &&
    s.pending.length === 0 &&
    s.phase.t !== "game_over" &&
    guard++ < 10_000
  ) {
    const p = s.phase;
    if (p.t === "night") {
      resolveNightEnd(s, events);
    } else if (p.t === "dawn") {
      if (p.queue.length === 0) startDay(s, events);
      else enqueueHead(s, p.queue[0]!);
    } else if (p.t === "day") {
      advanceDay(s, events);
    }
  }
  return { state: s, events };
}

function enqueueHead(s: GameState, item: DawnQueueItem) {
  if (item.kind === "hunter") {
    s.pending.push({
      kind: "hunter_shoot",
      seat: item.seat,
      reason: item.reason,
      alive: aliveSeats(s),
      targets: s.seats.filter((x) => x.alive && x.seat !== item.seat).map((x) => x.seat),
    });
  } else if (item.kind === "sheriff_transfer") {
    s.pending.push({
      kind: "sheriff_transfer",
      seat: item.seat,
      targets: aliveSeats(s),
      alive: aliveSeats(s),
    });
  } else {
    s.pending.push({ kind: "last_words", seat: item.seat, cause: item.cause, alive: aliveSeats(s) });
  }
}

// ---------- 夜晚结算 ----------
function resolveNightEnd(s: GameState, events: EngineEvent[]) {
  const night = s.night;
  const kill = s.currentKill;
  const healEffective =
    s.nightActions.night === night && s.nightActions.healUsed && s.nightActions.poisonTarget !== kill;
  const poison = s.nightActions.night === night ? s.nightActions.poisonTarget : null;

  if (kill !== null && !healEffective) {
    killSeat(s, kill, poison === kill ? "poison" : "wolf", night);
  }
  if (poison !== null && seatState(s, poison).alive) killSeat(s, poison, "poison", night);

  const deaths = s.seats
    .filter((x) => !x.alive && x.death?.turn === night && (x.death.cause === "wolf" || x.death.cause === "poison"))
    .map((x) => x.seat)
    .sort((a, b) => a - b);
  events.push(...pushEvent(s, "dawn_deaths", { night, deaths }, "public"));

  const win = checkWin(s);
  if (win) {
    setWinner(s, win, events);
    return;
  }

  // 猎人（被刀可枪，被毒不可）+ 夜间遗言；枪链优先于遗言
  const queue: DawnQueueItem[] = [];
  for (const seat of deaths) {
    const st = seatState(s, seat);
    if (st.role === "hunter" && st.death?.cause === "wolf") {
      queue.push({ kind: "hunter", seat, reason: "wolf" });
    }
  }
  const nightLastWords =
    s.config.lastWords.night === "all" || (s.config.lastWords.night === "first_night_only" && night === 1);
  if (nightLastWords) {
    for (const seat of deaths) queue.push({ kind: "last_words", seat, cause: "night" });
  }
  // 警长夜间死亡：遗言后移交警徽（killSeat 时 phase=night 无队列，在此补挂）
  if (s.sheriff && deaths.includes(s.sheriff) && s.config.sheriff.transferOnDeath) {
    queue.push({ kind: "sheriff_transfer", seat: s.sheriff });
  }
  s.phase = { t: "dawn", no: night, queue };
}

// ---------- 白天 ----------
/** 生成发言顺序：从锚点起顺时针的存活序列 */
function speechOrderFrom(s: GameState, anchor: Seat): Seat[] {
  const order: Seat[] = [];
  let cur = anchor;
  const aliveCount = aliveSeats(s).length;
  for (let i = 0; i < s.config.playerCount && order.length < aliveCount; i++) {
    if (seatState(s, cur).alive && !order.includes(cur)) order.push(cur);
    cur = nextAliveSeat(s, cur);
  }
  return order;
}

/** 警长选出/无警长后进入正式发言阶段 */
function enterSpeechPhase(s: GameState) {
  // 发言起点：有警长 -> 警长下家；无 -> 死者下家 / 随机锚点
  let anchor: Seat;
  const deaths = s.seats
    .filter((x) => !x.alive && x.death?.turn === s.night && x.death.cause !== "disqualify")
    .map((x) => x.seat)
    .sort((a, b) => a - b);
  if (s.sheriff) {
    // 警长发言起点：警长的下一位存活者（严格下一位，不含警长自己）
    const n = s.config.playerCount;
    anchor = nextAliveSeat(s, ((s.sheriff % n) + 1) as Seat);
  }
  else if (deaths.length > 0) anchor = nextAliveSeat(s, deaths[0]!);
  else {
    const rng = rngOf(s);
    anchor = rng.pick(aliveSeats(s));
    saveRng(s, rng);
  }
  const order = speechOrderFrom(s, anchor);
  const p = s.phase;
  if (p.t === "day") {
    p.step = "speech";
    p.order = order;
    p.cursor = 0;
    p.speechRound = 1;
    p.voteIssued = false;
  }
}

function startDay(s: GameState, events: EngineEvent[]) {
  s.day = s.night;
  const sheriffDay = s.day === 1 && s.config.sheriff.enabled;
  s.sheriffCandidates = [];
  if (sheriffDay) {
    // 第 1 天：警长竞选（逐个询问是否上警）
    s.phase = { t: "day", no: s.day, step: "campaign_run", order: [...aliveSeats(s)], cursor: 0 };
    return;
  }
  s.phase = { t: "day", no: s.day, step: "speech" };
  enterSpeechPhase(s);
  const p = s.phase;
  if (p.t === "day" && p.order) {
    events.push(...pushEvent(s, "speech_order", { day: s.day, order: p.order }, "public"));
  }
}

function advanceDay(s: GameState, events: EngineEvent[]) {
  const p = s.phase;
  if (p.t !== "day") return;

  // ---- 警长竞选：逐个询问是否上警 ----
  if (p.step === "campaign_run") {
    const order = p.order ?? [];
    const cursor = p.cursor ?? 0;
    if (cursor < order.length && seatState(s, order[cursor]!).alive) {
      s.pending.push({
        kind: "sheriff_campaign",
        seat: order[cursor]!,
        candidates: [...s.sheriffCandidates],
        alive: aliveSeats(s),
      });
    } else if (cursor < order.length) {
      p.cursor = cursor + 1; // 已死（竞选中不会发生，防御）
    } else {
      // 上警结束
      if (s.sheriffCandidates.length === 0) {
        events.push(...pushEvent(s, "sheriff_elected", { day: p.no, seat: null }, "public"));
        enterSpeechPhase(s);
        if (p.order) events.push(...pushEvent(s, "speech_order", { day: p.no, order: p.order }, "public"));
      } else if (s.sheriffCandidates.length === 1) {
        s.sheriff = s.sheriffCandidates[0]!;
        events.push(...pushEvent(s, "sheriff_elected", { day: p.no, seat: s.sheriff }, "public"));
        enterSpeechPhase(s);
        if (p.order) events.push(...pushEvent(s, "speech_order", { day: p.no, order: p.order }, "public"));
      } else {
        p.step = "campaign_speech";
        p.cursor = 0;
      }
    }
    return;
  }

  // ---- 警长竞选：竞选发言 / PK 辩词 ----
  if (p.step === "campaign_speech" || p.step === "sheriff_pk_speech") {
    const order = p.step === "campaign_speech" ? [...s.sheriffCandidates] : (p.pkCandidates ?? []);
    const cursor = p.cursor ?? 0;
    if (cursor < order.length && seatState(s, order[cursor]!).alive) {
      s.pending.push({
        kind: "sheriff_speech",
        seat: order[cursor]!,
        order,
        alive: aliveSeats(s),
      });
    } else if (cursor < order.length) {
      p.cursor = cursor + 1;
    } else {
      p.step = p.step === "campaign_speech" ? "sheriff_vote" : "sheriff_revote";
      p.voteIssued = false;
    }
    return;
  }

  // ---- 警长竞选投票 / PK 再投票 ----
  if (p.step === "sheriff_vote" || p.step === "sheriff_revote") {
    if (!p.voteIssued) {
      const round = p.step === "sheriff_vote" ? 1 : 2;
      const candidates =
        p.step === "sheriff_vote"
          ? [...s.sheriffCandidates]
          : (p.pkCandidates ?? []).filter((c) => seatState(s, c).alive);
      const voters = aliveSeats(s); // 警长票全员参与（含候选人，可投自己）
      if (candidates.length === 0 || voters.length === 0) {
        events.push(...pushEvent(s, "sheriff_elected", { day: p.no, seat: null }, "public"));
        enterSpeechPhase(s);
        if (p.order) events.push(...pushEvent(s, "speech_order", { day: p.no, order: p.order }, "public"));
        return;
      }
      for (const v of voters) {
        s.pending.push({
          kind: "sheriff_vote",
          seat: v,
          candidates,
          abstainAllowed: true,
          alive: aliveSeats(s),
        });
      }
      p.voteIssued = true;
      p.voteRound = round;
    } else {
      resolveSheriffVote(s, events);
    }
    return;
  }

  // ---- 正式发言（两轮）/ PK 辩词 ----
  if (p.step === "speech" || p.step === "pk_speech") {
    const order = p.step === "speech" ? (p.order ?? []) : (p.pkCandidates ?? []);
    const cursor = p.cursor ?? 0;
    if (cursor < order.length) {
      const seat = order[cursor]!;
      if (seatState(s, seat).alive) {
        s.pending.push({
          kind: "speech",
          seat,
          day: p.no,
          order,
          pk: p.step === "pk_speech",
          round: p.step === "speech" ? (p.speechRound ?? 1) : 1,
          alive: aliveSeats(s),
        });
      } else {
        p.cursor = cursor + 1; // 发言者已死（DQ 等），跳过
      }
    } else if (p.step === "speech") {
      // 一轮发言结束：两轮制则进入第二轮（同顺序），否则进入投票
      const cur = p.speechRound ?? 1;
      if (cur < s.config.speechRounds) {
        p.speechRound = (cur + 1) as 1 | 2;
        p.cursor = 0;
      } else {
        p.step = "vote";
        p.voteIssued = false;
      }
    } else {
      p.step = "revote";
      p.voteIssued = false;
    }
    return;
  }

  if (p.step === "vote" || p.step === "revote") {
    if (!p.voteIssued) {
      // 发起放逐投票
      const round = p.step === "vote" ? 1 : 2;
      const candidates =
        p.step === "vote" ? aliveSeats(s) : (p.pkCandidates ?? []).filter((c) => seatState(s, c).alive);
      const voters =
        p.step === "vote"
          ? aliveSeats(s)
          : aliveSeats(s).filter((x) => !candidates.includes(x));
      if (candidates.length === 0 || voters.length === 0) {
        // 无人可投 -> 平安日
        events.push(
          ...pushEvent(s, "vote_result", { day: p.no, round, tally: [], eliminated: null, pk_candidates: [] }, "public"),
        );
        p.step = "aftermath";
        p.queue = [];
        return;
      }
      for (const v of voters) {
        s.pending.push({
          kind: "vote",
          seat: v,
          day: p.no,
          round,
          candidates,
          abstainAllowed: s.config.vote.abstainAllowed,
          sheriffVote: false,
          alive: aliveSeats(s),
        });
      }
      p.voteIssued = true;
      p.voteRound = round;
    } else {
      // pending 已清空（全部回复或被 DQ）-> 统计
      resolveVote(s, events);
    }
    return;
  }

  if (p.step === "aftermath") {
    const q = p.queue ?? [];
    if (q.length === 0) {
      startNight(s, events);
    } else {
      enqueueHead(s, q[0]!);
    }
  }
}

/** 警长竞选投票统计（人人 1 票；平票 -> PK -> 仍平 -> 无警长） */
function resolveSheriffVote(s: GameState, events: EngineEvent[]) {
  const p = s.phase;
  if (p.t !== "day") return;
  const round = p.voteRound ?? 1;
  const ballots = [...s.collect.voteBallots];
  s.collect.voteBallots = [];
  const candidates =
    round === 1 ? [...s.sheriffCandidates] : (p.pkCandidates ?? []).filter((c) => seatState(s, c).alive);
  const t = tally(ballots, candidates);

  let elected: Seat | null = null;
  let pk: Seat[] = [];
  if (t.leaders.length === 1 && t.max > 0) {
    elected = t.leaders[0]!;
  } else if (t.leaders.length > 1 && round === 1) {
    pk = t.leaders; // 平票 -> PK 发言 -> 再投票
  }

  events.push(
    ...pushEvent(
      s,
      "vote_result",
      {
        day: p.no,
        round,
        sheriff: true,
        tally: ballots.map((b) => ({ voter: b.voter, target: b.target })),
        eliminated: null,
        pk_candidates: pk,
      },
      "public",
    ),
  );

  if (elected !== null) {
    s.sheriff = elected;
    events.push(...pushEvent(s, "sheriff_elected", { day: p.no, seat: elected }, "public"));
    enterSpeechPhase(s);
    if (p.order) events.push(...pushEvent(s, "speech_order", { day: p.no, order: p.order }, "public"));
  } else if (pk.length > 0) {
    p.step = "sheriff_pk_speech";
    p.pkCandidates = pk;
    p.cursor = 0;
  } else {
    // 再投票仍平或零票 -> 本局无警长
    events.push(...pushEvent(s, "sheriff_elected", { day: p.no, seat: null }, "public"));
    enterSpeechPhase(s);
    if (p.order) events.push(...pushEvent(s, "speech_order", { day: p.no, order: p.order }, "public"));
  }
}

function resolveVote(s: GameState, events: EngineEvent[]) {
  const p = s.phase;
  if (p.t !== "day") return;
  const round = p.voteRound ?? 1;
  const ballots = [...s.collect.voteBallots];
  s.collect.voteBallots = [];
  const candidates = round === 1 ? aliveSeats(s) : (p.pkCandidates ?? []).filter((c) => seatState(s, c).alive);
  // 警长 1.5 票（revote 时警长若是 PK 候选不投票，其权重自然不生效）
  const weights = s.sheriff ? ({ [s.sheriff]: s.config.sheriff.extraVote } as Record<number, number>) : undefined;
  const t = s.sheriff
    ? weightedTally(ballots, candidates, (voter) => (voter === s.sheriff ? s.config.sheriff.extraVote : 1))
    : tally(ballots, candidates);

  let eliminated: Seat | null = null;
  let pk: Seat[] = [];
  if (t.leaders.length === 1 && t.max > 0) {
    eliminated = t.leaders[0]!;
  } else if (round === 1 && t.leaders.length > 1 && s.config.vote.tie === "pk_speech_then_revote") {
    pk = t.leaders;
  }
  // round2 仍平 -> 平安日（eliminated=null, pk=[]）

  s.votes.push({ day: p.no, round, ballots, eliminated, pkCandidates: pk, weights });
  events.push(
    ...pushEvent(
      s,
      "vote_result",
      {
        day: p.no,
        round,
        tally: ballots.map((b) => ({ voter: b.voter, target: b.target })),
        eliminated,
        pk_candidates: pk,
      },
      "public",
    ),
  );
  p.voteIssued = false;

  if (eliminated !== null) {
    killSeat(s, eliminated, "vote", p.no);
    const win = checkWin(s);
    if (win) {
      setWinner(s, win, events);
      return;
    }
    const st = seatState(s, eliminated);
    const queue: DawnQueueItem[] = [];
    if (s.config.lastWords.dayElimination === "always") queue.push({ kind: "last_words", seat: eliminated, cause: "vote" });
    if (st.role === "hunter") {
      // 遗言后开枪：若遗言在队列则以遗言为先，否则直接开枪
      queue.push({ kind: "hunter", seat: eliminated, reason: "vote" });
    }
    // 警长被放逐：遗言后移交警徽（killSeat 时队列未就绪，在此补挂）
    if (s.sheriff === eliminated && s.config.sheriff.transferOnDeath) {
      queue.push({ kind: "sheriff_transfer", seat: eliminated });
    }
    p.step = "aftermath";
    p.queue = queue;
  } else if (pk.length > 0) {
    p.step = "pk_speech";
    p.pkCandidates = pk;
    p.cursor = 0;
  } else {
    p.step = "aftermath";
    p.queue = [];
  }
}

function startNight(s: GameState, events: EngineEvent[]) {
  s.night += 1;
  s.currentKill = null;
  s.collect.wolfBallots = [];
  s.nightActions = { night: s.night, healUsed: false, poisonTarget: null };
  s.phase = { t: "night", no: s.night };
  events.push(...pushEvent(s, "night_begun", { night: s.night }, "public"));

  const wolves = aliveOfRole(s, "werewolf");
  const wolfSeats = wolves.map((x) => x.seat);
  for (const w of wolves) {
    s.pending.push({
      kind: "wolf_kill",
      seat: w.seat,
      night: s.night,
      alive: aliveSeats(s),
      teammates: wolves.map((x) => ({ seat: x.seat, alive: true })),
      killTargets: [...aliveSeats(s).filter((x) => !wolfSeats.includes(x)), null],
    });
  }
  for (const seer of aliveOfRole(s, "seer")) {
    s.pending.push({
      kind: "seer_check",
      seat: seer.seat,
      night: s.night,
      alive: aliveSeats(s),
      unchecked: aliveSeats(s).filter((x) => !s.seerChecks.some((c) => c.target === x)),
      history: [...s.seerChecks],
    });
  }
}
