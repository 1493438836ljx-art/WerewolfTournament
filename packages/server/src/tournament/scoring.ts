// 积分规则：阵营胜 +3 / MVP +1 / 每次超时 -0.1（局内上限 -1）/ 被取消资格 -2（且该局判负记 0）。
import type { GameResult } from "../game/orchestrator.js";

export interface ScoreBreakdown {
  base: number;
  mvp: number;
  timeoutPenalty: number;
  dqPenalty: number;
  total: number;
}

export const WIN_POINTS = 3;
export const MVP_POINTS = 1;
export const TIMEOUT_PENALTY = 0.1;
export const TIMEOUT_PENALTY_CAP = 1;
export const DQ_PENALTY = 2;

export function scoreSeat(seat: GameResult["seats"][number], mvp: boolean): ScoreBreakdown {
  const disqualified = seat.death?.cause === "disqualify";
  const base = !disqualified && seat.teamWon ? WIN_POINTS : 0;
  const timeoutPenalty = Math.min(seat.penalties * TIMEOUT_PENALTY, TIMEOUT_PENALTY_CAP);
  const dqPenalty = disqualified ? DQ_PENALTY : 0;
  return {
    base,
    mvp: mvp ? MVP_POINTS : 0,
    timeoutPenalty,
    dqPenalty,
    total: Math.round((base + (mvp ? MVP_POINTS : 0) - timeoutPenalty - dqPenalty) * 100) / 100,
  };
}

/** 同分决胜：净胜局 -> 违规数少者 */
export function tiebreak(a: { points: number; wins: number; violations: number }, b: { points: number; wins: number; violations: number }): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  return a.violations - b.violations;
}
