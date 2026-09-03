import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type GameRow, type TournamentRow } from "../api.js";
import { useTopic } from "../ws.js";

interface LeaderRow {
  agentId: string;
  name: string;
  points: number;
  wins: number;
  games: number;
  mvps: number;
  timeouts: number;
}

export function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<TournamentRow | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);

  const refresh = useCallback(() => {
    if (!id) return;
    api.tournament(id).then((d) => {
      setT(d.tournament);
      setGames(d.games);
    }).catch(() => {});
    api.leaderboard(id).then(setBoard).catch(() => {});
  }, [id]);
  useEffect(refresh, [refresh]);

  useTopic(id ? `tournament/${id}` : null, () => {
    refresh(); // 任何锦标赛事件都触发轻量刷新
  });

  if (!t) return <div className="page muted">加载中…</div>;

  return (
    <div className="page">
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            {t.name} <span className={`tag ${t.status}`}>{t.status}</span>
          </h2>
          <div className="row">
            {t.status === "draft" && (
              <button className="primary" onClick={() => api.startTournament(t.id).then(refresh)}>
                开始比赛
              </button>
            )}
            {t.status === "running" && (
              <button onClick={() => api.abortTournament(t.id).then(refresh)}>中止</button>
            )}
          </div>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          对局 {games.filter((g) => g.status === "done").length}/{games.length} 已完成
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>对局</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>状态</th>
                <th>胜方</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/games/${g.id}`}>第 {g.seq} 局</Link>
                  </td>
                  <td>
                    <span className={`tag ${g.status === "done" ? "done" : g.status}`}>{g.status}</span>
                  </td>
                  <td>
                    {g.winnerFaction ? (
                      <span className={`tag ${g.winnerFaction}`}>{g.winnerFaction === "werewolf" ? "狼人" : "好人"}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {games.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    （draft 状态，开始比赛后生成）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>积分榜</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th>积分</th>
                <th>胜/场</th>
                <th>MVP</th>
                <th>超时</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={r.agentId}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>
                    <b>{r.points}</b>
                  </td>
                  <td>
                    {r.wins}/{r.games}
                  </td>
                  <td>{r.mvps}</td>
                  <td>{r.timeouts}</td>
                </tr>
              ))}
              {board.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无积分（对局完成后生成）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
