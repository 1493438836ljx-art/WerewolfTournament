// 超时默认动作 —— 保证比赛永不死锁。默认动作记 timeout_default 事件并计 penalty。
import type { ResponsePayload } from "./types.js";
import type { PendingRequest } from "./types.js";
import type { Rng } from "./rng.js";

export const TIMEOUT_SPEECH_TEXT = "（超时未发言）";
export const TIMEOUT_LAST_WORDS_TEXT = "（无遗言）";

export function defaultAction(req: PendingRequest, rng: Rng): ResponsePayload {
  switch (req.kind) {
    case "wolf_kill": {
      const firstTarget = req.killTargets.find((t) => t !== null);
      return { t: "wolf_kill", kill: firstTarget ?? null };
    }
    case "seer_check":
      return { t: "seer_check", check: req.unchecked.length ? rng.pick(req.unchecked) : req.alive[0]! };
    case "witch_action":
      return { t: "witch_action", heal: false, poison: null };
    case "hunter_shoot":
      return { t: "hunter_shoot", shoot: null };
    case "speech":
      return { t: "speech", text: TIMEOUT_SPEECH_TEXT };
    case "vote": {
      if (req.abstainAllowed) return { t: "vote", target: null };
      return { t: "vote", target: req.candidates[0]! };
    }
    case "last_words":
      return { t: "last_words", text: TIMEOUT_LAST_WORDS_TEXT };
  }
}
