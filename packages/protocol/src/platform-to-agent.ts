// 平台 → Agent 消息。每条为 stdin 上的单行 JSON，公共信封字段与具体消息字段平铺合并。
import { z } from "zod";
import {
  p2aEnvelopeSchema,
  factionSchema,
  agentNameSchema,
  publicGameConfigSchema,
  PROTOCOL_VERSION,
  seatListSchema,
  seatOrNullSchema,
  seatSchema,
  roleSchema,
  speechTextSchema,
} from "./common.js";
import { agentEventSchema } from "./events.js";

/** 玩家档案（game_start 附带） */
const playerInfoSchema = z.object({
  seat: seatSchema,
  name: agentNameSchema,
});

export const p2aMessageSchema = z.discriminatedUnion("type", [
  // ---- 生命周期 ----
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("hello"),
    you: z.object({ agent_id: z.string() }),
    protocol_version: z.literal(PROTOCOL_VERSION),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("game_start"),
    you: z.object({
      seat: seatSchema,
      role: roleSchema,
      faction: factionSchema,
      /** 仅狼人身份附带：队友座位 */
      wolf_teammates: seatListSchema.optional(),
    }),
    config: publicGameConfigSchema,
    players: z.array(playerInfoSchema).min(1),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("game_end"),
    winner: factionSchema,
    your_team_won: z.boolean(),
    /** 全员翻牌 */
    reveal: z.array(z.object({ seat: seatSchema, role: roleSchema, faction: factionSchema })),
    /** 裁判复盘（模板或 LLM 生成，可缺省） */
    summary: z.string().optional(),
  }),

  // ---- 行动请求（均附带当前存活座位，避免 agent 自行推导出错）----
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("night_action_request"),
    night: z.number().int().min(1),
    alive: seatListSchema,
    timeout_ms: z.number().int().min(1000),
    role: roleSchema,
    /** 按角色显式给出可选项，agent 无需自行推断合法性 */
    options: z.discriminatedUnion("as", [
      z.object({
        as: z.literal("werewolf"),
        teammates: z.array(z.object({ seat: seatSchema, alive: z.boolean() })),
        /** 合法击杀目标（含 null=空刀） */
        kill_targets: z.array(seatOrNullSchema),
      }),
      z.object({
        as: z.literal("seer"),
        unchecked: seatListSchema,
        history: z.array(
          z.object({
            night: z.number().int().min(1),
            target: seatSchema,
            result: z.enum(["wolf", "human"]),
          }),
        ),
      }),
      z.object({
        as: z.literal("witch"),
        /** 今晚被刀的座位（女巫知情）；空刀/已被守卫则 null */
        killed_tonight: seatOrNullSchema,
        heal_available: z.boolean(),
        poison_available: z.boolean(),
        can_self_heal: z.boolean(),
        heal_blocks_poison: z.boolean(),
      }),
    ]),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("hunter_shoot_request"),
    /** 开枪诱因：夜晚被刀 / 白天被放逐 / 被其他猎人枪杀（被毒死不会收到此请求） */
    reason: z.enum(["wolf", "vote", "shot"]),
    alive: seatListSchema,
    /** 合法目标（不含自己） */
    shoot_targets: seatListSchema,
    timeout_ms: z.number().int().min(1000),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("day_speech_request"),
    day: z.number().int().min(1),
    /** 本轮发言顺序（完整座位序列） */
    order: seatListSchema,
    alive: seatListSchema,
    char_limit: z.number().int().min(1),
    timeout_ms: z.number().int().min(1000),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("pk_speech_request"),
    day: z.number().int().min(1),
    candidates: seatListSchema,
    alive: seatListSchema,
    char_limit: z.number().int().min(1),
    timeout_ms: z.number().int().min(1000),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("vote_request"),
    day: z.number().int().min(1),
    round: z.number().int().min(1),
    candidates: seatListSchema,
    abstain_allowed: z.boolean(),
    alive: seatListSchema,
    timeout_ms: z.number().int().min(1000),
  }),
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("last_words_request"),
    cause: z.enum(["night", "vote"]),
    alive: seatListSchema,
    timeout_ms: z.number().int().min(1000),
  }),

  // ---- 事件通知 ----
  z.object({
    ...p2aEnvelopeSchema.shape,
    type: z.literal("notify"),
    event: agentEventSchema,
  }),
]);

export type P2AMessage = z.infer<typeof p2aMessageSchema>;

/** 按消息类型提取 */
export type NightActionRequest = Extract<P2AMessage, { type: "night_action_request" }>;
export type SpeechRequest = Extract<P2AMessage, { type: "day_speech_request" | "pk_speech_request" }>;
export type VoteRequest = Extract<P2AMessage, { type: "vote_request" }>;
