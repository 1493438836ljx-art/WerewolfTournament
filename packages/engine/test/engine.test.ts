// 引擎规则矩阵测试。座位约定（显式分配）：
// 1,2,3=werewolf  4=seer  5=witch  6=hunter  7,8,9=villager
import { describe, expect, it } from "vitest";
import type { Role, Seat } from "@wt/protocol";
import { createGame, reduce } from "../src/reducer.js";
import { Rng, seedFromString } from "../src/rng.js";
import { autobotStep } from "../src/autobot.js";
import { agentEventsFor, visibleEventsFor } from "../src/visibility.js";
import { aliveSeats, seatState, type EngineAction, type GameState, type ResponsePayload } from "../src/types.js";
import { TIMEOUT_SPEECH_TEXT } from "../src/defaults.js";

const ASSIGN: Record<number, Role> = {
  1: "werewolf", 2: "werewolf", 3: "werewolf",
  4: "seer", 5: "witch", 6: "hunter",
  7: "villager", 8: "villager", 9: "villager",
};

function mk(seed = "test", assign: Record<number, Role> = ASSIGN): GameState {
  const r = createGame({
    gameId: "g-test",
    seed,
    players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1 as Seat, agentId: `a${i + 1}`, name: `bot${i + 1}` })),
    assignments: assign as Partial<Record<Seat, Role>>,
  });
  return r.state;
}

function respond(s: GameState, seat: Seat, payload: ResponsePayload): GameState {
  return reduce(s, { t: "respond", seat, payload }).state;
}

/** 夜晚快速路径：三狼刀 target、预言家验 checkSeat、女巫 heal/poison */
function playNight(
  s: GameState,
  opts: { kill: Seat | null; check: Seat; heal?: boolean; poison?: Seat | null },
): GameState {
  // 夜晚入口：存活狼各一个 wolf_kill + 存活预言家 seer_check（女巫请求在狼交齐后追加）
  const kinds = s.pending.map((p) => p.kind);
  expect(kinds).toContain("wolf_kill");
  expect(kinds).toContain("seer_check");
  for (const w of [1, 2, 3] as Seat[]) {
    if (!s.pending.some((p) => p.seat === w)) continue;
    s = respond(s, w, { t: "wolf_kill", kill: opts.kill });
  }
  if (s.pending.some((p) => p.seat === 4)) s = respond(s, 4, { t: "seer_check", check: opts.check });
  const witchPending = s.pending.find((p) => p.seat === 5);
  if (witchPending) {
    s = respond(s, 5, { t: "witch_action", heal: opts.heal ?? false, poison: opts.poison ?? null });
  }
  return s;
}

/** 白天快速路径：全部发言 -> 全部投票 target（单值或 seat->target 映射）。
 *  白天结束（进入下一夜的请求）即返回。 */
function playDay(s: GameState, voteOf: (voter: Seat) => Seat): GameState {
  let guard = 0;
  while (!s.winner && s.pending.length > 0 && guard++ < 200) {
    const req = s.pending[0]!;
    if (req.kind === "speech") s = respond(s, req.seat, { t: "speech", text: `我是${req.seat}号，过` });
    else if (req.kind === "vote") s = respond(s, req.seat, { t: "vote", target: voteOf(req.seat) });
    else if (req.kind === "last_words") s = respond(s, req.seat, { t: "last_words", text: "遗言" });
    else if (req.kind === "hunter_shoot") s = respond(s, req.seat, { t: "hunter_shoot", shoot: null });
    else break; // 夜晚请求（wolf_kill/seer/witch）—— 白天结束
  }
  if (guard >= 200) throw new Error("playDay guard");
  return s;
}

const lastEvent = (s: GameState, kind: string) => [...s.log].reverse().find((e) => e.kind === kind);
const deaths = (s: GameState) => (lastEvent(s, "dawn_deaths")?.payload as { deaths: Seat[] }).deaths;

// ---------- 夜晚结算矩阵 ----------
describe("夜晚结算", () => {
  it("女巫救刀口 -> 平安夜", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: true });
    expect(deaths(s)).toEqual([]);
    // 平安夜：无遗言无猎人 -> dawn 队列为空，直接进入白天
    expect(s.phase.t).toBe("day");
    expect(s.day).toBe(1);
  });

  it("女巫不救 -> 单死；死者为首夜 -> 有遗言", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    expect(deaths(s)).toEqual([7]);
    expect(s.phase.t).toBe("dawn");
    expect(s.phase.queue?.some((q) => q.kind === "last_words" && q.seat === 7)).toBe(true);
  });

  it("女巫毒 -> 双死（刀+毒）", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false, poison: 8 });
    expect(deaths(s)).toEqual([7, 8]);
    expect(seatState(s, 7).death?.cause).toBe("wolf");
    expect(seatState(s, 8).death?.cause).toBe("poison");
  });

  it("女巫自救：首夜可自救，第二夜不可", () => {
    let s = mk();
    // 夜1：刀5，女巫自救 -> 平安夜
    s = playNight(s, { kill: 5, check: 8, heal: true });
    expect(deaths(s)).toEqual([]);
    // 白1：分票 7,8,9 各3票 -> 全平 -> PK(7,8,9) -> 再投票仍平 -> 平安日
    const spread = (v: Seat): Seat => ((v % 3) + 7) as Seat; // 1->8, 2->9, 3->7, ...
    s = playDay(s, spread);
    expect(s.votes[s.votes.length - 1]!.eliminated).toBeNull();
    // 夜2：再刀5（狼交齐后女巫请求出现），canSelfHeal=false，自救应抛错
    for (const w of [1, 2, 3] as Seat[]) s = respond(s, w, { t: "wolf_kill", kill: 5 });
    expect(s.pending.some((p) => p.seat === 5 && p.kind === "witch_action")).toBe(true);
    const req = s.pending.find((p) => p.seat === 5)!;
    expect((req as { canSelfHeal: boolean }).canSelfHeal).toBe(false);
    expect(() => respond(s, 5, { t: "witch_action", heal: true, poison: null })).toThrow();
  });
});

describe("狼刀共识", () => {
  it("多数决：2票对1票取多数", () => {
    let s = mk();
    s = respond(s, 1, { t: "wolf_kill", kill: 7 });
    s = respond(s, 2, { t: "wolf_kill", kill: 7 });
    s = respond(s, 3, { t: "wolf_kill", kill: 8 });
    s = respond(s, 4, { t: "seer_check", check: 8 });
    const ev = lastEvent(s, "wolf_target_locked")!;
    expect((ev.payload as { target: Seat | null }).target).toBe(7);
    expect(ev.visibility).toEqual({ seats: [1, 2, 3] });
  });

  it("平票取座位最小狼的选择", () => {
    let s = mk();
    s = respond(s, 1, { t: "wolf_kill", kill: 7 }); // 最小座狼选 7
    s = respond(s, 2, { t: "wolf_kill", kill: 8 });
    s = respond(s, 3, { t: "wolf_kill", kill: 9 });
    s = respond(s, 4, { t: "seer_check", check: 8 });
    const ev = lastEvent(s, "wolf_target_locked")!;
    expect((ev.payload as { target: Seat | null }).target).toBe(7);
  });
});

// ---------- 猎人 ----------
describe("猎人", () => {
  it("被刀可开枪带走目标", () => {
    let s = mk();
    s = playNight(s, { kill: 6, check: 8, heal: false }); // 刀猎人
    expect(s.phase.t).toBe("dawn");
    expect(s.phase.queue?.[0]).toMatchObject({ kind: "hunter", seat: 6, reason: "wolf" });
    s = respond(s, 6, { t: "hunter_shoot", shoot: 1 });
    expect(seatState(s, 1).death?.cause).toBe("hunter");
    expect(lastEvent(s, "hunter_shot")?.payload).toMatchObject({ by: 6, target: 1 });
  });

  it("被毒死不可开枪", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false, poison: 6 }); // 毒猎人
    const q = s.phase.t === "dawn" ? s.phase.queue : [];
    expect(q?.some((x) => x.kind === "hunter")).toBe(false);
  });

  it("白天被放逐：遗言后开枪", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    // 白1：遗言 + 发言，然后全员投 6（猎人）
    let guard = 0;
    while (!s.winner && s.pending.length && guard++ < 100) {
      const req = s.pending[0]!;
      if (req.seat === 7 && req.kind === "last_words") s = respond(s, 7, { t: "last_words", text: "LW" });
      else if (req.kind === "speech") s = respond(s, req.seat, { t: "speech", text: "过" });
      else if (req.kind === "vote") s = respond(s, req.seat, { t: "vote", target: 6 });
      else if (req.kind === "last_words") s = respond(s, req.seat, { t: "last_words", text: "LW" });
      else if (req.kind === "hunter_shoot") {
        // 猎人被票出，遗言后应收到开枪请求
        expect(req.reason).toBe("vote");
        s = respond(s, req.seat, { t: "hunter_shoot", shoot: 2 });
      }
    }
    expect(seatState(s, 6).death?.cause).toBe("vote");
    expect(seatState(s, 2).death?.cause).toBe("hunter");
  });

  it("被枪杀的猎人可翻牌再开枪（链）", () => {
    // 自定义分配：6=hunter(被刀), 7=hunter(被枪杀)
    const assign = { ...ASSIGN, 7: "hunter" as Role, 9: "villager" as Role };
    let s = mk("chain", assign);
    s = playNight(s, { kill: 6, check: 8, heal: false });
    s = respond(s, 6, { t: "hunter_shoot", shoot: 7 }); // 枪杀另一猎人
    // 7 应收到开枪请求（reason=shot）
    const req = s.pending.find((p) => p.seat === 7);
    expect(req?.kind).toBe("hunter_shoot");
    expect((req as { reason: string }).reason).toBe("shot");
    s = respond(s, 7, { t: "hunter_shoot", shoot: 1 });
    expect(seatState(s, 1).death?.cause).toBe("hunter");
  });
});

// ---------- 投票与平票 ----------
describe("投票", () => {
  it("多数票放逐", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    s = playDay(s, () => 3); // 全员投 3 号狼
    expect(seatState(s, 3).death?.cause).toBe("vote");
    const vr = s.votes[s.votes.length - 1]!;
    expect(vr.eliminated).toBe(3);
  });

  it("平票 -> PK 发言 -> 非候选再投票 -> 出局", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    s = respond(s, 7, { t: "last_words", text: "LW" });
    // 8 人投票（7 已死）：1,2,3,4 -> 8；5,6,8,9 -> 9 => 4:4 平票 PK(8,9)
    let guard = 0;
    while (!s.winner && s.pending.length && guard++ < 300) {
      const req = s.pending[0]!;
      if (req.kind === "speech" && !req.pk) {
        s = respond(s, req.seat, { t: "speech", text: "过" });
      } else if (req.kind === "vote" && req.round === 1) {
        const target: Seat = req.seat <= 4 ? 8 : 9;
        s = respond(s, req.seat, { t: "vote", target });
      } else if (req.kind === "speech" && req.pk) {
        s = respond(s, req.seat, { t: "speech", text: "PK辩词" });
        expect(req.seat === 8 || req.seat === 9).toBe(true);
      } else if (req.kind === "vote" && req.round === 2) {
        expect([8, 9]).not.toContain(req.seat); // PK 者不投票
        s = respond(s, req.seat, { t: "vote", target: 8 });
      } else if (req.kind === "last_words") {
        s = respond(s, req.seat, { t: "last_words", text: "LW" });
        expect(req.seat).toBe(8); // 8 被票出
      } else if (req.kind === "hunter_shoot") {
        s = respond(s, req.seat, { t: "hunter_shoot", shoot: null });
      } else {
        break; // 进入夜晚
      }
    }
    const v1 = s.votes.find((v) => v.day === 1 && v.round === 1)!;
    const v2 = s.votes.find((v) => v.day === 1 && v.round === 2)!;
    expect(v1.pkCandidates.sort()).toEqual([8, 9]);
    expect(v2.eliminated).toBe(8);
  });
});

// ---------- 胜负 ----------
describe("胜负判定", () => {
  it("狼全灭 -> 好人胜", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    s = playDay(s, () => 1); // 票出狼1
    s = playNight(s, { kill: 8, check: 9, heal: false });
    s = playDay(s, () => 2); // 票出狼2
    s = playNight(s, { kill: null, check: 4, heal: false }); // 空刀保住最后的村民，避免提前屠边
    s = playDay(s, () => 3); // 票出最后一狼
    expect(s.winner?.faction).toBe("village");
  });

  it("神职全灭（屠边）-> 狼胜", () => {
    let s = mk();
    // DQ 三神构造屠边（3狼存活 vs 3民 -> 狼数≥好人数同刻成立，任一 reason 皆狼胜）
    for (const seat of [4, 5, 6] as Seat[]) {
      s = reduce(s, { t: "disqualify", seat, reason: "测试" }).state;
    }
    expect(s.winner?.faction).toBe("werewolf");
  });

  it("狼数>=好人数 -> 狼胜", () => {
    // 存活 3 狼 3 好：DQ 3 个村民
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false }); // 7 死，剩 3狼3神2民? 9-1=8
    for (const seat of [8, 9] as Seat[]) {
      s = reduce(s, { t: "disqualify", seat, reason: "测试" }).state;
    }
    // 存活：1,2,3狼 + 4,5,6神 = 3狼3好 -> 狼胜
    expect(s.winner?.faction).toBe("werewolf");
  });
});

// ---------- 超时默认 ----------
describe("超时默认", () => {
  it("发言超时 -> 固定文案 + penalty", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    // 处理死者遗言
    s = respond(s, 7, { t: "last_words", text: "LW" });
    // 第一个发言者超时
    const req = s.pending.find((p) => p.kind === "speech")!;
    s = reduce(s, { t: "timeout", seat: req.seat }).state;
    const ev = lastEvent(s, "speech")!;
    expect((ev.payload as { text: string }).text).toBe(TIMEOUT_SPEECH_TEXT);
    expect(s.penalties[req.seat]).toBe(1);
  });

  it("女巫超时默认不用药", () => {
    let s = mk();
    for (const w of [1, 2, 3] as Seat[]) s = respond(s, w, { t: "wolf_kill", kill: 7 });
    s = respond(s, 4, { t: "seer_check", check: 8 });
    s = reduce(s, { t: "timeout", seat: 5 }).state;
    expect(deaths(s)).toEqual([7]);
    expect(s.witchPotions).toEqual({ heal: true, poison: true });
  });
});

// ---------- 重放确定性 ----------
describe("重放确定性", () => {
  it("同一动作序列重放产出完全一致的事件流", () => {
    for (const seed of ["r1", "r2", "r3", "r4", "r5"]) {
      const g0 = createGame({
        gameId: "g-replay",
        seed,
        players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1 as Seat, agentId: `a${i + 1}`, name: `b${i + 1}` })),
      });
      const rng = new Rng(seedFromString(seed + "-bot"));
      const actions: EngineAction[] = [];
      let s = g0.state;
      let guard = 0;
      while (!s.winner && guard++ < 5000) {
        if (s.pending.length === 0) throw new Error(`deadlock: ${seed} @ ${JSON.stringify(s.phase)}`);
        for (const a of autobotStep(s, rng)) {
          actions.push(a);
          s = reduce(s, a).state;
        }
      }
      expect(s.winner).toBeDefined();

      // 重放
      const g1 = createGame({
        gameId: "g-replay",
        seed,
        players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1 as Seat, agentId: `a${i + 1}`, name: `b${i + 1}` })),
      });
      let s2 = g1.state;
      for (const a of actions) s2 = reduce(s2, a).state;
      expect(s2.log).toEqual(s.log);
      expect(s2.winner).toEqual(s.winner);
    }
  });
});

// ---------- 信息隔离（属性测试） ----------
describe("信息隔离", () => {
  const seeds = Array.from({ length: 8 }, (_, i) => `vis-${i}`);
  const games: GameState[] = [];

  it("随机对局全程无死锁且终局", () => {
    for (const seed of seeds) {
      const g = createGame({
        gameId: "g-vis",
        seed,
        players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1 as Seat, agentId: `a${i + 1}`, name: `b${i + 1}` })),
      });
      const rng = new Rng(seedFromString(seed + "-bot"));
      let s = g.state;
      let guard = 0;
      while (!s.winner && guard++ < 5000) {
        expect(s.pending.length).toBeGreaterThan(0);
        for (const a of autobotStep(s, rng)) s = reduce(s, a).state;
      }
      expect(s.winner).toBeDefined();
      games.push(s);
    }
  });

  it("座位 i 收不到其他座位的私有信息", () => {
    for (const s of games) {
      for (const seat of s.seats.map((x) => x.seat)) {
        const events = agentEventsFor(s, seat);
        const me = seatState(s, seat);
        for (const e of events) {
          if (e.kind === "seer_result") {
            // 只能是自己的查验（payload.seat 归属检查在可见性层：seer_result 事件 visibility=本座）
            const raw = visibleEventsFor(s, seat).find(
              (r) => r.kind === "seer_result" && (r.payload as { seat: Seat }).seat !== seat,
            );
            expect(raw).toBeUndefined();
          }
          if (e.kind === "wolf_kill_locked") {
            expect(me.role).toBe("werewolf"); // 只有狼能收到刀口
          }
        }
        // 非狼座位不应收到任何 wolf_target_locked
        if (me.role !== "werewolf") {
          expect(visibleEventsFor(s, seat).some((e) => e.kind === "wolf_target_locked")).toBe(false);
        }
        // 女巫用药事件只有女巫本人可见
        const witchEvents = visibleEventsFor(s, seat).filter(
          (e) => e.kind === "witch_heal_used" || e.kind === "witch_poison_used",
        );
        if (me.role !== "witch") expect(witchEvents.length).toBe(0);
      }
    }
  });

  it("公开事件对全员可见且一致", () => {
    for (const s of games) {
      const pub = s.log.filter((e) => e.visibility === "public");
      for (const seat of s.seats.map((x) => x.seat)) {
        const vis = visibleEventsFor(s, seat);
        for (const e of pub) expect(vis.some((v) => v.seq === e.seq)).toBe(true);
      }
    }
  });
});

// ---------- 边界 ----------
describe("边界与防御", () => {
  it("无 pending 的座位 respond 抛错", () => {
    const s = mk();
    expect(() => respond(s, 9, { t: "speech", text: "x" })).toThrow();
  });

  it("非法目标（杀狼同伴/投死人）抛错", () => {
    let s = mk();
    expect(() => respond(s, 1, { t: "wolf_kill", kill: 2 })).toThrow(); // 杀队友
    s = playNight(s, { kill: 7, check: 8, heal: false });
    s = respond(s, 7, { t: "last_words", text: "LW" });
    expect(() => respond(s, 1, { t: "vote", target: 7 })).toThrow(); // 投死者
  });

  it("终局后拒绝动作", () => {
    let s = mk();
    for (const seat of [4, 5, 6] as Seat[]) s = reduce(s, { t: "disqualify", seat, reason: "x" }).state;
    expect(() => reduce(s, { t: "respond", seat: 1, payload: { t: "speech", text: "x" } })).toThrow();
  });

  it("夜晚存活列表正确传给请求", () => {
    let s = mk();
    s = playNight(s, { kill: 7, check: 8, heal: false });
    s = respond(s, 7, { t: "last_words", text: "LW" });
    const req = s.pending.find((p) => p.kind === "speech")!;
    expect(req.alive.sort()).toEqual(aliveSeats(s).sort());
  });
});
