// 单局编排器：引擎状态机 <-> 选手 agent 进程 <-> 事件总线/持久化。
// 职责：
//   1. spawn 全部 agent 进程并完成 game_start 握手
//   2. 循环：先把新事件按可见性 notify 到各座位，再派发 pending 请求
//   3. 回复预校验（合法才喂引擎）；超时/崩溃/违规 -> 引擎默认动作或 disqualify
//   4. 终局：game_end -> kill 全部进程 -> 返回完整结果
import type { A2PMessage, P2AMessage, Seat } from "@wt/protocol";
import {
  createGame,
  reduce,
  validateResponseFor,
  agentEventsSince,
  spectatorView,
  EngineError,
  type EngineAction,
  type EngineEvent,
  type GameConfig,
  type GameState,
  type PendingRequest,
  type ResponsePayload,
} from "@wt/engine";
import type { AgentManifest } from "../agents/manifest.js";
import { AgentProcess } from "../agents/runner.js";
import type { SandboxAdapter } from "../agents/sandbox.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EventBus } from "./bus.js";

export interface PlayerSpec {
  seat: Seat;
  agentId: string;
  name: string;
  agentDir: string;
  manifest: AgentManifest;
}

export interface GameSinks {
  /** 引擎事件流（含可见性标签）入库/审计 */
  onEvents?: (state: GameState, events: EngineEvent[]) => Promise<void>;
  /** 终局结果入库 */
  onFinish?: (result: GameResult) => Promise<void>;
  /** agent 进程日志（stderr 等） */
  onAgentLog?: (seat: Seat, text: string) => void;
}

export interface GameResult {
  gameId: string;
  state: GameState;
  winnerFaction: "werewolf" | "village";
  winReason: string;
  seats: Array<{
    seat: Seat;
    agentId: string;
    role: string;
    alive: boolean;
    teamWon: boolean;
    death?: { cause: string; turn: number };
    penalties: number;
    violations: number;
  }>;
}

const VIOLATION_LIMIT = 3;

export class Orchestrator {
  private procs = new Map<Seat, AgentProcess>();
  private lastSeq = new Map<Seat, number>();
  private violationCounts = new Map<Seat, number>();
  private finished = false;

  constructor(
    private readonly gameId: string,
    private readonly bus: EventBus,
    private readonly sandbox: SandboxAdapter,
    private readonly sinks: GameSinks,
    /** 按 agent 提供 LLM 代理连接信息（token 细分以便计量；返回 undefined 则不注入） */
    private readonly llmProxyFor?: (
      agentId: string,
    ) => { llmProxyUrl: string; llmProxyToken: string; llmProxyModel?: string } | undefined,
  ) {}

  async run(opts: {
    seed: string;
    config?: Partial<GameConfig>;
    players: PlayerSpec[];
  }): Promise<GameResult> {
    const init = createGame({
      gameId: this.gameId,
      seed: opts.seed,
      config: opts.config,
      players: opts.players.map((p) => ({ seat: p.seat, agentId: p.agentId, name: p.name })),
    });
    const state = init.state;
    await this.emit(state, init.events); // 初始事件（game_started/night_begun 等）同样广播与入库

    // 1. spawn 全部进程
    await Promise.all(
      opts.players.map(async (p) => {
        const workDir = await mkdtemp(path.join(tmpdir(), `wt-${this.gameId}-s${p.seat}-`));
        const ap = await AgentProcess.spawn(p.manifest, this.sandbox, {
          gameId: this.gameId,
          seat: p.seat,
          agentDir: p.agentDir,
          workDir,
          agentId: p.agentId,
          ...this.llmProxyFor?.(p.agentId),
        }).catch((e) => {
          throw new Error(`agent ${p.name}(seat ${p.seat}) spawn 失败: ${e instanceof Error ? e.message : e}`);
        });
        this.procs.set(p.seat, ap);
      }),
    );

    // 2. game_start（含各自角色与狼队友）
    for (const p of opts.players) {
      const st = state.seats.find((x) => x.seat === p.seat)!;
      const msg: Record<string, unknown> = {
        type: "game_start",
        you: {
          seat: p.seat,
          role: st.role,
          faction: st.faction,
          ...(st.role === "werewolf"
            ? { wolf_teammates: state.seats.filter((x) => x.role === "werewolf" && x.seat !== p.seat).map((x) => x.seat) }
            : {}),
        },
        config: toPublicConfig(state),
        players: state.seats.map((x) => ({ seat: x.seat, name: x.name })),
      };
      this.procs.get(p.seat)!.notify(msg as never);
    }

    // 3. 主循环
    let s = state;
    let guard = 0;
    while (!s.winner && guard++ < 5000) {
      this.flushNotifies(s);
      if (s.pending.length === 0) throw new Error("引擎 pending 为空且未终局（死锁）");
      const actions = await this.dispatch(s);
      for (const a of actions) {
        const r = reduce(s, a);
        s = r.state;
        await this.emit(s, r.events);
      }
    }
    if (!s.winner) throw new Error("guard 耗尽，对局未终局");

    // 4. game_end + 收尾
    this.flushNotifies(s);
    for (const [, ap] of this.procs) {
      ap.notify({
        type: "game_end",
        winner: s.winner.faction,
        your_team_won: s.seats.length > 0 ? teamWonOf(s, seatOfProc(ap)) : false,
        reveal: s.seats.map((x) => ({ seat: x.seat, role: x.role, faction: x.faction })),
      } as never);
    }
    const result = this.buildResult(s);
    await Promise.all([...this.procs.values()].map((ap) => ap.kill("game_end").catch(() => {})));
    this.finished = true;
    await this.sinks.onFinish?.(result);
    return result;
  }

  /** 把 reduce 产出的事件广播/入库 */
  private async emit(state: GameState, events: EngineEvent[]) {
    if (events.length) await this.sinks.onEvents?.(state, events);
    for (const ev of events) {
      if (ev.visibility === "public") {
        this.bus.publish({
          topic: `game/${this.gameId}`,
          kind: ev.kind,
          seq: ev.seq,
          payload: ev.payload,
          ts: new Date().toISOString(),
        });
      }
    }
    // 快照（观众视图）随事件流出
    this.bus.publish({
      topic: `game/${this.gameId}`,
      kind: "snapshot",
      payload: spectatorView(state),
      ts: new Date().toISOString(),
    });
  }

  /** 按可见性把新事件增量 notify 到各座位 */
  private flushNotifies(s: GameState) {
    for (const seat of s.seats.map((x) => x.seat)) {
      const ap = this.procs.get(seat);
      if (!ap || ap.hasExited) continue;
      const { events, lastSeq } = agentEventsSince(s, seat, this.lastSeq.get(seat) ?? 0);
      if (events.length === 0) continue;
      for (const e of events) ap.notify({ type: "notify", event: e } as never);
      this.lastSeq.set(seat, lastSeq);
    }
  }

  /** 派发当前全部 pending 请求并收集动作（违规/超时自动转默认或 DQ） */
  private async dispatch(s: GameState): Promise<EngineAction[]> {
    const jobs = s.pending.map(async (req) => {
      const ap = this.procs.get(req.seat)!;
      const msg = toRequestMessage(s, req);
      const res = await ap.request(msg);
      if (!res.ok) {
        // timeout / crash / malformed —— 引擎默认动作；malformed 额外计违规
        this.sinks.onAgentLog?.(req.seat, `[dispatch] ${res.err}: ${res.detail ?? ""}`);
        if (res.err === "malformed") this.bumpViolation(req.seat, `非法回复: ${res.detail ?? ""}`);
        const v = this.violationCounts.get(req.seat) ?? 0;
        if (v >= VIOLATION_LIMIT) {
          return { t: "disqualify" as const, seat: req.seat, reason: `累计 ${v} 次违规` };
        }
        return { t: "timeout" as const, seat: req.seat };
      }
      const payload = toResponsePayload(res.res);
      if (!payload) {
        this.bumpViolation(req.seat, "回复类型与请求不匹配");
        return { t: "timeout" as const, seat: req.seat };
      }
      const err = validateResponseFor(s, req.seat, payload);
      if (err) {
        const v = this.bumpViolation(req.seat, err.message);
        if (v >= VIOLATION_LIMIT) {
          return { t: "disqualify" as const, seat: req.seat, reason: `累计 ${v} 次违规（${err.message}）` };
        }
        return { t: "timeout" as const, seat: req.seat };
      }
      return { t: "respond" as const, seat: req.seat, payload };
    });
    const actions = await Promise.all(jobs);
    // DQ 的座位杀进程
    for (const a of actions) {
      if (a.t === "disqualify") {
        void this.procs.get(a.seat)?.kill(`disqualify:${a.reason}`).catch(() => {});
      }
    }
    return actions;
  }

  private bumpViolation(seat: Seat, reason: string): number {
    const ap = this.procs.get(seat);
    const v = Math.max(ap?.violations ?? 0, (this.violationCounts.get(seat) ?? 0) + 1);
    this.violationCounts.set(seat, v);
    if (ap) ap.violations = v;
    this.sinks.onAgentLog?.(seat, `[violation ${v}] ${reason}`);
    this.bus.publish({
      topic: `game/${this.gameId}`,
      kind: "violation",
      payload: { seat, count: v, reason },
      ts: new Date().toISOString(),
    });
    return v;
  }

  private buildResult(s: GameState): GameResult {
    return {
      gameId: this.gameId,
      state: s,
      winnerFaction: s.winner!.faction,
      winReason: s.winner!.reason,
      seats: s.seats.map((x) => ({
        seat: x.seat,
        agentId: x.agentId,
        role: x.role,
        alive: x.alive,
        teamWon: x.faction === s.winner!.faction,
        death: x.death,
        penalties: s.penalties[x.seat] ?? 0,
        violations: this.violationCounts.get(x.seat) ?? 0,
      })),
    };
  }
}

function seatOfProc(ap: AgentProcess): Seat {
  return ap.seat as Seat;
}
function teamWonOf(s: GameState, seat: Seat): boolean {
  return s.seats.find((x) => x.seat === seat)?.faction === s.winner?.faction;
}

function toPublicConfig(s: GameState) {
  return {
    player_count: s.config.playerCount,
    role_set: s.config.roleSet,
    win_condition: s.config.winCondition,
    speech_char_limit: s.config.speechCharLimit,
    timeouts_ms: s.config.timeoutsMs,
  };
}

export function toRequestMessage(s: GameState, req: PendingRequest): Record<string, unknown> {
  const base = { alive: req.alive, timeout_ms: timeoutOf(s, req) };
  switch (req.kind) {
    case "wolf_kill":
      return {
        type: "night_action_request",
        night: req.night,
        role: "werewolf",
        ...base,
        options: { as: "werewolf", teammates: req.teammates, kill_targets: req.killTargets },
      };
    case "seer_check":
      return {
        type: "night_action_request",
        night: req.night,
        role: "seer",
        ...base,
        options: { as: "seer", unchecked: req.unchecked, history: req.history },
      };
    case "witch_action":
      return {
        type: "night_action_request",
        night: req.night,
        role: "witch",
        ...base,
        options: {
          as: "witch",
          killed_tonight: req.killedTonight,
          heal_available: req.healAvailable,
          poison_available: req.poisonAvailable,
          can_self_heal: req.canSelfHeal,
          heal_blocks_poison: req.healBlocksPoison,
        },
      };
    case "hunter_shoot":
      return { type: "hunter_shoot_request", reason: req.reason, shoot_targets: req.targets, ...base };
    case "speech":
      return req.pk
        ? { type: "pk_speech_request", day: req.day, candidates: req.order, char_limit: s.config.speechCharLimit, ...base }
        : { type: "day_speech_request", day: req.day, order: req.order, char_limit: s.config.speechCharLimit, ...base };
    case "vote":
      return {
        type: "vote_request",
        day: req.day,
        round: req.round,
        candidates: req.candidates,
        abstain_allowed: req.abstainAllowed,
        ...base,
      };
    case "last_words":
      return { type: "last_words_request", cause: req.cause, ...base };
  }
}

function timeoutOf(s: GameState, req: PendingRequest): number {
  switch (req.kind) {
    case "wolf_kill":
    case "seer_check":
    case "witch_action":
      return s.config.timeoutsMs.night_action;
    case "speech":
      return s.config.timeoutsMs.speech;
    case "vote":
      return s.config.timeoutsMs.vote;
    case "last_words":
      return s.config.timeoutsMs.last_words;
    case "hunter_shoot":
      return s.config.timeoutsMs.hunter;
  }
}

export function toResponsePayload(res: A2PMessage): ResponsePayload | null {
  switch (res.type) {
    case "night_action":
      if (res.action.as === "werewolf") return { t: "wolf_kill", kill: res.action.kill };
      if (res.action.as === "seer") return { t: "seer_check", check: res.action.check };
      return { t: "witch_action", heal: res.action.heal, poison: res.action.poison };
    case "hunter_shoot":
      return { t: "hunter_shoot", shoot: res.shoot };
    case "speech":
      return { t: "speech", text: res.text };
    case "vote":
      return { t: "vote", target: res.target };
    case "last_words":
      return { t: "last_words", text: res.text };
    default:
      return null;
  }
}

export { EngineError };
export type { P2AMessage };
