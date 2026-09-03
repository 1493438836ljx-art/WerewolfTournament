// 平台 LLM 代理：沙箱内选手 agent 的唯一 LLM 出口（OpenAI 兼容 /chat/completions）。
// 职责：token 校验、模型白名单、按 agent 限速与 token 预算、计量入库（成本审计）。
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { LLMClient, type LLMClientConfig } from "@wt/llm";
import { db } from "./db/index.js";
import { llmCalls } from "./db/schema.js";

export interface LlmProxyState {
  url: string; // 例如 http://127.0.0.1:3000/llm
  token: string;
  model?: string;
  dailyTokenBudget: number;
}

interface AgentBudget {
  tokens: number;
  windowStart: number;
  requests: number;
}

const RPM_LIMIT = 30;

export function createLlmProxy(app: FastifyInstance, cfg: LLMClientConfig | null): LlmProxyState | null {
  if (!cfg) return null; // 未配置裁判 LLM 则不启用代理（agent 侧自然降级）

  const client = new LLMClient(cfg);
  const state: LlmProxyState = {
    url: `/llm`,
    token: randomBytes(16).toString("hex"),
    model: process.env.WT_AGENT_LLM_MODEL || cfg.model,
    dailyTokenBudget: Number(process.env.WT_AGENT_LLM_DAILY_TOKEN_BUDGET ?? 2_000_000),
  };
  const budgets = new Map<string, AgentBudget>(); // key: proxy token 对应 agent（这里按 bearer 细分）

  app.addHook("onReady", () => {
    app.log.info(`LLM 代理已启用：POST /llm/chat/completions（模型 ${state.model}，预算 ${state.dailyTokenBudget}/日）`);
  });

  app.post("/llm/chat/completions", async (req, reply) => {
    const auth = req.headers.authorization;
    // 主 token（平台注入给 agent 的）；也接受细分 token：<main>:<agentId>
    const bearer = auth?.replace(/^Bearer\s+/i, "") ?? "";
    const [main, agentId] = bearer.split(":");
    if (main !== state.token) {
      app.log.warn(`llmproxy 401: token=${bearer.slice(0, 12)}... agentId=${agentId}`);
      return reply.code(401).send({ error: "invalid token" });
    }

    const body = (req.body ?? {}) as {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      max_tokens?: number;
    };
    // 模型白名单：只允许平台指定模型（忽略 agent 自带 model 名或拒绝）
    if (body.model && body.model !== "default" && body.model !== state.model) {
      app.log.warn(`llmproxy 403: model=${body.model} allowed=${state.model}`);
      return reply.code(403).send({ error: `model not allowed, use ${state.model}` });
    }
    if (!body.messages?.length) {
      app.log.warn(`llmproxy 400: empty messages from ${agentId}`);
      return reply.code(400).send({ error: "messages required" });
    }

    // 预算与限速
    const key = agentId ?? "anon";
    const now = Date.now();
    const b = budgets.get(key) ?? { tokens: 0, windowStart: now, requests: 0 };
    if (now - b.windowStart > 86_400_000) {
      b.tokens = 0;
      b.windowStart = now;
      b.requests = 0;
    }
    if (b.tokens >= state.dailyTokenBudget) return reply.code(429).send({ error: "daily token budget exhausted" });
    if (now - b.windowStart < 60_000 && b.requests >= RPM_LIMIT) {
      return reply.code(429).send({ error: "rate limit" });
    }
    b.requests++;
    budgets.set(key, b);

    const userMsg = body.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const systemMsg = body.messages.find((m) => m.role === "system")?.content ?? "";
    const t0 = Date.now();
    try {
      const res = await client.complete({
        system: systemMsg || "你是狼人杀玩家 agent 的推理引擎。",
        user: userMsg,
        maxTokens: Math.min(body.max_tokens ?? 600, 1000),
        temperature: 0.8,
      });
      b.tokens += res.usage.inTok + res.usage.outTok;
      void db
        .insert(llmCalls)
        .values({
          agentId: key === "anon" ? null : key,
          purpose: "agent_proxy",
          provider: res.provider,
          model: res.model,
          inTokens: res.usage.inTok,
          outTokens: res.usage.outTok,
          latencyMs: Date.now() - t0,
          ok: true,
        })
        .catch(() => {});
      return {
        id: `chatcmpl-${randomBytes(6).toString("hex")}`,
        object: "chat.completion",
        model: res.model,
        choices: [{ index: 0, message: { role: "assistant", content: res.text }, finish_reason: "stop" }],
        usage: { prompt_tokens: res.usage.inTok, completion_tokens: res.usage.outTok, total_tokens: res.usage.inTok + res.usage.outTok },
      };
    } catch (e) {
      void db
        .insert(llmCalls)
        .values({ agentId: key === "anon" ? null : key, purpose: "agent_proxy", provider: "unknown", model: state.model ?? "", latencyMs: Date.now() - t0, ok: false })
        .catch(() => {});
      return reply.code(502).send({ error: `upstream failed: ${e instanceof Error ? e.message : e}` });
    }
  });

  return state;
}

/** 给沙箱注入的连接信息（token 已按 agent 细分以便计量；字段名与 SandboxContext 对齐） */
export function proxyForAgent(state: LlmProxyState, host: string, agentId: string) {
  return {
    llmProxyUrl: `http://${host}/llm`,
    llmProxyToken: `${state.token}:${agentId}`,
    llmProxyModel: state.model,
  };
}
