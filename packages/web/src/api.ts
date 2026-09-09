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

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => fetch("/api/agents").then((r) => j<AgentRow[]>(r)),
  scanAgents: () => fetch("/api/agents/scan", { method: "POST" }).then((r) => j<{ added: string[]; updated: string[] }>(r)),
  selfcheck: (id: string) =>
    fetch(`/api/agents/${id}/selfcheck`, { method: "POST" }).then((r) =>
      j<{ ok: boolean; latencyMs: number; error?: string }>(r),
    ),
  removeAgent: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE" }).then((r) => j<unknown>(r)),

  listTournaments: () => fetch("/api/tournaments").then((r) => j<TournamentRow[]>(r)),
  createTournament: (body: { name: string; agentIds: string[]; gamesPerAgent: number }) =>
    fetch("/api/tournaments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => j<{ id: string }>(r)),
  tournament: (id: string) =>
    fetch(`/api/tournaments/${id}`).then((r) => j<{ tournament: TournamentRow; games: GameRow[] }>(r)),
  startTournament: (id: string) => fetch(`/api/tournaments/${id}/start`, { method: "POST" }).then((r) => j<unknown>(r)),
  abortTournament: (id: string) => fetch(`/api/tournaments/${id}/abort`, { method: "POST" }).then((r) => j<unknown>(r)),
  leaderboard: (id: string) => fetch(`/api/tournaments/${id}/leaderboard`).then((r) => j<LeaderRow[]>(r)),

  listGames: () => fetch("/api/games").then((r) => j<GameRow[]>(r)),
  game: (id: string) =>
    fetch(`/api/games/${id}`).then((r) =>
      j<{ game: GameRow; seats: Array<{ seat: number; agentId: string; role: string; alive: boolean; teamWon: boolean | null }> }>(r),
    ),
  gameEvents: (id: string) => fetch(`/api/games/${id}/events`).then((r) => r.text()),

  refereeHealth: () =>
    fetch("/api/referee/health").then((r) =>
      j<{ mode: string; llmConfigured: boolean; breaker: { consecutiveFailures: number; open: boolean } }>(r),
    ),
  setRefereeMode: (mode: string) =>
    fetch("/api/admin/referee/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then((r) => j<unknown>(r)),
};
