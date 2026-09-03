// 裁判降级链测试：模板模式恒可用；LLM 失败（死端点）降级且熔断计数；仲裁放行不中断。
import { describe, expect, it } from "vitest";
import { LLMClient } from "../src/client.js";
import { Referee, type RefereeDeps } from "../src/referee.js";
import { templateAnnounce } from "../src/announce-template.js";

describe("模板公告", () => {
  it("各事件类型产出文案", () => {
    expect(templateAnnounce({ kind: "night_begun", payload: { night: 1 } })).toContain("第 1 夜");
    expect(templateAnnounce({ kind: "dawn_deaths", payload: { night: 1, deaths: [3, 7] } })).toContain("3 号");
    expect(templateAnnounce({ kind: "dawn_deaths", payload: { night: 1, deaths: [] } })).toContain("平安夜");
    expect(templateAnnounce({ kind: "vote_result", payload: { eliminated: 5, pk_candidates: [] } })).toContain("5 号被放逐");
    expect(templateAnnounce({ kind: "hunter_shot", payload: { by: 6, target: 2 } })).toContain("带走 2 号");
    expect(templateAnnounce({ kind: "win", payload: { faction: "village", reason: "x" } })).toContain("好人阵营");
  });
});

describe("Referee 降级", () => {
  it("template 模式：恒走模板/放行/无 MVP，不触网", async () => {
    const r = new Referee({ client: null, mode: "template" });
    expect(await r.announce("night_begun", { night: 2 })).toContain("第 2 夜");
    const v = await r.arbitrate({ seat: 1, text: "我是 Claude" });
    expect(v.verdict).toBe("ok");
    expect(v.unchecked).toBe(true);
    expect(await r.mvp([])).toBeNull();
  });

  it("LLM 死端点：降级到模板 + 熔断开路后直接降级", async () => {
    // 指向必然拒绝连接的本地端口：fetch 立即抛错
    const client = new LLMClient({
      provider: "openai",
      apiKey: "sk-bad",
      baseUrl: "http://127.0.0.1:1",
      model: "test-model",
    });
    const usage: RefereeDeps["onUsage"] extends never ? never : Array<Record<string, unknown>> = [];
    const r = new Referee({
      client,
      mode: "hybrid",
      onUsage: (u) => usage.push(u as unknown as Record<string, unknown>),
    });

    const t0 = Date.now();
    const a1 = await r.announce("dawn_deaths", { night: 1, deaths: [4] });
    expect(a1).toContain("4 号"); // 降级到模板
    expect(Date.now() - t0).toBeLessThan(5000); // 快速失败，不拖对局
    const v = await r.arbitrate({ seat: 2, text: "x".repeat(500) });
    expect(v.verdict).toBe("ok"); // 放行

    // 连续失败（announce 重试2次=2失败）x 多轮 -> 熔断开路
    await r.announce("night_begun", { night: 2 }).catch(() => "");
    await r.announce("night_begun", { night: 3 }).catch(() => "");
    expect(r.health().breaker.consecutiveFailures).toBeGreaterThanOrEqual(3);
    // 开路后直接降级（不再尝试网络，立即返回模板）
    const t1 = Date.now();
    const a2 = await r.announce("night_begun", { night: 4 });
    expect(a2).toContain("第 4 夜");
    expect(Date.now() - t1).toBeLessThan(100);
    // 失败计量已记录
    expect(usage.some((u) => u.ok === false)).toBe(true);
  }, 30_000);
});
