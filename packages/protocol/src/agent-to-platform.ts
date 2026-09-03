// Agent → 平台消息。stdout 单行 JSON；响应类消息须回带 in_reply_to 指向请求 msg_id。
import { z } from "zod";
import { a2pEnvelopeSchema, agentNameSchema, seatOrNullSchema, seatSchema, speechTextSchema } from "./common.js";

export const a2pMessageSchema = z.discriminatedUnion("type", [
  // spawn 后就绪宣告（in_reply_to 指向 hello 的 msg_id）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("ready"),
    agent_name: agentNameSchema,
  }),

  // 夜晚行动（in_reply_to -> night_action_request）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("night_action"),
    action: z.discriminatedUnion("as", [
      z.object({ as: z.literal("werewolf"), kill: seatOrNullSchema }),
      z.object({ as: z.literal("seer"), check: seatSchema }),
      z.object({
        as: z.literal("witch"),
        heal: z.boolean(),
        poison: seatOrNullSchema,
      }),
    ]),
  }),

  // 猎人开枪（in_reply_to -> hunter_shoot_request）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("hunter_shoot"),
    shoot: seatOrNullSchema,
  }),

  // 发言（in_reply_to -> day_speech_request / pk_speech_request）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("speech"),
    text: speechTextSchema,
  }),

  // 投票（in_reply_to -> vote_request）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("vote"),
    target: seatOrNullSchema,
  }),

  // 遗言（in_reply_to -> last_words_request）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("last_words"),
    text: speechTextSchema,
  }),

  // Agent 主动上报错误（不影响对局，平台记录进日志）
  z.object({
    ...a2pEnvelopeSchema.shape,
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);

export type A2PMessage = z.infer<typeof a2pMessageSchema>;
