// @wt/protocol —— Agent 接入协议的单一事实来源。
// 消息 schema 全部以 zod 定义；docs/PROTOCOL.md 的 JSON Schema 由本包导出生成。
export * from "./common.js";
export * from "./events.js";
export * from "./platform-to-agent.js";
export * from "./agent-to-platform.js";
export * from "./json-schema.js";
