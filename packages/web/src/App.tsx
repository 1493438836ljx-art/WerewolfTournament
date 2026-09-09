import { Navigate, NavLink, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { AgentsPage } from "./pages/Agents.js";
import { TournamentsPage } from "./pages/Tournaments.js";
import { GameView } from "./pages/GameView.js";
import { RefereePage } from "./pages/Referee.js";
import { Logo, ProtocolDialog, RulesDialog, ToastHost } from "./components.js";
import "./styles.css";

function EngineStatus() {
  const [mode, setMode] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/referee/health")
        .then((r) => r.json())
        .then((d) => setMode(d.mode))
        .catch(() => setMode(null));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={`tag ${mode ? "st-ok" : "st-pending"}`}>
      <span className="dot" />
      引擎在线 · 裁判 {mode ?? "…"}
    </span>
  );
}

function Tabs() {
  const loc = useLocation();
  const current = loc.pathname.startsWith("/tournaments")
    ? "tournaments"
    : loc.pathname.startsWith("/games")
      ? "game"
      : loc.pathname.startsWith("/referee")
        ? "referee"
        : "agents";
  const items = [
    { key: "agents", to: "/", label: "选手 Agent" },
    { key: "tournaments", to: "/tournaments", label: "锦标赛" },
    { key: "game", to: "/games", label: "对局观战" },
    { key: "referee", to: "/referee", label: "裁判" },
  ];
  return (
    <nav className="tabs" aria-label="模块导航">
      {items.map((it) => (
        <NavLink key={it.key} to={it.to} className="tab" aria-current={current === it.key ? "page" : undefined}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function App() {
  return (
    <Router>
      <header className="topnav">
        <div className="container topnav-inner">
          <NavLink to="/" className="logo">
            <Logo />
            狼人杀 · Agent 锦标赛
          </NavLink>
          <Tabs />
          <EngineStatus />
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<AgentsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentsPage />} />
          <Route path="/games" element={<GameView />} />
          <Route path="/games/:id" element={<GameView />} />
          <Route path="/referee" element={<RefereePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="pagefoot">
        <div className="container row-between">
          <span>© 2026 狼人杀 Agent 锦标赛平台 · 确定性引擎 · 可重放审计</span>
          <span className="row" style={{ gap: 14 }}>
            <ProtocolDialog variant="link" />
            <span aria-hidden="true" style={{ color: "var(--border)" }}>·</span>
            <RulesDialog />
            <span aria-hidden="true" style={{ color: "var(--border)" }}>·</span>
            <span className="meta">docs/PROTOCOL.md · docs/RULES.md</span>
          </span>
        </div>
      </footer>

      <ToastHost />
    </Router>
  );
}
