import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow } from "../api.js";
import { ICONS, ProtocolDialog, StatusTag, toast } from "../components.js";

type CheckState = { status: string; latency: number | null; error?: string };

/** 绝对路径 -> agents/xxx 相对形式（表格列宽友好） */
function shortDir(dir: string): string {
  const i = dir.indexOf("agents/");
  return i >= 0 ? dir.slice(i) : dir;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [scanning, setScanning] = useState(false);

  const refresh = useCallback(() => {
    api.listAgents().then(setAgents).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const r = await api.scanAgents();
      refresh();
      toast(`扫描完成 · 新增 ${r.added.length} · 更新 ${r.updated.length}`);
    } catch (e) {
      toast(`扫描失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setScanning(false);
    }
  };

  const selfcheck = async (a: AgentRow) => {
    if (checks[a.id]?.status === "busy") return;
    setChecks((c) => ({ ...c, [a.id]: { status: "busy", latency: null } }));
    try {
      const r = await api.selfcheck(a.id);
      setChecks((c) => ({ ...c, [a.id]: { status: r.ok ? "ok" : "fail", latency: r.latencyMs, error: r.error } }));
      if (r.ok) toast(`${a.name} 自检通过 · 握手 ${r.latencyMs}ms`);
      else toast(`${a.name} 自检失败 · ${r.error ?? "未知错误"}`);
    } catch (e) {
      setChecks((c) => ({ ...c, [a.id]: { status: "fail", latency: null, error: String(e) } }));
    }
    refresh();
  };

  const remove = async (a: AgentRow) => {
    await api.removeAgent(a.id).catch(() => {});
    refresh();
    toast(`已移除 ${a.name}（重新扫描 agents/ 可找回）`);
  };

  return (
    <section className="section screen-pad">
      <div className="container">
        <div className="screen-head row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 20 }}>
          <div>
            <p className="eyebrow">REGISTRY · 选手接入</p>
            <h1 className="screen-title">选手 Agent</h1>
            <p className="lead">
              把提交放进 <span className="num">agents/</span> 目录，平台扫描 manifest 注册，spawn 子进程做连通性自检。任何语言、任何框架——平台只关心 stdin/stdout 的行为。
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <ProtocolDialog />
            <button className="btn btn-primary" onClick={scan} disabled={scanning}>
              {ICONS.scan}
              {scanning ? "扫描中…" : "扫描 agents/ 目录"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>提交目录</th>
                  <th>语言 · 网络</th>
                  <th>资源</th>
                  <th>连通性自检</th>
                  <th>延迟</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const ck = checks[a.id] ?? {
                    status: a.selfcheckStatus,
                    latency: a.selfcheckDetail?.latencyMs ?? null,
                    error: a.selfcheckDetail?.error,
                  };
                  const mf = a.manifestJson;
                  return (
                    <tr key={a.id}>
                      <td className="num">{a.name}</td>
                      <td className="meta" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={a.dir}>
                        {shortDir(a.dir)}
                      </td>
                      <td>
                        {mf ? `${mf.language.charAt(0).toUpperCase()}${mf.language.slice(1)} · ${mf.network}` : "—"}
                      </td>
                      <td className="meta">
                        {mf ? `${mf.resources.memory_mb}MB · ${mf.resources.cpus} CPU` : "—"}
                      </td>
                      <td>
                        {ck.status === "busy" ? (
                          <StatusTag status="busy" text="检测中" />
                        ) : ck.status === "ok" ? (
                          <StatusTag status="ok" text="ok" />
                        ) : ck.status === "fail" ? (
                          <StatusTag status="fail" text="fail" />
                        ) : (
                          <StatusTag status="pending" text="未自检" />
                        )}
                        {ck.error && (
                          <div className="meta" style={{ color: "var(--bad-ink)", fontSize: 11, marginTop: 2, whiteSpace: "normal", maxWidth: 180 }}>
                            {ck.error.slice(0, 80)}
                          </div>
                        )}
                      </td>
                      <td className="num-col">{ck.latency != null ? `${ck.latency}ms` : "—"}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => selfcheck(a)}>
                            {ck.status === "busy" ? "检测中…" : "自检"}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => remove(a)}>
                            移除
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-hint">
                      还没有注册的 agent —— 把提交放进 agents/ 目录后点「扫描 agents/ 目录」
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="meta divider-note">
            自检 = 平台 spawn 你的进程并完成 hello → ready 握手 · 网络模式 none=禁网 / proxy=仅平台 LLM 代理 · 调试输出请走 stderr
          </p>
        </div>
      </div>
    </section>
  );
}
