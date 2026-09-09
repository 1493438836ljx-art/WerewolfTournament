import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { StatusTag, toast } from "../components.js";

interface Health {
  mode: string;
  llmConfigured: boolean;
  breaker: { consecutiveFailures: number; open: boolean };
}

interface CallRow {
  id: number;
  purpose: string;
  model: string;
  tokens: number;
  ok: boolean;
  latencyMs: number;
  createdAt: string;
}

const MODE_DESC: Record<string, string> = {
  hybrid: "LLM 可用则用，失败自动降级模板",
  llm: "仅 LLM（不可用时降级放行）",
  template: "仅模板 · 不消耗 token",
};

const PURPOSE_TXT: Record<string, string> = {
  announce: "主持公告",
  arbitrate: "发言仲裁",
  mvp: "MVP 评选",
  agent_proxy: "选手决策（代理）",
};

export function RefereePage() {
  const [h, setH] = useState<Health | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);

  const refresh = useCallback(() => {
    api.refereeHealth().then(setH).catch(() => {});
    fetch("/api/referee/calls")
      .then((r) => r.json())
      .then(setCalls)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const setMode = async (mode: string) => {
    await api.setRefereeMode(mode).catch(() => {});
    refresh();
    toast(`裁判模式已切换为 ${mode} · 规则判定不受影响`);
  };

  return (
    <section className="section screen-pad">
      <div className="container">
        <div className="screen-head">
          <p className="eyebrow">LLM REFEREE · 主持与仲裁</p>
          <h1 className="screen-title">裁判</h1>
          <p className="lead">
            裁判只负责主持公告、发言内容仲裁与 MVP 评选；规则判定始终由确定性引擎执行，裁判模式不影响胜负。
          </p>
        </div>

        <div className="grid-3">
          <div className="card">
            <h2 className="panel-title">裁判模式</h2>
            <div className="seg" role="group" aria-label="裁判模式">
              {["hybrid", "llm", "template"].map((m) => (
                <button key={m} data-mode={m} className={h?.mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
            </div>
            <p className="meta" style={{ marginTop: 14, fontSize: 12.5 }}>
              {h ? MODE_TXT(h.mode) : "…"}
            </p>
          </div>
          <div className="card">
            <h2 className="panel-title">LLM 配置</h2>
            <div className="kv">
              <span className="k">状态</span>
              {h?.llmConfigured ? <StatusTag status="ok" text="已配置" /> : <StatusTag status="pending" text="未配置（模板模式）" />}
            </div>
            <div className="kv">
              <span className="k">读取方式</span>
              <span>环境变量</span>
            </div>
            <div className="kv">
              <span className="k">代理端点</span>
              <span className="num">WT_LLM_PROXY_URL</span>
            </div>
          </div>
          <div className="card">
            <h2 className="panel-title">熔断器</h2>
            <div className="kv">
              <span className="k">状态</span>
              {h?.breaker.open ? <StatusTag status="fail" text="开路（降级中）" /> : <StatusTag status="ok" text="闭合（正常）" />}
            </div>
            <div className="kv">
              <span className="k">连续失败</span>
              <span className="num">{h?.breaker.consecutiveFailures ?? 0}</span>
            </div>
            <div className="kv">
              <span className="k">恢复策略</span>
              <span>开路冷却后自动半开</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="panel-title">最近 LLM 调用</h2>
          {calls.length === 0 ? (
            <p className="empty-hint">暂无调用记录 —— 跑一局带 LLM 的对局后，这里显示裁判与选手代理的调用审计</p>
          ) : (
            <div className="table-wrap">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>用途</th>
                    <th>模型</th>
                    <th className="num-col">tokens</th>
                    <th className="num-col">延迟</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.id}>
                      <td className="meta">{new Date(c.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                      <td>{PURPOSE_TXT[c.purpose] ?? c.purpose}</td>
                      <td className="num">{c.model || "—"}</td>
                      <td className="num-col">{c.tokens}</td>
                      <td className="num-col">{c.latencyMs}ms</td>
                      <td>{c.ok ? <StatusTag status="ok" text="ok" /> : <StatusTag status="fail" text="fail" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MODE_TXT(mode: string) {
  return MODE_DESC[mode] ?? mode;
}
