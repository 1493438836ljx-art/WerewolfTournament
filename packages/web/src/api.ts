// REST API 封装
export interface AgentRow {
  id: string;
  name: string;
  dir: string;
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

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => fetch("/api/agents").then((r) => j<AgentRow[]>(r)),
  scanAgents: () => fetch("/api/agents/scan", { method: "POST" }).then((r) => j<{ added: string[] }>(r)),
  selfcheck: (id: string) => fetch(`/api/agents/${id}/selfcheck`, { method: "POST" }).then((r) => j<unknown>(r)),
  removeAgent: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE" }).then((r) => j<unknown>(r)),

  listTournaments: () => fetch("/api/tournaments").then((r) => j<TournamentRow[]>(r)),
  createTournament: (body: { name: string; agentIds: string[]; gamesPerAgent: number }) =>
    fetch("/api/tournaments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => j<{ id: string }>(r)),
  tournament: (id: string) =>
    fetch(`/api/tournaments/${id}`).then((r) => j<{ tournament: TournamentRow; games: GameRow[] }>(r)),
  startTournament: (id: string) => fetch(`/api/tournaments/${id}/start`, { method: "POST" }).then((r) => j<unknown>(r)),
  abortTournament: (id: string) => fetch(`/api/tournaments/${id}/abort`, { method: "POST" }).then((r) => j<unknown>(r)),
  leaderboard: (id: string) =>
    fetch(`/api/tournaments/${id}/leaderboard`).then((r) =>
      j<Array<{ agentId: string; name: string; points: number; wins: number; games: number; mvps: number; timeouts: number }>>(r),
    ),

  listGames: () => fetch("/api/games").then((r) => j<GameRow[]>(r)),
  game: (id: string) =>
    fetch(`/api/games/${id}`).then((r) =>
      j<{ game: GameRow; seats: Array<{ seat: number; agentId: string; role: string; alive: boolean; teamWon: boolean | null }> }>(r),
    ),
};
