// 确定性自动玩家策略：驱动引擎跑完整对局（测试 / sim 演练用）。
// 注意：这不是参赛 agent —— 进程版示例见 agents/random-bot。
import type { Seat } from "@wt/protocol";
import type { GameState, PendingRequest, ResponsePayload } from "./types.js";
import { seatState } from "./types.js";
import { Rng } from "./rng.js";

const SPEECHES = [
  "我是好人，昨晚的信息我捋一下，过",
  "我视角里 X 号发言有问题，先挂个怀疑",
  "同意上位的分析，这轮先推 3 号",
  "我是平民，神职站出来带队吧",
  "票型很清晰了，跟着走",
  "我保留意见，但我先过",
];

export function autobotRespond(s: GameState, req: PendingRequest, rng: Rng): ResponsePayload {
  switch (req.kind) {
    case "wolf_kill": {
      const targets = req.killTargets.filter((t): t is Seat => t !== null);
      return { t: "wolf_kill", kill: rng.next() < 0.05 ? null : rng.pick(targets) };
    }
    case "seer_check": {
      const pool = req.unchecked.length ? req.unchecked : req.alive.filter((x) => x !== req.seat);
      return { t: "seer_check", check: rng.pick(pool) };
    }
    case "witch_action": {
      // 首夜 50% 救刀口；10% 随机毒
      const heal = req.healAvailable && req.killedTonight !== null && rng.next() < 0.5;
      const poison =
        !heal && req.poisonAvailable && rng.next() < 0.1
          ? rng.pick(req.alive.filter((x) => x !== req.seat))
          : null;
      return { t: "witch_action", heal, poison };
    }
    case "hunter_shoot": {
      if (rng.next() < 0.8 && req.targets.length) return { t: "hunter_shoot", shoot: rng.pick(req.targets) };
      return { t: "hunter_shoot", shoot: null };
    }
    case "speech":
      return { t: "speech", text: rng.pick(SPEECHES) };
    case "vote":
      return { t: "vote", target: rng.pick(req.candidates) };
    case "last_words":
      return { t: "last_words", text: "我的身份信息后面的人注意听，先走一步" };
  }
}

/** 一步推进：为当前所有 pending 生成 respond 动作（rng 由调用方持有以便重放） */
export function autobotStep(
  s: GameState,
  rng: Rng,
  onAction?: (seat: Seat, payload: ResponsePayload) => void,
): Array<{ t: "respond"; seat: Seat; payload: ResponsePayload }> {
  return s.pending.map((req) => {
    const payload = autobotRespond(s, req, rng);
    onAction?.(req.seat, payload);
    return { t: "respond" as const, seat: req.seat, payload };
  });
}

/** 是否某座位持有某角色（测试断言用） */
export function seatWith(s: GameState, role: string): Seat {
  const st = s.seats.find((x) => x.role === role);
  if (!st) throw new Error(`no ${role}`);
  return st.seat;
}

export function aliveNonWolves(s: GameState): Seat[] {
  return s.seats.filter((x) => x.alive && seatState(s, x.seat).role !== "werewolf").map((x) => x.seat);
}
