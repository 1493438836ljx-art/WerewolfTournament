// REST API：agents / tournaments / games / referee。
import type { FastifyInstance } from "fastify";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents, gameEvents, games, gameSeats, llmCalls, scores, tournaments } from "../db/schema.js";
import { getAgent, listAgents, registerAgent, removeAgent, scanAndRegister, updateSelfcheck } from "../agents/registry.js";
import { loadManifest } from "../agents/manifest.js";
import { AgentProcess } from "../agents/runner.js";
import { noneSandbox, sandboxFor, type SandboxMode } from "../agents/sandbox.js";
import { selfcheck } from "../agents/selfcheck.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refereeHealth, setRefereeMode, type RefereeMode } from "../llmreferee.js";
import type { GameService } from "../game/service.js";

export function registerRest(app: FastifyInstance, gameService: GameService, opts: { agentsRoot: string; sandbox: SandboxMode }) {
  // ---------- agents ----------
  app.get("/api/agents", async () => listAgents());

  app.post("/api/agents/scan", async () => scanAndRegister(opts.agentsRoot));

  app.post("/api/agents", async (req, reply) => {
    const body = (req.body ?? {}) as { dir?: string };
    if (!body.dir) return reply.code(400).send({ error: "dir 必填" });
    try {
      const id = await registerAgent(body.dir);
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete("/api/agents/:id", async (req) => {
    const { id } = req.params as { id: string };
    await removeAgent(id);
    return { ok: true };
  });

  app.post("/api/agents/:id/selfcheck", async (req) => {
    const { id } = req.params as { id: string };
    const agent = await getAgent(id);
    if (!agent) return { ok: false, error: "agent 不存在" };
    const manifest = loadManifest(agent.dir).manifest;
    const result = await selfcheck(async () => {
      const workDir = await mkdtemp(path.join(tmpdir(), `wt-selfcheck-${id}-`));
      const ap = await AgentProcess.spawn(manifest, noneSandbox(), {
        gameId: `selfcheck-${id}`,
        seat: 1,
        agentDir: agent.dir,
        workDir,
        agentId: id,
      });
      return {
        ready: Promise.resolve({ agentName: manifest.name }),
        kill: (r: string) => ap.kill(r),
        stderrTail: ap.stderrTail,
        hasExited: ap.hasExited,
      };
    });
    await updateSelfcheck(id, result.ok ? "ok" : "fail", result);
    return result;
  });

  // ---------- games ----------
  app.get("/api/games", async () => {
    const rows = await db.select().from(games).orderBy(asc(games.seq)).limit(200);
    return rows;
  });

  app.get("/api/games/:id", async (req) => {
    const { id } = req.params as { id: string };
    const [game] = await db.select().from(games).where(eq(games.id, id)).limit(1);
    if (!game) return { error: "not found" };
    const seats = await db.select().from(gameSeats).where(eq(gameSeats.gameId, id)).orderBy(asc(gameSeats.seat));
    return { game, seats };
  });

  app.get("/api/games/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await db.select().from(gameEvents).where(eq(gameEvents.gameId, id)).orderBy(asc(gameEvents.seq));
    reply.header("content-type", "application/x-ndjson; charset=utf-8");
    return reply.send(rows.map((r) => JSON.stringify({
      seq: r.seq,
      ts: r.ts,
      kind: r.kind,
      actor_seat: r.actorSeat,
      payload: r.payloadPublic ?? null,
      private: r.payloadPrivateJson ?? null,
    })).join("\n"));
  });

  // ---------- tournaments ----------
  app.post("/api/tournaments", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; agentIds?: string[]; gamesPerAgent?: number; maxConcurrentGames?: number };
    if (!body.name || !Array.isArray(body.agentIds) || body.agentIds.length < 1) {
      return reply.code(400).send({ error: "name 与 agentIds 必填" });
    }
    const id = await gameService.createTournament({
      name: body.name,
      agentIds: body.agentIds,
      gamesPerAgent: body.gamesPerAgent ?? 2,
      maxConcurrentGames: body.maxConcurrentGames ?? 1,
    });
    return reply.code(201).send({ id });
  });

  app.get("/api/tournaments", async () => db.select().from(tournaments));

  app.get("/api/tournaments/:id", async (req) => {
    const { id } = req.params as { id: string };
    const t = await gameService.getTournament(id);
    if (!t) return { error: "not found" };
    return t;
  });

  app.post("/api/tournaments/:id/start", async (req) => {
    const { id } = req.params as { id: string };
    void gameService.startTournament(id).catch((e) => app.log.error(e, "tournament start failed"));
    return { started: true };
  });

  app.post("/api/tournaments/:id/abort", async (req) => {
    const { id } = req.params as { id: string };
    await gameService.abortTournament(id);
    return { aborted: true };
  });

  app.get("/api/tournaments/:id/leaderboard", async (req) => {
    const { id } = req.params as { id: string };
    return gameService.leaderboard(id);
  });

  // ---------- referee ----------
  app.get("/api/referee/health", async () => refereeHealth());

  app.get("/api/referee/calls", async () => {
    const rows = await db.select().from(llmCalls).orderBy(desc(llmCalls.id)).limit(12);
    return rows.map((r) => ({
      id: r.id,
      purpose: r.purpose,
      model: r.model,
      tokens: r.inTokens + r.outTokens,
      ok: r.ok,
      latencyMs: r.latencyMs,
      createdAt: r.createdAt,
    }));
  });

  app.post("/api/admin/referee/mode", async (req) => {
    const body = (req.body ?? {}) as { mode?: RefereeMode };
    if (!body.mode) return { error: "mode 必填" };
    setRefereeMode(body.mode);
    return refereeHealth();
  });

  app.get("/healthz", async () => ({ ok: true }));
}
