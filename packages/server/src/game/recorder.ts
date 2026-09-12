// 对局记录入库：games / game_seats / game_events / votes append-only 写入。
import type { EngineEvent, GameState } from "@wt/engine";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { gameEvents, games, gameSeats, votes as votesTable } from "../db/schema.js";
import type { GameResult } from "./orchestrator.js";
import type { GameSinks } from "./orchestrator.js";

export function dbSinks(tournamentId: string | null, seq0 = 0): GameSinks & { gameSeq: () => number } {
  let seq = seq0;
  return {
    gameSeq: () => seq,
    onEvents: async (state: GameState, events: EngineEvent[]) => {
      if (events.length === 0) return;
      const rows = events.map((ev) => ({
        gameId: state.gameId,
        seq: ev.seq,
        kind: ev.kind,
        actorSeat: actorSeatOf(ev),
        payloadPublic: ev.visibility === "public" ? (ev.payload as object) : null,
        payloadPrivateJson:
          ev.visibility === "public" ? null : { visibility: ev.visibility, payload: ev.payload },
      }));
      await db.insert(gameEvents).values(rows);
      seq = events[events.length - 1]!.seq;
      // 投票轮次入库
      for (const ev of events) {
        if (ev.kind === "vote_result") {
          const p = ev.payload as {
            day: number; round: number; sheriff?: boolean;
            tally: Array<{ voter: number; target: number | null }>;
          };
          if (p.tally?.length) {
            await db.insert(votesTable).values(
              p.tally.map((b) => ({
                gameId: state.gameId,
                day: p.day,
                round: p.round,
                kind: p.sheriff ? "sheriff" : "exile",
                voterSeat: b.voter,
                targetSeat: b.target,
              })),
            );
          }
        }
      }
    },
    onFinish: async (result: GameResult) => {
      await db
        .update(games)
        .set({
          status: "done",
          winnerFaction: result.winnerFaction,
          winReason: result.winReason,
          endedAt: new Date(),
        })
        .where(eq(games.id, result.gameId));
      // 座位记录终局一次性写入（角色/胜负此时才确定）
      await db
        .insert(gameSeats)
        .values(
          result.seats.map((s) => ({
            gameId: result.gameId,
            seat: s.seat,
            agentId: s.agentId,
            role: s.role,
            alive: s.alive,
            deathCause: s.death?.cause ?? null,
            deathTurn: s.death?.turn ?? null,
            teamWon: s.teamWon,
          })),
        )
        .onConflictDoNothing();
    },
    onAgentLog: async (seat, text) => {
      void seat; void text; // 进程日志暂只进总线；后续可入库
    },
  };
}

function actorSeatOf(ev: EngineEvent): number | null {
  const p = ev.payload as { seat?: number; by?: number };
  return p?.seat ?? p?.by ?? null;
}

/** 创建对局记录（编排器启动前调用；座位记录终局由 onFinish 写入） */
export async function createGameRecord(opts: {
  gameId: string;
  tournamentId: string | null;
  seq: number;
  seed: string;
  configJson: unknown;
}) {
  await db.insert(games).values({
    id: opts.gameId,
    tournamentId: opts.tournamentId,
    seq: opts.seq,
    status: "running",
    seed: opts.seed,
    configJson: opts.configJson as object,
    startedAt: new Date(),
  });
}
