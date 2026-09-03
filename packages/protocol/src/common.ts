// 基础类型与公共信封 —— 全部以 zod 定义，类型由 schema 推导。
import { z } from "zod";

export const PROTOCOL_VERSION = "1.0";
/** 协议主版本号，随每条消息传递；不兼容变更时递增 */
export const PROTOCOL_MAJOR = 1;

/** 单行 JSON 上限（字节）。超限按违规处理 */
export const MAX_LINE_BYTES = 64 * 1024;

/** 座位号，1 起始（1..12 覆盖未来更大板型） */
export const seatSchema = z.number().int().min(1).max(12);
export type Seat = z.infer<typeof seatSchema>;

export const seatListSchema = z.array(seatSchema);
export const seatOrNullSchema = seatSchema.nullable();

/** 角色 */
export const roleSchema = z.enum(["werewolf", "seer", "witch", "hunter", "villager"]);
export type Role = z.infer<typeof roleSchema>;

/** 阵营：狼人 / 好人（神职与平民同属 village） */
export const factionSchema = z.enum(["werewolf", "village"]);
export type Faction = z.infer<typeof factionSchema>;

/** 查验结果（预言家） */
export const seerResultSchema = z.enum(["wolf", "human"]);
export type SeerResult = z.infer<typeof seerResultSchema>;

export const agentNameSchema = z.string().min(1).max(64);

/** 发言文本：协议硬上限 4000 字符，实际以请求内 char_limit 为准 */
export const speechTextSchema = z.string().max(4000);

/** 平台 → Agent 消息公共信封 */
export const p2aEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_MAJOR),
  msg_id: z.string().min(1),
  game_id: z.string().min(1),
  ts: z.string().min(1),
});
export type P2AEnvelope = z.infer<typeof p2aEnvelopeSchema>;

/** Agent → 平台消息公共信封 */
export const a2pEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_MAJOR),
  in_reply_to: z.string().min(1),
});
export type A2PEnvelope = z.infer<typeof a2pEnvelopeSchema>;

/** 选手可见的游戏配置（game_start 附带；内部裁定参数不在此暴露） */
export const publicGameConfigSchema = z.object({
  player_count: z.number().int().min(6).max(12),
  role_set: z.record(z.string(), z.number().int().min(0)),
  win_condition: z.enum(["kill_side", "kill_all"]),
  speech_char_limit: z.number().int().min(50).max(4000),
  timeouts_ms: z.object({
    night_action: z.number().int().min(1000),
    speech: z.number().int().min(1000),
    vote: z.number().int().min(1000),
    last_words: z.number().int().min(1000),
    hunter: z.number().int().min(1000),
  }),
});
export type PublicGameConfig = z.infer<typeof publicGameConfigSchema>;
