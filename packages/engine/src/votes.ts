// 投票统计与狼刀共识。
import type { Seat } from "@wt/protocol";

export interface Ballot {
  voter: Seat;
  target: Seat | null;
}

export interface TallyResult {
  counts: Map<Seat | null, number>;
  max: number;
  /** 得票最高的候选（可能并列） */
  leaders: Seat[];
}

export function tally(ballots: Ballot[], candidates: Seat[]): TallyResult {
  const counts = new Map<Seat | null, number>();
  for (const c of candidates) counts.set(c, 0);
  for (const b of ballots) {
    if (b.target !== null && counts.has(b.target)) {
      counts.set(b.target, (counts.get(b.target) ?? 0) + 1);
    }
  }
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  const leaders = candidates.filter((c) => (counts.get(c) ?? 0) === max);
  return { counts, max, leaders };
}

/**
 * 狼刀共识：多数决；平票取座位号最小的存活狼的选择。
 * ballots 为各狼提交（含 null=空刀）；tieBreakSeat 为座位最小的存活狼。
 */
export function resolveWolfBallots(
  ballots: Array<{ voter: Seat; kill: Seat | null }>,
  tieBreakSeat: Seat,
): Seat | null {
  const mapped: Ballot[] = ballots.map((b) => ({ voter: b.voter, target: b.kill }));
  const counts = new Map<Seat | null, number>();
  for (const b of mapped) counts.set(b.target, (counts.get(b.target) ?? 0) + 1);
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  const leaders: Array<Seat | null> = [];
  for (const [t, n] of counts) if (n === max) leaders.push(t);
  if (leaders.length === 1) return leaders[0]!;
  // 平票：取座位最小存活狼的选择
  const tieChoice = mapped.find((b) => b.voter === tieBreakSeat)?.target ?? null;
  return tieChoice;
}
