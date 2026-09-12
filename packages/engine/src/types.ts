// 引擎核心类型。引擎是纯函数集合：无 IO、无时钟；全部随机性走 state.rngState（可重放）。
import type { Faction, Role, Seat } from "@wt/protocol";
import type { GameConfig } from "./config.js";
import type { RngState } from "./rng.js";

// ---------- 可见性 ----------
export type Visibility = "public" | { seats: Seat[] };

/** 引擎事实事件：只记录"发生了什么"，可见性标签决定谁能看到 */
export interface EngineEvent<P = unknown> {
  seq: number;
  kind: EngineEventKind;
  payload: P;
  visibility: Visibility;
}

export type EngineEventKind =
  | "game_started"
  | "night_begun"
  | "speech_order"
  | "sheriff_elected"
  | "sheriff_transfer"
  | "wolf_target_locked"
  | "seer_result"
  | "witch_heal_used"
  | "witch_poison_used"
  | "dawn_deaths"
  | "speech"
  | "last_words"
  | "vote_result"
  | "hunter_shot"
  | "player_disqualified"
  | "timeout_default"
  | "win"
  | "reveal";

export type DeathCause = "wolf" | "poison" | "vote" | "hunter" | "disqualify";

export interface SeatState {
  seat: Seat;
  agentId: string;
  name: string;
  role: Role;
  faction: Faction;
  alive: boolean;
  death?: { cause: DeathCause; turn: number; night?: number };
}

// ---------- 阶段 ----------
export type Phase =
  | { t: "night"; no: number }
  /** 夜间结算：猎人枪/遗言/警徽移交 按队列依次处理 */
  | { t: "dawn"; no: number; queue: DawnQueueItem[] }
  | {
      t: "day";
      no: number;
      step:
        | "campaign_run"
        | "campaign_speech"
        | "sheriff_vote"
        | "sheriff_pk_speech"
        | "sheriff_revote"
        | "speech"
        | "pk_speech"
        | "vote"
        | "revote"
        | "aftermath";
      order?: Seat[];
      cursor?: number;
      pkCandidates?: Seat[];
      /** 两轮发言的当前轮次（1=陈述，2=反驳） */
      speechRound?: number;
      /** aftermath：出局遗言 + 猎人枪 + 警徽移交 的待处理队列 */
      queue?: DawnQueueItem[];
      /** 本轮投票请求是否已发出（收齐判定用） */
      voteIssued?: boolean;
      voteRound?: number;
    }
  | { t: "game_over" };

export type DawnQueueItem =
  | { kind: "hunter"; seat: Seat; reason: "wolf" | "vote" | "shot" }
  | { kind: "last_words"; seat: Seat; cause: "night" | "vote" }
  | { kind: "sheriff_transfer"; seat: Seat };

// ---------- pending 请求（引擎等待的外部输入；编排器翻译成协议消息）----------
export interface AliveInfo {
  alive: Seat[];
}

export type PendingRequest = (
  | { kind: "wolf_kill"; night: number; teammates: Array<{ seat: Seat; alive: boolean }>; killTargets: (Seat | null)[] }
  | {
      kind: "seer_check";
      night: number;
      unchecked: Seat[];
      history: Array<{ night: number; target: Seat; result: "wolf" | "human" }>;
    }
  | {
      kind: "witch_action";
      night: number;
      killedTonight: Seat | null;
      healAvailable: boolean;
      poisonAvailable: boolean;
      canSelfHeal: boolean;
      healBlocksPoison: boolean;
    }
  | { kind: "hunter_shoot"; reason: "wolf" | "vote" | "shot"; targets: Seat[] }
  | { kind: "speech"; day: number; order: Seat[]; pk: boolean; round: number }
  | { kind: "vote"; day: number; round: number; candidates: Seat[]; abstainAllowed: boolean; sheriffVote: boolean }
  | { kind: "last_words"; cause: "night" | "vote" }
  | { kind: "sheriff_campaign"; candidates: Seat[] }
  | { kind: "sheriff_speech"; order: Seat[] }
  | { kind: "sheriff_vote"; candidates: Seat[]; abstainAllowed: boolean }
  | { kind: "sheriff_transfer"; targets: Seat[] }
) &
  AliveInfo & { seat: Seat };

/** agent 对 pending 请求的响应载荷（引擎按请求 kind 匹配校验） */
export type ResponsePayload =
  | { t: "wolf_kill"; kill: Seat | null }
  | { t: "seer_check"; check: Seat }
  | { t: "witch_action"; heal: boolean; poison: Seat | null }
  | { t: "hunter_shoot"; shoot: Seat | null }
  | { t: "speech"; text: string }
  | { t: "vote"; target: Seat | null }
  | { t: "last_words"; text: string }
  | { t: "sheriff_campaign"; run: boolean }
  | { t: "sheriff_speech"; text: string }
  | { t: "sheriff_vote"; target: Seat | null }
  | { t: "sheriff_transfer"; to: Seat | null };

export type EngineAction =
  /** agent 回复（seat 须有 pending 请求，payload.t 与请求 kind 对应） */
  | { t: "respond"; seat: Seat; payload: ResponsePayload }
  /** 超时：引擎以 defaultAction 代答 */
  | { t: "timeout"; seat: Seat }
  /** 编排器判定取消资格（3 次违规等）；座位立即死亡并结算 */
  | { t: "disqualify"; seat: Seat; reason: string };

// ---------- 对局状态 ----------
export interface VoteRound {
  day: number;
  round: number;
  ballots: Array<{ voter: Seat; target: Seat | null }>;
  eliminated: Seat | null;
  pkCandidates: Seat[];
  /** 警长票的权重（放逐投票时警长 1.5） */
  weights?: Record<number, number>;
}

export interface GameState {
  gameId: string;
  seed: string;
  config: GameConfig;
  seats: SeatState[];
  night: number;
  day: number;
  phase: Phase;
  pending: PendingRequest[];
  /** 女巫药剂剩余（true=未用） */
  witchPotions: { heal: boolean; poison: boolean };
  seerChecks: Array<{ night: number; target: Seat; result: "wolf" | "human" }>;
  votes: VoteRound[];
  log: EngineEvent[];
  rngState: RngState;
  /** 座位 -> 超时次数 */
  penalties: Record<number, number>;
  disqualifications: Array<{ seat: Seat; reason: string }>;
  winner?: { faction: Faction; reason: string };
  /** 当夜刀口（wolves 可见） */
  currentKill: Seat | null;
  /** 当前警长（警长竞选机制） */
  sheriff?: Seat;
  /** 竞选人列表（第 1 天竞选流程中维护） */
  sheriffCandidates: Seat[];
  /** 收集中间态（狼票/投票 ballots），收齐后结算；存于 state 以保证可重放 */
  collect: {
    wolfBallots: Array<{ voter: Seat; kill: Seat | null }>;
    voteBallots: Array<{ voter: Seat; target: Seat | null }>;
  };
  /** 当夜用药记录（结算用） */
  nightActions: {
    night: number;
    healUsed: boolean;
    poisonTarget: Seat | null;
  };
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: "ILLEGAL_ACTION" | "NOT_PENDING" | "BAD_PAYLOAD" | "GAME_OVER" | "CONFIG",
  ) {
    super(message);
  }
}

// ---------- 常用查询 ----------
export function aliveSeats(s: GameState): Seat[] {
  return s.seats.filter((x) => x.alive).map((x) => x.seat);
}
export function seatState(s: GameState, seat: Seat): SeatState {
  const st = s.seats.find((x) => x.seat === seat);
  if (!st) throw new EngineError(`no seat ${seat}`, "ILLEGAL_ACTION");
  return st;
}
export function aliveOfRole(s: GameState, role: Role): SeatState[] {
  return s.seats.filter((x) => x.alive && x.role === role);
}
export function nextAliveSeat(s: GameState, from: Seat): Seat {
  const n = s.config.playerCount;
  for (let i = 1; i <= n; i++) {
    const c = ((from - 1 + i - 1) % n) + 1;
    if (seatState(s, c as Seat).alive) return c as Seat;
  }
  throw new EngineError("no alive seat", "ILLEGAL_ACTION");
}
