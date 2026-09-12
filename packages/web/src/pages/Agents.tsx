import { useCallback, useEffect, useState } from "react";
import { api, type AgentRow } from "../api.js";
import { ICONS, ProtocolDialog, StatusTag, toast } from "../components.js";
import { useAuth } from "../auth.js";
import { useRef } from "react";

type CheckState = { status: string; latency: number | null; error?: string };

/** 绝对路径 -> agents/xxx 相对形式（表格列宽友好） */
function shortDir(dir: string): string {
  const i = dir.indexOf("agents/");
  return i >= 0 ? dir.slice(i) : dir;
}

export function AgentsPage() {
  const user = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);

  const upload = async (f: File) => {
    if (uploading) return;
    setUploading(true);
    try {
      const r = await api.uploadAgent(f);
      toast(r.updated ? `已覆盖你之前的提交：${r.name} · 建议重新自检` : `上传成功：${r.name} · 建议立即自检`);
      refresh();
    } catch (e) {
      toast(`上传失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const refresh = useCallback(() => {
    api
      .listAgents()
      .then((rows) => {
        // 按积分排名：有分者降序（同分比胜场、MVP），无分者保持注册序在后
        const scored = rows.filter((a) => a.games > 0).sort((x, y) => y.totalPoints - x.totalPoints || y.wins - x.wins || y.mvps - x.mvps);
        const unscored = rows.filter((a) => a.games === 0);
        setAgents([...scored, ...unscored]);
      })
      .catch(() => {});
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
            {user?.role === "admin" && (
              <button className="btn btn-secondary" onClick={scan} disabled={scanning}>
                {ICONS.scan}
                {scanning ? "扫描中…" : "扫描 agents/ 目录"}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".tar.gz,.tgz"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "上传中…" : "上传我的 Agent（tar.gz）"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>名称</th>
                  <th>上传者</th>
                  <th className="num-col">积分</th>
                  <th>语言 · 网络</th>
                  <th>连通性自检</th>
                  <th>延迟</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a, idx) => {
                  const ck = checks[a.id] ?? {
                    status: a.selfcheckStatus,
                    latency: a.selfcheckDetail?.latencyMs ?? null,
                    error: a.selfcheckDetail?.error,
                  };
                  const mf = a.manifestJson;
                  const ranked = a.games > 0;
                  const rank = ranked ? agents.slice(0, idx).filter((x) => x.games > 0).length + 1 : 0;
                  return (
                    <tr key={a.id}>
                      <td className="num">{ranked ? `#${rank}` : "—"}</td>
                      <td className="num">{a.name}</td>
                      <td>
                        {a.ownerName ? (
                          <span className="tag st-pending">{a.ownerName}</span>
                        ) : (
                          <span className="tag st-ok">平台</span>
                        )}
                      </td>
                      <td className="num-col">
                        {ranked ? (
                          <>
                            <strong>{a.totalPoints}</strong>
                            <div className="meta" style={{ fontSize: 11, color: "var(--muted)" }}>
                              {a.wins}/{a.games} 胜 · MVP {a.mvps}
                            </div>
                          </>
                        ) : (
                          <span className="meta">未参赛</span>
                        )}
                      </td>
                      <td>
                        {mf ? `${mf.language.charAt(0).toUpperCase()}${mf.language.slice(1)} · ${mf.network}` : "—"}
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
                        {(user?.role === "admin" || a.ownerId === user?.id) && (
                          <span className="row" style={{ gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => selfcheck(a)}>
                              {ck.status === "busy" ? "检测中…" : "自检"}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => remove(a)}>
                              移除
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-hint">
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
