// 裁判服务单例：@wt/llm Referee 的 server 侧封装（计量入库）。
import { LLMClient, llmConfigFromEnv, Referee, type RefereeMode } from "@wt/llm";
import { db } from "./db/index.js";
import { llmCalls } from "./db/schema.js";

let referee: Referee | null = null;

export function initReferee(): Referee {
  if (referee) return referee;
  const cfg = llmConfigFromEnv();
  const client = cfg ? new LLMClient(cfg) : null;
  const mode: RefereeMode = (process.env.REFEREE_MODE as RefereeMode) || (client ? "hybrid" : "template");
  referee = new Referee({
    client,
    mode,
    onUsage: (u) => {
      void db
        .insert(llmCalls)
        .values({
          purpose: u.purpose,
          provider: u.provider,
          model: u.model,
          inTokens: u.inTok,
          outTokens: u.outTok,
          latencyMs: u.latencyMs,
          ok: u.ok,
        })
        .catch(() => {});
    },
  });
  return referee;
}

export function getReferee(): Referee {
  return initReferee();
}

export function refereeHealth() {
  return initReferee().health();
}

export function setRefereeMode(mode: RefereeMode) {
  initReferee().setMode(mode);
}

export type { RefereeMode };
