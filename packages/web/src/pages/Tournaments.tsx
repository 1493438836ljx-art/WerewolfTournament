import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type GameRow, type LeaderRow, type TournamentRow } from "../api.js";
import { StatusTag, toast } from "../components.js";
import { useAuth } from "../auth.js";

export function TournamentsPage() {
  const user = useAuth();
  const isAdmin = user?.role === "admin";
  const { id: selectedId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [tours, setTours] = useState<TournamentRow[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<{ tournament: TournamentRow; games: GameRow[] } | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);

  // 创建表单
  const [name, setName] = useState("");
  const [gamesPer, setGamesPer] = useState(2);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    api.listTournaments().then(setTours).catch(() => {});
    api.listAgents().then(setAgents).catch(() => {});
  }, []);

  const loadDetail = useCallback((tid: string) => {
    api.tournament(tid).then(setSelected).catch(() => setSelected(null));
    api.leaderboard(tid).then(setBoard).catch(() => setBoard([]));
  }, []);

  useEffect(() => {
    refreshList();
    const t = setInterval(refreshList, 5000);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else {
      setSelected(null);
      setBoard([]);
    }
  }, [selectedId, loadDetail]);

  // 选中态跟随列表刷新（对局进度实时）
  useEffect(() => {
    if (selected && tours.some((t) => t.id === selected.tournament.id && t.status !== selected.tournament.status)) {
      loadDetail(selected.tournament.id);
    }
  }, [tours]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!name.trim() || ids.length === 0) {
      setErr("名称与至少 1 个 agent 必填");
      return;
    }
    setErr("");
    setCreating(true);
    try {
      const r = await api.createTournament({ name: name.trim(), agentIds: ids, gamesPerAgent: gamesPer });
      const total = Math.max(1, Math.round((ids.length * gamesPer) / 9));
      toast(`已创建「${name.trim()}」· 预计 ${total} 局 · draft 状态`);
      setName("");
      setPicked({});
      refreshList();
      navigate(`/tournaments/${r.id}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
  };

  const start = async (t: TournamentRow) => {
    await api.startTournament(t.id).catch(() => {});
    refreshList();
    loadDetail(t.id);
    toast(`${t.name} 已开始 · 正在生成对局`);
    navigate(`/tournaments/${t.id}`);
  };

  const abort = async (t: TournamentRow) => {
    if (abortConfirm !== t.id) {
      setAbortConfirm(t.id);
      setTimeout(() => setAbortConfirm((c) => (c === t.id ? null : c)), 2600);
      return;
    }
    setAbortConfirm(null);
    await api.abortTournament(t.id).catch(() => {});
    refreshList();
    toast(`${t.name} 已中止 · 已完成对局照常结算`);
  };

  const doneGames = selected?.games.filter((g) => g.status === "done").length ?? 0;
  const totalGames = selected?.games.length ?? 0;

  return (
    <section className="section screen-pad">
      <div className="container">
        <div className="screen-head">
          <p className="eyebrow">COMPETITION · 赛制与积分</p>
          <h1 className="screen-title">锦标赛</h1>
          <p className="lead">
            循环赛：每局 9 人对局，座位与角色由密码学种子决定（种子入库可审计）。同分先比净胜局，再比违规次数。
          </p>
        </div>

        <div className="grid-1-2">
          {isAdmin ? (
          <div className="card">
            <h2 className="panel-title">创建锦标赛</h2>
            <div className="stack" style={{ gap: 16 }}>
              <div className="field">
                <label htmlFor="t-name">名称</label>
                <input
                  className="input"
                  id="t-name"
                  type="text"
                  placeholder="例如：周末排位 · 0912"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="t-games">每个 agent 局数（1–20）</label>
                <input
                  className="input num"
                  id="t-games"
                  type="number"
                  min={1}
                  max={20}
                  value={gamesPer}
                  onChange={(e) => setGamesPer(Math.max(1, Math.min(20, Number(e.target.value) || 2)))}
                  style={{ width: 120 }}
                />
              </div>
              <div className="field">
                <label>参赛 agent</label>
                <div className="chips">
                  {agents.map((a) => (
                    <label key={a.id} className="chip">
                      <input
                        type="checkbox"
                        checked={!!picked[a.id]}
                        onChange={(e) => setPicked((p) => ({ ...p, [a.id]: e.target.checked }))}
                      />
                      <span className="num">{a.name}</span>
                    </label>
                  ))}
                  {agents.length === 0 && <span className="meta">先到「选手 Agent」页注册</span>}
                </div>
              </div>
              {err && <p className="form-error">{err}</p>}
              <div>
                <button className="btn btn-primary" onClick={create} disabled={creating}>
                  {creating ? "创建中…" : "创建锦标赛"}
                </button>
              </div>
              <p className="meta" style={{ fontSize: 12 }}>
                参赛数 &lt; 9 时允许同一 agent 多副本参赛（开发/测试场景）
              </p>
            </div>
          </div>
          ) : (
            <div className="card">
              <h2 className="panel-title">参赛方式</h2>
              <p className="meta" style={{ fontSize: 13 }}>
                选手在「选手 Agent」页上传提交并自检通过后，由管理员编排锦标赛。
                你可以在右侧查看所有赛程、实时观战与积分榜。
              </p>
            </div>
          )}

          <div className="stack" style={{ gap: 20 }}>
            <div className="card">
              <h2 className="panel-title">锦标赛列表</h2>
              <div className="table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tours.map((t) => (
                      <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/tournaments/${t.id}`)}>
                        <td className="num">
                          <Link to={`/tournaments/${t.id}`} onClick={(e) => e.stopPropagation()}>
                            {t.name}
                          </Link>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <StatusTag status={t.status} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {isAdmin && t.status === "draft" && (
                            <button className="btn btn-secondary btn-sm" onClick={() => start(t)}>
                              开始比赛
                            </button>
                          )}
                          {isAdmin && t.status === "running" && (
                            <button className="btn btn-secondary btn-sm" onClick={() => abort(t)}>
                              {abortConfirm === t.id ? "确认中止？" : "中止"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {tours.length === 0 && (
                      <tr>
                        <td colSpan={3} className="empty-hint">
                          还没有锦标赛 —— 左侧表单创建第一个
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h2 className="panel-title" style={{ margin: 0 }}>
                  {selected ? `${selected.tournament.name} · 对局与积分` : "对局与积分"}
                  {selected && totalGames > 0 && (
                    <span className="meta" style={{ marginLeft: 10 }}>
                      {doneGames}/{totalGames}
                    </span>
                  )}
                </h2>
                {selected && <StatusTag status={selected.tournament.status} />}
              </div>

              {selected ? (
                <>
                  <div className="table-wrap">
                    <table className="ds-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>状态</th>
                          <th>胜方</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.games.map((g) => (
                          <tr key={g.id}>
                            <td className="num">第 {g.seq} 局</td>
                            <td>
                              <StatusTag status={g.status} />
                            </td>
                            <td>
                              {g.winnerFaction ? (
                                <span className={`tag ${g.winnerFaction === "werewolf" ? "role-wolf" : "st-ok"}`}>
                                  {g.winnerFaction === "werewolf" ? "狼人" : "好人"}
                                </span>
                              ) : (
                                <span className="meta">—</span>
                              )}
                            </td>
                            <td>
                              <Link className="btn btn-ghost btn-sm btn-arrow" to={`/games/${g.id}`}>
                                {g.status === "running" ? "实时观战" : "观战回放"}
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {board.length > 0 && (
                    <>
                      <h2 className="panel-title" style={{ margin: "20px 0 12px" }}>
                        积分榜
                      </h2>
                      <div className="table-wrap">
                        <table className="ds-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Agent</th>
                              <th className="num-col">积分</th>
                              <th className="num-col">胜/场</th>
                              <th className="num-col">MVP</th>
                              <th className="num-col">超时</th>
                            </tr>
                          </thead>
                          <tbody>
                            {board.map((r, i) => (
                              <tr key={r.agentId}>
                                <td className="num">{i + 1}</td>
                                <td className="num">{r.name}</td>
                                <td className="num-col">
                                  <strong>{r.points}</strong>
                                </td>
                                <td className="num-col">
                                  {r.wins}/{r.games}
                                </td>
                                <td className="num-col">{r.mvps}</td>
                                <td className="num-col">{r.timeouts}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="meta divider-note">
                        积分规则：胜方 +3 · MVP +1 · 超时 −0.1/次（每局上限 −1）· 取消资格该局 0 分且 −2
                      </p>
                    </>
                  )}
                </>
              ) : (
                <p className="empty-hint">从上方列表选择一个锦标赛查看对局与积分</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
