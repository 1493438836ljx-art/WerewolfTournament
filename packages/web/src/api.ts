// REST API 封装
export interface AgentManifest {
  name: string;
  language: string;
  network: string;
  resources: { memory_mb: number; cpus: number };
}

export interface AgentRow {
  id: string;
  name: string;
  dir: string;
  ownerId: string | null;
  ownerName: string | null;
  totalPoints: number;
  wins: number;
  games: number;
  mvps: number;
  manifestJson: AgentManifest;
  selfcheckStatus: string;
  selfcheckDetail: { ok?: boolean; latencyMs?: number; error?: string } | null;
}

export interface GameRow {
  id: string;
  tournamentId: string | null;
  seq: number;
  status: string;
  winnerFaction: string | null;
  winReason: string | null;
}

export interface TournamentRow {
  id: string;
  name: string;
  kind: string;
  createdBy: string | null;
  status: string;
}

export interface LeaderRow {
  agentId: string;
  name: string;
  points: number;
  wins: number;
  games: number;
  mvps: number;
  timeouts: number;
}

import { getToken, onUnauthorized } from "./auth.js";

async function req(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
    },
  });
  if (r.status === 401) onUnauthorized();
  return r;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => req("/api/agents").then((r: Response) => j<AgentRow[]>(r)),
  scanAgents: () => req("/api/agents/scan", { method: "POST" }).then((r: Response) => j<{ added: string[]; updated: string[] }>(r)),
  selfcheck: (id: string) =>
    req(`/api/agents/${id}/selfcheck`, { method: "POST" }).then((r: Response) =>
      j<{ ok: boolean; latencyMs: number; error?: string }>(r),
    ),
  removeAgent: (id: string) => req(`/api/agents/${id}`, { method: "DELETE" }).then((r: Response) => j<unknown>(r)),
  uploadAgent: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req("/api/agents/upload", { method: "POST", body: form }).then((r: Response) => j<{ id: string; name: string; updated: boolean }>(r));
  },

  listTournaments: () => req("/api/tournaments").then((r: Response) => j<TournamentRow[]>(r)),
  createTournament: (body: {
    name?: string;
    kind: "training" | "official";
    agentIds?: string[];
    officialRounds?: number;
    maxConcurrentGames?: number;
  }) =>
    req("/api/tournaments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r: Response) => j<{ id: string }>(r)),
  tournament: (id: string) =>
    req(`/api/tournaments/${id}`).then((r: Response) => j<{ tournament: TournamentRow; games: GameRow[] }>(r)),
  startTournament: (id: string) => req(`/api/tournaments/${id}/start`, { method: "POST" }).then((r: Response) => j<unknown>(r)),
  abortTournament: (id: string) => req(`/api/tournaments/${id}/abort`, { method: "POST" }).then((r: Response) => j<unknown>(r)),
  leaderboard: (id: string) => req(`/api/tournaments/${id}/leaderboard`).then((r: Response) => j<LeaderRow[]>(r)),

  listGames: () => req("/api/games").then((r: Response) => j<GameRow[]>(r)),
  game: (id: string) =>
    req(`/api/games/${id}`).then((r: Response) =>
      j<{ game: GameRow; seats: Array<{ seat: number; agentId: string; role: string; alive: boolean; teamWon: boolean | null }> }>(r),
    ),
  gameEvents: (id: string) => req(`/api/games/${id}/events`).then((r: Response) => r.text()),

  refereeHealth: () =>
    req("/api/referee/health").then((r: Response) =>
      j<{ mode: string; llmConfigured: boolean; breaker: { consecutiveFailures: number; open: boolean } }>(r),
    ),
  setRefereeMode: (mode: string) =>
    req("/api/admin/referee/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then((r: Response) => j<unknown>(r)),
  refereeCalls: () => req("/api/referee/calls").then((r: Response) => j<Array<{ id: number; purpose: string; model: string; tokens: number; ok: boolean; latencyMs: number; createdAt: string }>>(r)),
  adminSettings: () =>
    req("/api/admin/settings").then((r: Response) => j<{ maxConcurrentGames: number; activeGames: number; waitingGames: number }>(r)),
  setMaxConcurrentGames: (n: number) =>
    req("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxConcurrentGames: n }) }).then((r: Response) => j<unknown>(r)),
  getLlmConfig: () =>
    req("/api/admin/llm-config").then((r: Response) =>
      j<{ config: { provider: string; apiKey: string; baseUrl: string; model: string; modelAnnounce: string } | null; apiKeyTail: string; source: string }>(r),
    ),
  setLlmConfig: (body: { provider?: string; apiKey?: string; baseUrl?: string; model?: string; modelAnnounce?: string }) =>
    req("/api/admin/llm-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r: Response) => j<unknown>(r)),
  testLlmConnection: () =>
    req("/api/admin/llm-config/test", { method: "POST" }).then((r: Response) => j<{ ok: boolean; latencyMs: number; detail?: string; model?: string }>(r)),
};
