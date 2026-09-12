// 锦标赛赛程编排：座位随机分配（种子入库审计）。
// 非 9 倍数参赛者：每局随机抽取 9 人（或重复参赛允许时循环填充）。
import { randomBytes } from "node:crypto";
import type { Seat } from "@wt/protocol";

export interface GameAssignment {
  seq: number;
  gameId: string;
  seed: string;
  /** seat -> agentId */
  seats: Map<Seat, string>;
}

export function planTournament(opts: {
  agentIds: string[];
  gamesPerAgent: number;
  seatCount?: number;
  allowDuplicateAgentsInGame?: boolean;
}): GameAssignment[] {
  const seatCount = opts.seatCount ?? 9;
  const { agentIds } = opts;
  if (agentIds.length < 1) throw new Error("至少需要 1 个 agent");
  const dup = opts.allowDuplicateAgentsInGame ?? agentIds.length < seatCount;

  const totalGames = Math.max(1, Math.round((agentIds.length * opts.gamesPerAgent) / seatCount));
  const assignments: GameAssignment[] = [];

  for (let g = 0; g < totalGames; g++) {
    const seed = randomBytes(12).toString("hex");
    const picked = pickPlayers(agentIds, seatCount, dup, `${seed}`);
    // 座位分配：Fisher-Yates with seed
    const shuffled = [...picked];
    seededShuffle(shuffled, seed);
    const seats = new Map<Seat, string>();
    for (let i = 0; i < seatCount; i++) seats.set((i + 1) as Seat, shuffled[i]!);
    assignments.push({
      seq: g + 1,
      gameId: `game-${seed.slice(0, 10)}`,
      seed,
      seats,
    });
  }
  return assignments;
}

/** 训练赛编排：一场 = 一局。要求恰好 seatCount 个不同 agent，随机分配座位。 */
export function planSingleGame(agentIds: string[], seatCount = 9): GameAssignment[] {
  if (new Set(agentIds).size !== seatCount) {
    throw new Error(`训练赛需要恰好 ${seatCount} 个不同的 agent`);
  }
  const seed = randomBytes(12).toString("hex");
  const shuffled = [...agentIds];
  seededShuffle(shuffled, seed);
  const seats = new Map<Seat, string>();
  for (let i = 0; i < seatCount; i++) seats.set((i + 1) as Seat, shuffled[i]!);
  return [{ seq: 1, gameId: `game-${seed.slice(0, 10)}`, seed, seats }];
}

/**
 * 正式比赛编排：全员参与、轮流上场。
 * - 每轮（round）：全部 agent 随机洗牌后按 seatCount 切组对局（每局组合不同）
 * - 尾局人数不足时从本轮队首轮转补位（补位者该轮多打一局，保证局满员）
 * - agent 总数 < seatCount 时允许同局多副本（仅开发测试场景）
 * - rounds = 每个agent上场的轮数（1 = 每人打一局）
 */
export function planOfficial(opts: {
  agentIds: string[];
  rounds: number;
  seatCount?: number;
}): GameAssignment[] {
  const seatCount = opts.seatCount ?? 9;
  const { agentIds } = opts;
  if (agentIds.length < 2) throw new Error("正式比赛至少需要 2 个 agent");
  const rounds = Math.max(1, Math.min(10, Math.round(opts.rounds)));

  const assignments: GameAssignment[] = [];
  let seq = 0;
  for (let r = 0; r < rounds; r++) {
    const shuffled = [...agentIds];
    const roundSeed = randomBytes(12).toString("hex");
    seededShuffle(shuffled, roundSeed);
    if (agentIds.length < seatCount) {
      // 人数不足一局：循环填充（全员同局）
      const seed = randomBytes(12).toString("hex");
      const seats = new Map<Seat, string>();
      for (let i = 0; i < seatCount; i++) seats.set((i + 1) as Seat, shuffled[i % shuffled.length]!);
      assignments.push({ seq: ++seq, gameId: `game-${seed.slice(0, 10)}`, seed, seats });
      continue;
    }
    const gamesInRound = Math.ceil(shuffled.length / seatCount);
    for (let g = 0; g < gamesInRound; g++) {
      const seed = randomBytes(12).toString("hex");
      let picked = shuffled.slice(g * seatCount, (g + 1) * seatCount);
      if (picked.length < seatCount) {
        // 尾局补位：从本轮队首轮转填充
        const fill = shuffled.slice(0, seatCount - picked.length);
        picked = [...picked, ...fill];
      }
      const seated = [...picked];
      seededShuffle(seated, seed);
      const seats = new Map<Seat, string>();
      for (let i = 0; i < seatCount; i++) seats.set((i + 1) as Seat, seated[i]!);
      assignments.push({ seq: ++seq, gameId: `game-${seed.slice(0, 10)}`, seed, seats });
    }
  }
  return assignments;
}

/** 每局抽人：人数充足时随机去重抽取；不足时允许重复填充 */
function pickPlayers(agentIds: string[], n: number, allowDup: boolean, seed: string): string[] {
  if (agentIds.length >= n) {
    const pool = [...agentIds];
    seededShuffle(pool, seed);
    return pool.slice(0, n);
  }
  if (!allowDup) throw new Error(`agent 数 ${agentIds.length} < 座位数 ${n} 且不允许重复参赛`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(agentIds[i % agentIds.length]!);
  return out;
}

/** FNV-1a + Fisher-Yates（种子决定，可审计重放） */
function seededShuffle(arr: string[], seed: string): void {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
