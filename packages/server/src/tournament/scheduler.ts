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
