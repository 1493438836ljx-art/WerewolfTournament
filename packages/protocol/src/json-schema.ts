// JSON Schema 导出 —— docs/PROTOCOL.md 与选手侧代码生成由此保持同步。
import { z } from "zod";
import { agentEventSchema } from "./events.js";
import { a2pMessageSchema } from "./agent-to-platform.js";
import { p2aMessageSchema } from "./platform-to-agent.js";

export function protocolJsonSchemas(): Record<string, unknown> {
  return {
    platform_to_agent: z.toJSONSchema(p2aMessageSchema, { target: "draft-2020-12" }),
    agent_to_platform: z.toJSONSchema(a2pMessageSchema, { target: "draft-2020-12" }),
    agent_events: z.toJSONSchema(agentEventSchema, { target: "draft-2020-12" }),
  };
}

/** 序列化为可直接写文件的 JSON 字符串 */
export function protocolJsonSchemasString(pretty = true): string {
  return JSON.stringify(protocolJsonSchemas(), null, pretty ? 2 : 0);
}
