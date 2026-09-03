import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AgentRow, type TournamentRow } from "../api.js";

export function TournamentsPage() {
  const [list, setList] = useState<TournamentRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [gamesPerAgent, setGamesPerAgent] = useState(2);
  const [err, setErr] = useState("");

  const refresh = useCallback(() => {
    api.listTournaments().then(setList).catch(() => {});
    api.listAgents().then(setAgents).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const create = async () => {
    setErr("");
    const agentIds = Object.keys(selected).filter((k) => selected[k]);
    if (!name || agentIds.length === 0) {
      setErr("名称与至少 1 个 agent 必填");
      return;
    }
    try {
      const r = await api.createTournament({ name, agentIds, gamesPerAgent });
      setSelected({});
      setName("");
      refresh();
      location.hash = "";
      void r;
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="page">
      <div className="panel">
        <h2>创建锦标赛</h2>
        <div className="row">
          <input placeholder="锦标赛名称" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="muted">
            每个agent局数
            <input
              type="number"
              min={1}
              max={20}
              value={gamesPerAgent}
              onChange={(e) => setGamesPerAgent(Number(e.target.value))}
              style={{ width: 70, marginLeft: 6 }}
            />
          </label>
        </div>
        <div style={{ margin: "12px 0" }}>
          {agents.map((a) => (
            <label key={a.id} style={{ display: "inline-flex", gap: 6, margin: 4, padding: "6px 10px", background: "var(--panel2)", borderRadius: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!selected[a.id]}
                onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))}
              />
              {a.name}
            </label>
          ))}
          {agents.length === 0 && <span className="muted">先到「选手 Agent」页注册</span>}
        </div>
        {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
        <button className="primary" onClick={create}>
          创建
        </button>
      </div>

      <div className="panel">
        <h2>锦标赛列表</h2>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/tournaments/${t.id}`}>{t.name}</Link>
                </td>
                <td>
                  <span className={`tag ${t.status}`}>{t.status}</span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {t.id}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
