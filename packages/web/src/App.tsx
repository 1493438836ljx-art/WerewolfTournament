import { NavLink, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AgentsPage } from "./pages/Agents.js";
import { TournamentsPage } from "./pages/Tournaments.js";
import { TournamentDetail } from "./pages/TournamentDetail.js";
import { GameView } from "./pages/GameView.js";
import { RefereePage } from "./pages/Referee.js";
import "./styles.css";

export function App() {
  return (
    <Router>
      <nav className="nav">
        <h1>🐺 狼人杀 Agent 锦标赛</h1>
        <NavLink to="/" end>
          选手 Agent
        </NavLink>
        <NavLink to="/tournaments">锦标赛</NavLink>
        <NavLink to="/referee">裁判</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<AgentsPage />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />
        <Route path="/games/:id" element={<GameView />} />
        <Route path="/referee" element={<RefereePage />} />
      </Routes>
    </Router>
  );
}
