import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type GameRow, type LeaderRow, type TournamentRow } from "../api.js";
import { StatusTag, toast } from "../components.js";
import { useAuth } from "../auth.js";
import { GamePanel } from "./GameView.js";

type Kind = "training" | "official";

const KIND_TXT: Record<Kind, string> = { training: "训练赛", official: "正式比赛" };

export function TournamentsPage() {
  const user = useAuth();
  const isAdmin = user?.role === "admin";
  const { id: selectedId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [kindSel, setKindSel] = useState<Kind>("training");

  const [tours, setTours] = useState<TournamentRow[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<{ tournament: TournamentRow; games: GameRow[] } | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);

  // 创建表单
  const [rounds, setRounds] = useState(1);
  const [concurrency, setConcurrency] = useState(1);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [abortConfirm, setAbortConfirm] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);
  // 默认观看：进行中的局，否则第一局（比赛对象变化时自动跟随）
  const defaultWatch = useMemo(() => {
    if (!selected?.games.length) return null;
    const running = selected.games.find((g) => g.status === "running");
    return (running ?? selected.games[0])!.id;
  }, [selected]);
  const effectiveWatch = watchId && selected?.games.some((g) => g.id === watchId) ? watchId : defaultWatch;

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
    const pickedCount = Object.values(picked).filter(Boolean).length;
    if (kindSel === "training" && pickedCount !== 9) {
      setErr(`须恰好选择 9 个不同的 agent（已选 ${pickedCount} 个）`);
      return;
    }
    setErr("");
    setCreating(true);
    try {
      const r =
        kindSel === "official"
          ? await api.createTournament({ kind: "official", officialRounds: rounds, maxConcurrentGames: concurrency })
          : await api.createTournament({
              kind: "training",
              agentIds: Object.keys(picked).filter((k) => picked[k]),
            });
      const total = selected;
      void total;
      toast(
        kindSel === "official"
          ? `正式比赛已创建并开赛 · 全员参与 · ${rounds} 轮`
          : `训练赛已创建并开赛`,
      );
      setPicked({});
      refreshList();
      navigate(`/tournaments/${r.id}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
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

  const visibleTours = tours.filter((t) => (t.kind ?? "training") === kindSel);
  const doneGames = selected?.games.filter((g) => g.status === "done").length ?? 0;
  const totalGames = selected?.games.length ?? 0;

  // ─── 详情视图：选中某场比赛时全宽展示（创建表单不占屏） ───
  if (selectedId && selected) {
    const t = selected.tournament;
    const canCtrl = isAdmin || t.createdBy === user?.id;
    return (
      <section className="section screen-pad">
        <div className="container">
          <div className="screen-head row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/tournaments")}>
                ← 返回列表
              </button>
              <h1 className="screen-title" style={{ marginTop: 10 }}>
                {t.name}
              </h1>
              <p className="lead">
                {KIND_TXT[(t.kind as Kind) ?? "training"]} ·{" "}
                {totalGames > 1 ? `${totalGames} 局（已完成 ${doneGames}）` : totalGames === 1 && doneGames === 1 ? "已结束" : totalGames === 1 ? "进行中" : "未开始"}
                {" "}· 座位与角色由种子随机决定
              </p>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <span className={`tag ${t.kind === "official" ? "st-warn" : "st-pending"}`}>
                {KIND_TXT[(t.kind as Kind) ?? "training"] ?? "训练赛"}
              </span>
              <StatusTag status={t.status} />
              {canCtrl && t.status === "running" && (
                <button className="btn btn-secondary btn-sm" onClick={() => abort(t)}>
                  {abortConfirm === t.id ? "确认中止？" : "中止"}
                </button>
              )}
            </div>
          </div>

          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="card">
              <h2 className="panel-title">对局{selected.games.length > 1 ? ` · ${selected.games.length} 局，点击切换下方观战` : " · 下方实时观战/回放"}</h2>
              <div className="table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>状态</th>
                      <th>胜方</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.games.map((g) => (
                      <tr
                        key={g.id}
                        style={{ cursor: selected.games.length > 1 ? "pointer" : "default" }}
                        className={g.id === watchId ? "sel-row" : undefined}
                        onClick={() => selected.games.length > 1 && setWatchId(g.id)}
                      >
                        <td className="num">{selected.games.length > 1 ? `#${g.seq}` : "对局"}</td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h2 className="panel-title">积分榜</h2>
              {board.length === 0 ? (
                <p className="empty-hint">对局完成后生成积分</p>
              ) : (
                <>
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
            </div>
          </div>

          {effectiveWatch && (
            <div style={{ marginTop: 20 }}>
              <GamePanel gameId={effectiveWatch} />
            </div>
          )}
        </div>
      </section>
    );
  }

  // ─── 列表视图 ───
  return (
    <section className="section screen-pad">
      <div className="container">
        <div className="screen-head">
          <div className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <p className="eyebrow">COMPETITION · 训练赛与正式比赛</p>
              <h1 className="screen-title">比赛</h1>
              <p className="lead">
                训练赛自由编排随时打；正式比赛全员参与、系统轮转安排所有人轮流上场，座位与角色由密码学种子决定。
              </p>
            </div>
            <span className="seg" role="group" aria-label="比赛类型">
              <button className={kindSel === "training" ? "active" : ""} onClick={() => setKindSel("training")}>
                训练赛
              </button>
              <button className={kindSel === "official" ? "active" : ""} onClick={() => setKindSel("official")}>
                正式比赛
              </button>
            </span>
          </div>
        </div>

        <div className="grid-1-2">
          {isAdmin || kindSel === "training" ? (
            <div className="card">
              <h2 className="panel-title">创建{KIND_TXT[kindSel]}</h2>
              <div className="stack" style={{ gap: 16 }}>
                <p className="meta" style={{ fontSize: 12 }}>
                  比赛名将自动生成：你的用户名 · 类型 · 时间
                </p>

                {kindSel === "official" ? (
                  <>
                    <div className="field">
                      <label htmlFor="t-rounds">轮数（每轮所有 agent 轮流上场一局，1–10）</label>
                      <input
                        className="input num"
                        id="t-rounds"
                        type="number"
                        min={1}
                        max={10}
                        value={rounds}
                        onChange={(e) => setRounds(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                        style={{ width: 120 }}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="t-conc">本场并发对局数（1–10）</label>
                      <input
                        className="input num"
                        id="t-conc"
                        type="number"
                        min={1}
                        max={10}
                        value={concurrency}
                        onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                        style={{ width: 120 }}
                      />
                    </div>
                    <p className="meta" style={{ fontSize: 12.5, whiteSpace: "normal" }}>
                      1 轮 = 所有 {agents.length} 个 agent 各上场打一局（每局 9 人桌，随机分组；尾局不足自动轮转补位）。
                      轮数 = 重复多少个这样的周期（多轮分组更随机、成绩更稳）。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label>
                        参赛 agent（{Object.values(picked).filter(Boolean).length}/9，须选满 9 个不同的 agent）
                      </label>
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
                    <p className="meta" style={{ fontSize: 12 }}>
                      {isAdmin
                        ? "一场训练赛 = 一局，9 个不同 agent 同桌对打"
                        : "约战制：至少包含你自己上传的一个 agent；其余对手任选（可用平台 bot 凑数）"}
                    </p>
                  </>
                )}

                {err && <p className="form-error">{err}</p>}
                <div>
                  <button
                    className="btn btn-primary"
                    onClick={create}
                    disabled={creating || (kindSel === "training" && Object.values(picked).filter(Boolean).length !== 9)}
                  >
                    {creating ? "创建中…" : `创建${KIND_TXT[kindSel]}`}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2 className="panel-title">正式比赛说明</h2>
              <p className="meta" style={{ fontSize: 13, whiteSpace: "normal" }}>
                正式比赛由管理员编排：所有通过自检的 agent 自动参赛，系统安排全员轮流上场。
                你可以在右侧查看赛程、实时观战与积分榜。想练手？切到「训练赛」自己约一桌。
              </p>
            </div>
          )}

          <div className="stack" style={{ gap: 20 }}>
            <div className="card">
              <h2 className="panel-title">{KIND_TXT[kindSel]}列表</h2>
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
                    {visibleTours.map((t) => (
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
                          {(isAdmin || t.createdBy === user?.id) && t.status === "running" && (
                            <button className="btn btn-secondary btn-sm" onClick={() => abort(t)}>
                              {abortConfirm === t.id ? "确认中止？" : "中止"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {visibleTours.length === 0 && (
                      <tr>
                        <td colSpan={3} className="empty-hint">
                          暂无{KIND_TXT[kindSel]}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
