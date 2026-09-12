// 裁判服务单例：@wt/llm Referee 的 server 侧封装。
// LLM 对接配置三级来源：settings 表（页面配置，权威）> 环境变量（默认）> 无（模板模式）。
// 页面更新配置后动态重建 client，即时生效（同时联动 LLM 代理）。
import { LLMClient, Referee, llmConfigFromEnv, type LLMClientConfig, type RefereeMode } from "@wt/llm";
import { db } from "./db/index.js";
import { llmCalls } from "./db/schema.js";
import { getSetting, setSetting } from "./settings.js";

const KEY_LLM = "llmConfig";

export interface LlmConfigInput {
  provider: "anthropic" | "openai";
  apiKey: string;
  baseUrl?: string;
  model: string;
  modelAnnounce?: string;
}

let referee: Referee | null = null;
let currentCfg: LLMClientConfig | null = null;
/** 配置更新回调（llmproxy 注册，联动重建代理客户端） */
let onConfigChange: ((cfg: LLMClientConfig | null) => void) | null = null;

function applyClient() {
  if (!referee) return;
  referee.setClient(currentCfg ? new LLMClient(currentCfg) : null);
  onConfigChange?.(currentCfg);
}

/** 启动初始化：env 为底，settings 覆盖 */
export async function initReferee(): Promise<void> {
  const envCfg = llmConfigFromEnv();
  const saved = await getSetting<Partial<LlmConfigInput> | null>(KEY_LLM, null);
  currentCfg = mergeCfg(envCfg, saved);
  const mode: RefereeMode = (process.env.REFEREE_MODE as RefereeMode) || (currentCfg ? "hybrid" : "template");
  referee = new Referee({
    client: currentCfg ? new LLMClient(currentCfg) : null,
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
}

function mergeCfg(base: LLMClientConfig | null, patch: Partial<LlmConfigInput> | null): LLMClientConfig | null {
  if (!patch || !patch.apiKey) return base; // 未配置或未存 key -> 沿用 env
  return {
    provider: patch.provider === "openai" ? "openai" : "anthropic",
    apiKey: patch.apiKey,
    baseUrl: patch.baseUrl || undefined,
    model: patch.model || "claude-sonnet-5",
    modelAnnounce: patch.modelAnnounce || undefined,
  };
}

/** 页面更新配置（partial.apiKey 留空 = 保留现值）；即时生效并持久化 */
export async function setLlmConfig(patch: {
  provider?: "anthropic" | "openai";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  modelAnnounce?: string;
}): Promise<LlmConfigInput | null> {
  const prev = currentCfg;
  const next: LLMClientConfig | null = prev
    ? {
        provider: (patch.provider as LLMClientConfig["provider"]) ?? prev.provider,
        apiKey: patch.apiKey?.trim() || prev.apiKey,
        baseUrl: patch.baseUrl !== undefined ? patch.baseUrl || undefined : prev.baseUrl,
        model: patch.model?.trim() || prev.model,
        modelAnnounce: patch.modelAnnounce !== undefined ? patch.modelAnnounce || undefined : prev.modelAnnounce,
      }
    : patch.apiKey?.trim()
      ? {
          provider: (patch.provider as LLMClientConfig["provider"]) ?? "anthropic",
          apiKey: patch.apiKey.trim(),
          baseUrl: patch.baseUrl || undefined,
          model: patch.model?.trim() || "claude-sonnet-5",
          modelAnnounce: patch.modelAnnounce || undefined,
        }
      : null;
  currentCfg = next;
  await setSetting(KEY_LLM, next as unknown as object);
  applyClient();
  return safeConfig();
}

/** 脱敏视图（页面展示；不回传完整 key） */
export function safeConfig(): LlmConfigInput | null {
  if (!currentCfg) return null;
  return {
    provider: currentCfg.provider,
    apiKey: "",
    baseUrl: currentCfg.baseUrl ?? "",
    model: currentCfg.model,
    modelAnnounce: currentCfg.modelAnnounce ?? "",
  };
}
export function apiKeyTail(): string {
  if (!currentCfg) return "";
  return currentCfg.apiKey.slice(-4);
}

/** LLM 代理注册联动（配置变化时同步代理上游） */
export function registerLlmConfigListener(fn: (cfg: LLMClientConfig | null) => void) {
  onConfigChange = fn;
}

/** 用当前配置做一次最小连通性测试 */
export async function testLlmConnection(): Promise<{ ok: boolean; latencyMs: number; detail?: string; model?: string }> {
  if (!currentCfg) return { ok: false, latencyMs: 0, detail: "未配置" };
  const client = new LLMClient(currentCfg);
  const t0 = Date.now();
  try {
    const r = await client.complete({ system: "你是连通性测试。", user: "只输出：OK", maxTokens: 10, temperature: 0 });
    return { ok: true, latencyMs: Date.now() - t0, model: r.model };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

export function getReferee(): Referee {
  if (!referee) throw new Error("referee not initialized");
  return referee;
}

export function refereeHealth() {
  return getReferee().health();
}

export function setRefereeMode(mode: RefereeMode) {
  getReferee().setMode(mode);
}

export type { RefereeMode };
