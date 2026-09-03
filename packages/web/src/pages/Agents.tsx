import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow } from "../api.js";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState("");

  const refresh = useCallback(() => api.listAgents().then(setAgents).catch(() => {}), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const scan = async () => {
    setScanMsg("扫描中…");
    try {
      const r = await api.scanAgents();
      setScanMsg(`新增 ${r.added.length} 个 agent`);
      refresh();
    } catch (e) {
      setScanMsg(String(e));
    }
  };

  const selfcheck = async (id: string) => {
    setBusy(id);
    try {
      await api.selfcheck(id);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>选手 Agent</h2>
          <button className="primary" onClick={scan}>
            扫描 agents/ 目录
          </button>
        </div>
        {scanMsg && <p className="muted">{scanMsg}</p>}
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>目录</th>
              <th>连通性自检</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {a.dir}
                </td>
                <td>
                  <span className={`tag ${a.selfcheckStatus}`}>{a.selfcheckStatus}</span>
                  {a.selfcheckDetail?.latencyMs ? (
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {a.selfcheckDetail.latencyMs}ms
                    </span>
                  ) : null}
                  {a.selfcheckDetail?.error ? (
                    <div className="muted" style={{ fontSize: 12, color: "var(--bad)" }}>
                      {a.selfcheckDetail.error}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="row">
                    <button disabled={busy === a.id} onClick={() => selfcheck(a.id)}>
                      {busy === a.id ? "检测中…" : "自检"}
                    </button>
                    <button
                      onClick={() => {
                        api.removeAgent(a.id).then(refresh);
                      }}
                    >
                      移除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  还没有注册的 agent —— 把选手提交放到 agents/ 目录后点「扫描」
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
