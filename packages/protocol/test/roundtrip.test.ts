// 协议 roundtrip 测试：合法样例必须通过、非法样例必须被拒。
// 样例同时充当协议文档的可执行示例。
import { describe, expect, it } from "vitest";
import { p2aMessageSchema } from "../src/platform-to-agent.js";
import { a2pMessageSchema } from "../src/agent-to-platform.js";
import { agentEventSchema } from "../src/events.js";
import { protocolJsonSchemas } from "../src/json-schema.js";

const env = { v: 1, msg_id: "m1", game_id: "g1", ts: "2026-09-02T00:00:00Z" };
const reply = { v: 1, in_reply_to: "m1" };

describe("platform -> agent", () => {
  it("hello / game_start / game_end 通过", () => {
    expect(
      p2aMessageSchema.parse({ ...env, type: "hello", you: { agent_id: "a1" }, protocol_version: "1.0" }),
    ).toMatchObject({ type: "hello" });

    expect(
      p2aMessageSchema.parse({
        ...env,
        type: "game_start",
        you: { seat: 3, role: "werewolf", faction: "werewolf", wolf_teammates: [1, 7] },
        config: {
          player_count: 9,
          role_set: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 },
          win_condition: "kill_side",
          speech_char_limit: 2000,
          timeouts_ms: { night_action: 20000, speech: 60000, vote: 15000, last_words: 30000, hunter: 20000 },
        },
        players: Array.from({ length: 9 }, (_, i) => ({ seat: i + 1, name: `bot${i + 1}` })),
      }),
    ).toMatchObject({ type: "game_start", you: { seat: 3 } });

    expect(
      p2aMessageSchema.parse({
        ...env,
        type: "game_end",
        winner: "village",
        your_team_won: false,
        reveal: [{ seat: 3, role: "werewolf", faction: "werewolf" }],
      }),
    ).toMatchObject({ type: "game_end" });
  });

  it("夜行动作请求按角色分发", () => {
    for (const options of [
      { as: "werewolf", teammates: [{ seat: 1, alive: true }], kill_targets: [2, 5, null] },
      { as: "seer", unchecked: [2, 4], history: [{ night: 1, target: 5, result: "wolf" }] },
      { as: "witch", killed_tonight: 4, heal_available: true, poison_available: true, can_self_heal: false, heal_blocks_poison: true },
    ]) {
      expect(
        p2aMessageSchema.parse({
          ...env,
          type: "night_action_request",
          night: 2,
          alive: [1, 2, 3, 4, 6, 8],
          timeout_ms: 20000,
          role: options.as,
          options,
        }),
      ).toMatchObject({ type: "night_action_request" });
    }
  });

  it("发言/投票/遗言/猎人请求通过", () => {
    const cases = [
      { ...env, type: "day_speech_request", day: 1, order: [4, 5, 6], alive: [1, 2, 3], char_limit: 2000, timeout_ms: 60000 },
      { ...env, type: "pk_speech_request", day: 1, candidates: [2, 7], alive: [1, 2, 3, 7], char_limit: 2000, timeout_ms: 30000 },
      { ...env, type: "vote_request", day: 1, round: 1, candidates: [2, 7], abstain_allowed: false, alive: [1, 2, 3, 7], timeout_ms: 15000 },
      { ...env, type: "last_words_request", cause: "vote", alive: [1, 2, 3], timeout_ms: 30000 },
      { ...env, type: "hunter_shoot_request", reason: "vote", alive: [1, 2, 3], shoot_targets: [1, 2], timeout_ms: 20000 },
    ];
    for (const c of cases) expect(p2aMessageSchema.parse(c)).toMatchObject({ type: c.type });
  });

  it("notify 携带可见事件", () => {
    expect(
      p2aMessageSchema.parse({
        ...env,
        type: "notify",
        event: { kind: "seer_result", night: 1, target: 5, result: "wolf" },
      }),
    ).toMatchObject({ type: "notify" });
  });

  it("非法样例被拒", () => {
    // 信封缺 game_id
    expect(() =>
      p2aMessageSchema.parse({ v: 1, msg_id: "m", ts: "t", type: "hello", you: { agent_id: "a" }, protocol_version: "1.0" }),
    ).toThrow();
    // 座位越界
    expect(() =>
      p2aMessageSchema.parse({ ...env, type: "vote_request", day: 1, round: 1, candidates: [99], abstain_allowed: false, alive: [1], timeout_ms: 1000 }),
    ).toThrow();
    // 未知角色
    expect(() =>
      p2aMessageSchema.parse({ ...env, type: "night_action_request", night: 1, alive: [1], timeout_ms: 1000, role: "guard", options: { as: "guard" } }),
    ).toThrow();
  });
});

describe("agent -> platform", () => {
  it("ready / night_action / speech / vote / last_words / hunter_shoot 通过", () => {
    const cases = [
      { ...reply, type: "ready", agent_name: "my-bot" },
      { ...reply, type: "night_action", action: { as: "werewolf", kill: 4 } },
      { ...reply, type: "night_action", action: { as: "werewolf", kill: null } },
      { ...reply, type: "night_action", action: { as: "seer", check: 5 } },
      { ...reply, type: "night_action", action: { as: "witch", heal: true, poison: null } },
      { ...reply, type: "hunter_shoot", shoot: 7 },
      { ...reply, type: "speech", text: "我是好人，过" },
      { ...reply, type: "vote", target: 7 },
      { ...reply, type: "vote", target: null },
      { ...reply, type: "last_words", text: "我是预言家，昨晚验了5号是狼" },
      { ...reply, type: "error", code: "E_INTERNAL", message: "boom" },
    ];
    for (const c of cases) expect(a2pMessageSchema.parse(c)).toMatchObject({ type: c.type });
  });

  it("非法样例被拒", () => {
    expect(() => a2pMessageSchema.parse({ ...reply, type: "speech" })).toThrow(); // 缺 text
    expect(() => a2pMessageSchema.parse({ ...reply, type: "vote", target: "seat-7" })).toThrow(); // 类型错
    expect(() => a2pMessageSchema.parse({ v: 2, in_reply_to: "m", type: "vote", target: 1 })).toThrow(); // 版本不符
  });
});

describe("json schema 导出", () => {
  it("三个 schema 可导出且含 discriminated union", () => {
    const s = protocolJsonSchemas();
    expect(s["platform_to_agent"]).toBeDefined();
    expect(s["agent_to_platform"]).toBeDefined();
    expect(s["agent_events"]).toBeDefined();
    expect(JSON.stringify(s)).toContain("night_action_request");
  });
});

describe("agent events", () => {
  it("各类事件通过", () => {
    const events = [
      { kind: "night_begun", night: 1 },
      { kind: "dawn_deaths", night: 1, deaths: [4, 8] },
      { kind: "dawn_deaths", night: 2, deaths: [] },
      { kind: "speech_heard", day: 1, seat: 2, speech_kind: "speech", text: "我认为3号有问题" },
      { kind: "vote_result", day: 1, round: 1, tally: [{ voter: 1, target: 3 }], eliminated: 3 },
      { kind: "hunter_shot", by: 6, target: 2 },
      { kind: "seer_result", night: 2, target: 6, result: "human" },
      { kind: "your_timeout", which: "speech" },
    ];
    for (const e of events) expect(agentEventSchema.parse(e)).toMatchObject({ kind: e.kind });
    expect(() => agentEventSchema.parse({ kind: "dawn_deaths", night: 0, deaths: [] })).toThrow();
  });
});
