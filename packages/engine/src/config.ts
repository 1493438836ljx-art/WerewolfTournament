// 对局配置 —— 全部裁定参数可调；默认 9 人局。
import type { Role } from "@wt/protocol";

export interface WitchConfig {
  /** 首夜可自救 */
  firstNightSelfSave: boolean;
  /** 首夜之后不可自救 */
  selfSaveAfterFirstNight: boolean;
  /** 同一夜双药不可同用 */
  bothPotionsSameNight: boolean;
  /** 女巫是否知晓今晚被刀者 */
  seesKillTarget: boolean;
}

export interface HunterConfig {
  /** 被毒死不可开枪（标准规则固定 true，留开关供变体） */
  canShootWhenPoisoned: boolean;
}

export interface LastWordsConfig {
  /** 夜晚死亡遗言：首夜 only / 全部 / 无 */
  night: "first_night_only" | "all" | "none";
  /** 白天被放逐必有遗言 */
  dayElimination: "always" | "none";
  /** 被枪杀者无遗言（标准规则固定 false=无遗言） */
  shotVictimGetsLastWords: boolean;
}

export interface VoteConfig {
  /** 平票处理：PK 辩词后由非候选者再投票 */
  tie: "pk_speech_then_revote" | "no_elimination";
  /** 再投票仍平 → 当日平安日 */
  revoteTie: "no_elimination";
  /** PK 候选人不参与再投票 */
  pkCandidatesCanVote: boolean;
  abstainAllowed: boolean;
}

export interface SheriffConfig {
  /** 第 1 天警长竞选（上警发言 + 投票当选） */
  enabled: boolean;
  /** 警长放逐投票权重（1.5 票） */
  extraVote: number;
  /** 警长死亡时可移交警徽（false = 自动撕徽） */
  transferOnDeath: boolean;
}

export interface TimeoutsMs {
  night_action: number;
  speech: number;
  vote: number;
  last_words: number;
  hunter: number;
}

export interface GameConfig {
  playerCount: number;
  roleSet: Partial<Record<Role, number>>;
  /** 屠边（默认）| 屠城 */
  winCondition: "kill_side" | "kill_all";
  witch: WitchConfig;
  hunter: HunterConfig;
  lastWords: LastWordsConfig;
  vote: VoteConfig;
  sheriff: SheriffConfig;
  /** 每个白天的发言轮数（1=单轮，2=陈述+反驳） */
  speechRounds: 1 | 2;
  timeoutsMs: TimeoutsMs;
  speechCharLimit: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  playerCount: 9,
  roleSet: { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1 },
  winCondition: "kill_side",
  witch: {
    firstNightSelfSave: true,
    selfSaveAfterFirstNight: false,
    bothPotionsSameNight: true,
    seesKillTarget: true,
  },
  hunter: { canShootWhenPoisoned: false },
  lastWords: { night: "first_night_only", dayElimination: "always", shotVictimGetsLastWords: false },
  vote: { tie: "pk_speech_then_revote", revoteTie: "no_elimination", pkCandidatesCanVote: false, abstainAllowed: false },
  sheriff: { enabled: true, extraVote: 1.5, transferOnDeath: true },
  speechRounds: 2,
  timeoutsMs: { night_action: 45000, speech: 90000, vote: 45000, last_words: 60000, hunter: 45000 },
  speechCharLimit: 2000,
};

/** 校验配置合法性（人数、角色数量、板型可玩性） */
export function validateConfig(c: GameConfig): string[] {
  const errs: string[] = [];
  const total = Object.values(c.roleSet).reduce((a, b) => a + (b ?? 0), 0);
  if (total !== c.playerCount) errs.push(`roleSet 总数 ${total} != playerCount ${c.playerCount}`);
  if (c.playerCount < 6 || c.playerCount > 12) errs.push("playerCount 须在 6..12");
  if ((c.roleSet.werewolf ?? 0) < 1) errs.push("至少 1 狼");
  if ((c.roleSet.villager ?? 0) + ((c.roleSet.seer ?? 0) + (c.roleSet.witch ?? 0) + (c.roleSet.hunter ?? 0)) < 1)
    errs.push("至少 1 名好人");
  if ((c.roleSet.werewolf ?? 0) >= c.playerCount) errs.push("狼数须少于总人数");
  return errs;
}
