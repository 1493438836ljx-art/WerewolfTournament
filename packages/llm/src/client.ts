// 多供应商 LLM 客户端：anthropic 官方 API 与 OpenAI 兼容端点（DeepSeek/Qwen/GLM/vLLM 等）。
export interface LLMRequest {
  system: string;
  user: string;
  maxTokens: number;
  json?: boolean;
  temperature?: number;
}

export interface LLMResponse {
  text: string;
  usage: { inTok: number; outTok: number };
  provider: string;
  model: string;
}

export interface LLMClientConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** 公告用便宜模型（缺省复用 model） */
  modelAnnounce?: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LLMClientConfig | null {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;
  const provider = env.LLM_PROVIDER === "openai" ? "openai" : "anthropic";
  return {
    provider,
    apiKey,
    baseUrl: env.LLM_BASE_URL || undefined,
    model: env.LLM_MODEL || (provider === "anthropic" ? "claude-sonnet-5" : "gpt-5"),
    modelAnnounce: env.LLM_MODEL_ANNOUNCE || undefined,
  };
}

export class LLMClient {
  constructor(private cfg: LLMClientConfig) {}

  get model() {
    return this.cfg.model;
  }

  async complete(req: LLMRequest, modelOverride?: string): Promise<LLMResponse> {
    const model = modelOverride ?? this.cfg.model;
    if (this.cfg.provider === "anthropic") return this.anthropic(req, model);
    return this.openai(req, model);
  }

  private async anthropic(req: LLMRequest, model: string): Promise<LLMResponse> {
    const base = this.cfg.baseUrl?.replace(/\/$/, "") ?? "https://api.anthropic.com";
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // 官方 API 用 x-api-key；Anthropic 兼容代理端点（如 GLM）多用 Bearer——两者同发，兼容面最广
        "x-api-key": this.cfg.apiKey,
        authorization: `Bearer ${this.cfg.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.7,
        // glm 等模型默认开思考会吃光 token 预算；显式关闭（Anthropic 官方端点不传思考时同样默认关）
        thinking: { type: "disabled" },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    return {
      text,
      usage: { inTok: data.usage?.input_tokens ?? 0, outTok: data.usage?.output_tokens ?? 0 },
      provider: "anthropic",
      model,
    };
  }

  private async openai(req: LLMRequest, model: string): Promise<LLMResponse> {
    const base = this.cfg.baseUrl?.replace(/\/$/, "") ?? "https://api.openai.com/v1";
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.7,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: { inTok: data.usage?.prompt_tokens ?? 0, outTok: data.usage?.completion_tokens ?? 0 },
      provider: "openai",
      model,
    };
  }
}
