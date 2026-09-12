// Agent 可见事件（notify.event 的类型）—— 信息隔离的最小粒度。
// 平台发给某座位的事件集合由引擎 visibility 模块裁定；本文件只定义形状。
import { z } from "zod";
import { seatListSchema, seatOrNullSchema, seatSchema, seerResultSchema, speechTextSchema } from "./common.js";

export const agentEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("night_begun"),
    night: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal("dawn_deaths"),
    /** 当夜死亡的座位列表（不含死因）。平安夜为空数组 */
    night: z.number().int().min(1),
    deaths: seatListSchema,
  }),
  z.object({
    kind: z.literal("speech_heard"),
    day: z.number().int().min(1),
    seat: seatSchema,
    speech_kind: z.enum(["speech", "pk", "campaign", "last_words"]),
    /** 两轮制下的发言轮次 */
    round: z.number().int().min(1).max(2).optional(),
    text: speechTextSchema,
  }),
  z.object({
    kind: z.literal("sheriff_elected"),
    day: z.number().int().min(1),
    /** 当选警长；null = 平票无人当选（本局无警徽） */
    seat: seatOrNullSchema,
    tally: z.array(z.object({ voter: seatSchema, target: seatOrNullSchema })).optional(),
  }),
  z.object({
    kind: z.literal("sheriff_transfer"),
    /** 移交者（原警长，已死亡） */
    from: seatSchema,
    /** 接受者；null = 撕掉警徽 */
    to: seatOrNullSchema,
  }),
  z.object({
    kind: z.literal("vote_result"),
    day: z.number().int().min(1),
    round: z.number().int().min(1),
    /** 警长竞选投票（与放逐投票区分） */
    sheriff: z.boolean().optional(),
    /** 逐一公开票型（voter -> target） */
    tally: z.array(z.object({ voter: seatSchema, target: seatOrNullSchema })),
    /** 被放逐的座位；平安日/未决为 null */
    eliminated: seatOrNullSchema,
    /** 平票进入 PK 的候选人 */
    pk_candidates: seatListSchema.optional(),
  }),
  z.object({
    kind: z.literal("hunter_shot"),
    by: seatSchema,
    target: seatOrNullSchema,
  }),
  z.object({
    kind: z.literal("wolf_kill_locked"),
    night: z.number().int().min(1),
    /** 本夜刀口（含 null=空刀）；仅狼人可见 */
    target: seatOrNullSchema,
  }),
  z.object({
    kind: z.literal("seer_result"),
    night: z.number().int().min(1),
    target: seatSchema,
    result: seerResultSchema,
  }),
  z.object({
    kind: z.literal("player_disqualified"),
    seat: seatSchema,
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("your_timeout"),
    /** 自己哪个动作超时被平台默认 */
    which: z.enum(["night_action", "speech", "vote", "last_words", "hunter"]),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
