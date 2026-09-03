import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

interface Health {
  mode: string;
  llmConfigured: boolean;
  breaker: { consecutiveFailures: number; open: boolean };
}

export function RefereePage() {
  const [h, setH] = useState<Health | null>(null);
  const refresh = useCallback(() => {
    fetch("/api/referee/health").then((r) => r.json()).then(setH).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const setMode = (mode: string) => {
    fetch("/api/admin/referee/mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }).then(refresh);
  };

  return (
    <div className="page">
      <div className="panel">
        <h2>裁判（LLM Referee）</h2>
        {h ? (
          <>
            <div className="kv"><span className="muted">模式</span><span className={`tag running`}>{h.mode}</span></div>
            <div className="kv"><span className="muted">LLM 配置</span><span>{h.llmConfigured ? "✅ 已配置（读环境变量）" : "⚠️ 未配置（纯模板模式）"}</span></div>
            <div className="kv"><span className="muted">熔断器</span><span>{h.breaker.open ? "🔴 开路（降级中，冷却后自动半开）" : `🟢 正常（连续失败 ${h.breaker.consecutiveFailures}）`}</span></div>
            <div className="row" style={{ marginTop: 16 }}>
              {["hybrid", "llm", "template"].map((m) => (
                <button key={m} className={h.mode === m ? "primary" : ""} onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              hybrid=LLM 可用则用、失败降级模板；llm=仅 LLM；template=仅模板（不消耗 token）。
              规则判定始终由确定性引擎执行，裁判模式不影响胜负。
            </p>
          </>
        ) : (
          <span className="muted">加载中…</span>
        )}
      </div>
      <div className="nav" style={{ border: "none" }}>
        <NavLink to="/tournaments">← 返回锦标赛</NavLink>
      </div>
    </div>
  );
}
