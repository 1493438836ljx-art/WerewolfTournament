import { Navigate, NavLink, Route, BrowserRouter as Router, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { AgentsPage } from "./pages/Agents.js";
import { TournamentsPage } from "./pages/Tournaments.js";
import { GameView } from "./pages/GameView.js";
import { RefereePage } from "./pages/Referee.js";
import { LoginPage } from "./pages/Login.js";
import { Logo, ProtocolDialog, RulesDialog, ToastHost, toast } from "./components.js";
import { logout, restore, useAuth } from "./auth.js";
import "./styles.css";

let restored = false;

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

function UserArea() {
  const user = useAuth();
  if (!user) return null;
  return (
    <span className="row" style={{ gap: 10 }}>
      <span className={`tag ${user.role === "admin" ? "st-warn" : "st-ok"}`}>
        {user.role === "admin" ? "管理员" : "选手"}
      </span>
      <span className="num" style={{ fontSize: 13 }}>
        {user.username}
      </span>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          logout();
          toast("已退出登录");
        }}
      >
        登出
      </button>
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

function Shell() {
  const user = useAuth();
  const loc = useLocation();
  const [booting, setBooting] = useState(!restored);

  useEffect(() => {
    if (!restored) {
      restored = true;
      void restore().finally(() => setBooting(false));
    } else {
      setBooting(false);
    }
  }, []);

  if (booting) return <main />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  void loc;
  return (
    <>
      <header className="topnav">
        <div className="container topnav-inner">
          <NavLink to="/" className="logo">
            <Logo />
            狼人杀 · Agent 锦标赛
          </NavLink>
          <Tabs />
          <UserArea />
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
    </>
  );
}

export function App() {
  return (
    <Router>
      <Shell />
      <ToastHost />
    </Router>
  );
}
