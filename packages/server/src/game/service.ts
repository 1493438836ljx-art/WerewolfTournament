// GameService：锦标赛执行服务 —— 赛程编排 + 并发对局 + 积分结算。
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Seat } from "@wt/protocol";
import { db } from "../db/index.js";
import { agents, games, gameSeats, scores, tournaments } from "../db/schema.js";
import { getAgent } from "../agents/registry.js";
import { loadManifest } from "../agents/manifest.js";
import { sandboxFor, type SandboxMode } from "../agents/sandbox.js";
import { EventBus } from "./bus.js";
import { Orchestrator, type GameResult, type PlayerSpec } from "./orchestrator.js";
import { createGameRecord, dbSinks } from "./recorder.js";
import { planTournament } from "../tournament/scheduler.js";
import { scoreSeat } from "../tournament/scoring.js";
import { getReferee } from "../llmreferee.js";

export interface TournamentConfig {
  name: string;
  agentIds: string[];
  gamesPerAgent: number;
  maxConcurrentGames: number;
}

export class GameService {
  private runningGames = new Set<string>();
  private aborting = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    private readonly opts: {
      agentsRoot: string;
      sandbox: SandboxMode;
      /** 按 agent 提供 LLM 代理连接（token 细分计量） */
      llmProxyFor?: (agentId: string) => { url: string; token: string; model?: string } | undefined;
    },
  ) {}

  async createTournament(cfg: TournamentConfig): Promise<string> {
    const id = `t-${randomUUID().slice(0, 10)}`;
    const plan = planTournament({ agentIds: cfg.agentIds, gamesPerAgent: cfg.gamesPerAgent });
    await db.insert(tournaments).values({
      id,
      name: cfg.name,
      status: "draft",
      configJson: { ...cfg, games: plan.map((g) => ({ gameId: g.gameId, seq: g.seq, seed: g.seed, seats: Object.fromEntries(g.seats) })) },
    });
    return id;
  }

  async getTournament(id: string) {
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
    if (!t) return null;
    const gs = await db.select().from(games).where(eq(games.tournamentId, id)).orderBy(games.seq);
    return { tournament: t, games: gs };
  }

  async startTournament(id: string): Promise<void> {
    const [t] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
    if (!t) throw new Error("锦标赛不存在");
    if (t.status === "running") throw new Error("已在运行");
    const cfg = t.configJson as { games: Array<{ gameId: string; seq: number; seed: string; seats: Record<string, string> }>; maxConcurrentGames?: number; agentIds: string[] };
    await db.update(tournaments).set({ status: "running", startedAt: new Date() }).where(eq(tournaments.id, id));
    this.bus.publish({ topic: `tournament/${id}`, kind: "tournament_started", payload: { id }, ts: new Date().toISOString() });

    const maxConcurrent = cfg.maxConcurrentGames ?? 1;
    const queue = [...cfg.games];
    const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, async () => {
      while (queue.length > 0) {
        if (this.aborting.has(id)) break;
        const g = queue.shift()!;
        await this.runOne(id, g.gameId, g.seq, g.seed, g.seats).catch(async (e) => {
          console.error(`[game ${g.gameId}] failed:`, e instanceof Error ? e.message : e);
          // 对局异常（如 agent 全体 spawn 失败）：状态回写，避免永远停在 running
          await db.update(games).set({ status: "aborted", endedAt: new Date() }).where(eq(games.id, g.gameId)).catch(() => {});
          this.bus.publish({ topic: `tournament/${id}`, kind: "game_failed", payload: { gameId: g.gameId, error: String(e) }, ts: new Date().toISOString() });
        });
      }
    });
    await Promise.all(workers);
    this.aborting.delete(id);
    await db.update(tournaments).set({ status: "done", endedAt: new Date() }).where(eq(tournaments.id, id));
    this.bus.publish({ topic: `tournament/${id}`, kind: "tournament_done", payload: { id }, ts: new Date().toISOString() });
  }

  async abortTournament(id: string): Promise<void> {
    this.aborting.add(id);
    await db.update(tournaments).set({ status: "aborted", endedAt: new Date() }).where(eq(tournaments.id, id));
  }

  /** 单局执行（含入库与积分） */
  async runOne(tournamentId: string | null, gameId: string, seq: number, seed: string, seatMap: Record<string, string>): Promise<GameResult> {
    if (this.runningGames.has(gameId)) throw new Error("该对局已在运行");
    this.runningGames.add(gameId);
    try {
      const players: PlayerSpec[] = [];
      for (const [seatStr, agentId] of Object.entries(seatMap)) {
        const agent = await getAgent(agentId);
        if (!agent) throw new Error(`agent ${agentId} 不存在`);
        const manifest = loadManifest(agent.dir).manifest;
        players.push({
          seat: Number(seatStr) as Seat,
          agentId,
          name: agent.name,
          agentDir: agent.dir,
          manifest,
        });
      }
      players.sort((a, b) => a.seat - b.seat);

      const sinks = dbSinks(tournamentId);
      const orch = new Orchestrator(gameId, this.bus, sandboxFor(this.opts.sandbox), sinks, this.opts.llmProxyFor);
      await createGameRecord({ gameId, tournamentId, seq, seed, configJson: {} });

      const result = await orch.run({ seed, players });

      // MVP（裁判）与积分
      const referee = getReferee();
      let mvpSeat: number | null = null;
      if (tournamentId) {
        const mvp = await referee.mvp(result.state.log.map((e) => ({ kind: e.kind, payload: e.payload }))).catch(() => null);
        mvpSeat = mvp?.seat ?? null;
      }
      for (const s of result.seats) {
        const isMvp = mvpSeat === s.seat;
        const score = scoreSeat(s, isMvp);
        if (tournamentId) {
          await db.insert(scores).values({
            tournamentId,
            agentId: s.agentId,
            gameId,
            seat: s.seat,
            points: score.total,
            mvp: isMvp,
            penalties: s.penalties,
            breakdownJson: score,
          });
        }
      }
      // 摘要（含 MVP）广播
      this.bus.publish({
        topic: `game/${gameId}`,
        kind: "game_summary",
        payload: { winner: result.winnerFaction, reason: result.winReason, mvp: mvpSeat },
        ts: new Date().toISOString(),
      });
      return result;
    } finally {
      this.runningGames.delete(gameId);
    }
  }

  /** 积分榜（含胜负场、MVP、超时、违规统计） */
  async leaderboard(tournamentId: string) {
    const rows = await db
      .select({
        agentId: scores.agentId,
        points: sql<number>`sum(${scores.points})`,
        wins: sql<number>`sum(case when ${scores.breakdownJson}->>'base' = '3' then 1 else 0 end)`,
        games: sql<number>`count(*)`,
        mvps: sql<number>`sum(case when ${scores.mvp} then 1 else 0 end)`,
        timeouts: sql<number>`sum(${scores.penalties})`,
      })
      .from(scores)
      .where(eq(scores.tournamentId, tournamentId))
      .groupBy(scores.agentId);
    const names = new Map((await db.select().from(agents)).map((a) => [a.id, a.name]));
    return rows
      .map((r) => ({
        agentId: r.agentId,
        name: names.get(r.agentId) ?? r.agentId,
        points: Number(r.points ?? 0),
        wins: Number(r.wins ?? 0),
        games: Number(r.games ?? 0),
        mvps: Number(r.mvps ?? 0),
        timeouts: Number(r.timeouts ?? 0),
      }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins);
  }

  /** Agent 聚合统计（分角色胜率等，供选手页） */
  async agentStats(agentId: string) {
    const seats = await db.select().from(gameSeats).where(eq(gameSeats.agentId, agentId));
    const byRole: Record<string, { total: number; won: number }> = {};
    for (const s of seats) {
      const k = s.role;
      byRole[k] ??= { total: 0, won: 0 };
      byRole[k]!.total++;
      if (s.teamWon) byRole[k]!.won++;
    }
    const totalGames = await db
      .select({ n: sql<number>`count(*)` })
      .from(gameSeats)
      .where(and(eq(gameSeats.agentId, agentId), eq(gameSeats.teamWon, true)));
    return { agentId, games: seats.length, wins: Number(totalGames[0]?.n ?? 0), byRole };
  }
}
