import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, type GameRow } from "../api.js";
import { useTopic, type BusEvent } from "../ws.js";
import { CAUSE_NAME, ICONS, ROLE_CLS, ROLE_NAME, StatusTag, toast } from "../components.js";

/* ─── 统一 UI 事件（WS 实时与 DB 回放共用同一转换） ─── */
type UiEvent =
  | { t: "phase"; mode: "night" | "day" | "over"; text: string; meta?: string }
  | { t: "dawn"; night: number; deaths: number[] }
  | { t: "hunter"; by: number; target: number | null }
  | { t: "order"; order: number[] }
  | { t: "speech" | "pk" | "campaign" | "lastwords"; seat: number; text: string }
  | { t: "timeout"; seat: number; which: string }
  | { t: "vote"; revote?: boolean; tally: Array<{ voter: number; target: number | null }>; eliminated: number | null; pk: number[]; sheriff?: boolean }
  | { t: "sheriffElected"; seat: number | null }
  | { t: "sheriffTransfer"; from: number; to: number | null }
  | { t: "dq"; seat: number; reason: string }
  | { t: "win"; faction: string; reason: string }
  | { t: "reveal"; seats: Array<{ seat: number; role: string }> };

function fromBusEvent(kind: string, payload: Record<string, unknown>): UiEvent | null {
  // 动态事件负载入口：宽松索引（zod 校验在采集侧完成）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as Record<string, any>;
  switch (kind) {
    case "night_begun":
      return { t: "phase", mode: "night", text: `第 ${p.night} 夜 · 行动中`, meta: `第 ${p.night} 夜 · 私有通道行动` };
    case "dawn_deaths":
      return { t: "dawn", night: p.night, deaths: p.deaths };
    case "speech_order":
      return { t: "order", order: p.order };
    case "speech":
      if (p.kind === "campaign") return { t: "campaign", seat: p.seat, text: p.text };
      return { t: p.kind === "pk" ? "pk" : "speech", seat: p.seat, text: p.text };
    case "last_words":
      return { t: "lastwords", seat: p.seat, text: p.text };
    case "sheriff_elected":
      return { t: "sheriffElected", seat: p.seat };
    case "sheriff_transfer":
      return { t: "sheriffTransfer", from: p.from, to: p.to };
    case "hunter_shot":
      return { t: "hunter", by: p.by, target: p.target };
    case "timeout_default":
      return { t: "timeout", seat: p.seat, which: String(p.which) };
    case "player_disqualified":
      return { t: "dq", seat: p.seat, reason: p.reason };
    case "vote_result":
      return {
        t: "vote",
        revote: p.round === 2,
        tally: p.tally,
        eliminated: p.eliminated,
        pk: p.pk_candidates ?? [],
        sheriff: !!p.sheriff,
      };
    case "win":
      return { t: "win", faction: p.faction, reason: p.reason };
    case "reveal":
      return { t: "reveal", seats: p.seats };
    case "game_started":
      return { t: "phase", mode: "over", text: "对局开始 · 天黑请闭眼", meta: "9 人局 · 屠边制" };
    default:
      return null;
  }
}

/* ─── feed 项 ─── */
type FeedItem =
  | { kind: "msg"; who: string; text: string; cls?: string }
  | { kind: "sys"; icon: keyof typeof ICONS; html: React.ReactNode; bad?: boolean }
  | { kind: "vote"; revote?: boolean; tally: Array<{ voter: number; target: number | null }>; note: React.ReactNode };

interface SeatView {
  seat: number;
  name: string;
  alive: boolean;
  death?: { cause: string; turn: number };
}

/** 可嵌入的对局面板：座位环 + 事件流 + 实时直播/回放控制（详情页与独立路由共用） */
export function GamePanel({ gameId: fixedId }: { gameId: string }) {
  const [gameId, setGameId] = useState<string | null>(fixedId);
  const [game, setGame] = useState<GameRow | null>(null);
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [roleMap, setRoleMap] = useState<Record<number, string>>({});
  const [isLive, setIsLive] = useState(false);

  // 回放事件
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [gIdx, setGIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // 渲染状态
  const [phase, setPhase] = useState<{ mode: "night" | "day" | "over"; text: string; meta?: string }>({
    mode: "over",
    text: "等待开始",
  });
  const [deadMap, setDeadMap] = useState<Record<number, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedEnd = useRef<HTMLDivElement>(null);

  const seatName = useCallback((i: number) => seats.find((s) => s.seat === i)?.name ?? "", [seats]);

  const applyEvent = useCallback((ev: UiEvent) => {
    const add = (f: FeedItem) => setFeed((old) => [...old.slice(-200), f]);
    switch (ev.t) {
      case "phase":
        setPhase({ mode: ev.mode, text: ev.text, meta: ev.meta });
        if (ev.mode === "night") {
          add({ kind: "sys", icon: "moon", html: <>夜晚行动经私有通道回复，旁观视角不可见</> });
          setSpeaking(null);
        }
        break;
      case "dawn": {
        setPhase({ mode: "day", text: `第 ${ev.night} 天 · 黎明`, meta: `第 ${ev.night} 夜结算` });
        if (ev.deaths.length) {
          setDeadMap((d) => ({ ...d, ...Object.fromEntries(ev.deaths.map((s) => [s, "out"] as const)) }));
          add({
            kind: "sys",
            icon: "skull",
            bad: true,
            html: (
              <>
                天亮，昨夜 <span className="num">{ev.deaths.join("、")}</span> 号倒下（不公布死因）
              </>
            ),
          });
        } else {
          add({ kind: "sys", icon: "sun", html: <>天亮，平安夜</> });
        }
        break;
      }
      case "hunter": {
        const target = ev.target;
        if (target != null) {
          setDeadMap((d) => ({ ...d, [target]: "hunter" }));
          add({
            kind: "sys",
            icon: "scope",
            bad: true,
            html: (
              <>
                <span className="num">{ev.by}</span> 号翻牌猎人，开枪带走 <span className="num">{ev.target}</span> 号
              </>
            ),
          });
        } else {
          add({ kind: "sys", icon: "scope", html: <><span className="num">{ev.by}</span> 号翻牌猎人，未开枪</> });
        }
        break;
      }
      case "order":
        add({ kind: "sys", icon: "order", html: <>发言顺序：<span className="num">{ev.order.join(" → ")}</span></> });
        break;
      case "speech":
      case "pk":
      case "campaign":
      case "lastwords":
        add({
          kind: "msg",
          who: `${ev.seat} 号 · ${ev.t === "pk" ? "PK 辩词" : ev.t === "campaign" ? "竞选发言" : ev.t === "lastwords" ? "遗言" : "发言"}`,
          text: ev.text,
          cls: ev.t === "pk" || ev.t === "campaign" ? "pk" : ev.t === "lastwords" ? "lastwords" : undefined,
        });
        setSpeaking(ev.seat);
        break;
      case "sheriffElected":
        add({
          kind: "sys",
          icon: "trophy",
          html: ev.seat != null ? <><span className="num">{ev.seat}</span> 号当选警长（放逐投票 1.5 票）</> : <>警长竞选平票 · 本局无警徽</>,
        });
        break;
      case "sheriffTransfer":
        add({
          kind: "sys",
          icon: "trophy",
          html: ev.to != null
            ? <>警徽移交：<span className="num">{ev.from}</span> 号 → <span className="num">{ev.to}</span> 号</>
            : <><span className="num">{ev.from}</span> 号撕掉警徽</>,
        });
        break;
      case "timeout":
        add({
          kind: "sys",
          icon: "clock",
          bad: true,
          html: (
            <>
              <span className="num">{ev.seat}</span> 号{ev.which}超时，平台已代答 · penalty <span className="num">−0.1</span>
            </>
          ),
        });
        setSpeaking(ev.seat);
        break;
      case "vote": {
        const eliminated = ev.eliminated;
        const note = ev.sheriff
          ? ev.pk.length
            ? `警长竞选平票：${ev.pk.join("、")} 号进入 PK`
            : "警长竞选投票完成"
          : ev.pk.length
            ? `平票：${ev.pk.join("、")} 号进入 PK 辩词`
            : eliminated != null
              ? `${eliminated} 号被放逐${ev.revote ? "（PK 者不参与再投票）" : ""}`
              : "平安日，无人出局";
        add({ kind: "vote", revote: ev.revote, tally: ev.tally, note });
        if (eliminated != null && !ev.sheriff) setDeadMap((d) => ({ ...d, [eliminated]: "vote" }));
        setSpeaking(null);
        break;
      }
      case "dq":
        setDeadMap((d) => ({ ...d, [ev.seat]: "disqualify" }));
        add({
          kind: "sys",
          icon: "skull",
          bad: true,
          html: (
            <>
              <span className="num">{ev.seat}</span> 号因违规被取消资格 · {ev.reason}
            </>
          ),
        });
        break;
      case "win":
        setPhase({ mode: "over", text: `对局结束 · ${ev.faction === "werewolf" ? "狼人阵营" : "好人阵营"}获胜`, meta: ev.reason });
        add({
          kind: "msg",
          who: "胜方",
          text: `${ev.faction === "werewolf" ? "狼人阵营" : "好人阵营"}获胜（${ev.reason}）`,
          cls: "win-msg",
        });
        setSpeaking(null);
        break;
      case "reveal":
        setRevealed(true);
        setRoleMap(Object.fromEntries(ev.seats.map((s) => [s.seat, s.role])));
        add({ kind: "sys", icon: "trophy", html: <>全员翻牌 · 对局事件流已入档，可审计重放</> });
        break;
    }
  }, []);

  /* ─── 数据加载（gameId 切换时全量重置） ─── */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const gid = fixedId;
      let g: GameRow | null = null;
      setFeed([]);
      setDeadMap({});
      setRevealed(false);
      setSpeaking(null);
      setPhase({ mode: "over", text: "等待开始", meta: "9 人局 · 屠边" });
      setPlaying(false);
      setGIdx(0);
      try {
        const d = await api.game(gid);
        if (cancelled) return;
        g = d.game;
        setGame(d.game);
        if (d.seats.length) {
          setSeats(d.seats.map((s) => ({ seat: s.seat, name: agentNameOf(s.agentId), alive: s.alive })));
          setRoleMap(Object.fromEntries(d.seats.map((s) => [s.seat, s.role])));
          if (d.game.status === "done") setRevealed(true);
        }
      } catch {
        /* 对局可能还没写 seats */
      }
      if (!g) return;
      const live = g.status === "running";
      setIsLive(live);
      setGameId(gid);
      if (!live) {
        // 回放模式：拉全量事件
        const text = await api.gameEvents(gid).catch(() => "");
        if (cancelled) return;
        const evs: UiEvent[] = [];
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const raw = JSON.parse(line) as { kind: string; payload: unknown };
            const ev = fromBusEvent(raw.kind, (raw.payload ?? {}) as Record<string, unknown>);
            if (ev) evs.push(ev);
          } catch {
            /* skip */
          }
        }
        setEvents(evs);
        setGIdx(0);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fixedId]);

  // seats 名称回填（实时模式 snapshot 提供）
  const nameCache = useRef(new Map<string, string>());
  function agentNameOf(agentId: string): string {
    return nameCache.current.get(agentId) ?? agentId.slice(0, 12);
  }

  /* ─── WS 实时 ─── */
  const onEvent = useCallback(
    (ev: BusEvent) => {
      if (ev.kind === "snapshot") {
        const snap = ev.payload as { seats: SeatView[]; alive: number[] };
        if (snap.seats?.length) setSeats(snap.seats);
        return;
      }
      if (ev.kind === "violation") return;
      const ui = fromBusEvent(ev.kind, (ev.payload ?? {}) as Record<string, unknown>);
      if (ui) applyEvent(ui);
    },
    [applyEvent],
  );
  useTopic(isLive && gameId ? `game/${gameId}` : null, onEvent);

  /* ─── 回放器 ─── */
  useEffect(() => {
    if (!playing) return;
    if (gIdx >= events.length) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      applyEvent(events[gIdx]!);
      setGIdx((i) => i + 1);
    }, 1500 / speed);
    return () => clearTimeout(timer);
  }, [playing, gIdx, events, speed, applyEvent]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feed.length]);

  const step = () => {
    if (gIdx >= events.length) resetReplay();
    else {
      applyEvent(events[gIdx]!);
      setGIdx((i) => i + 1);
    }
  };
  const resetReplay = () => {
    setPlaying(false);
    setGIdx(0);
    setDeadMap({});
    setRevealed(game?.status === "done" && !!Object.keys(roleMap).length ? game.status === "done" : false);
    setSpeaking(null);
    setFeed([]);
    setPhase({ mode: "over", text: "等待开始", meta: "9 人局 · 屠边" });
    if (game?.status === "done" && seats.length) setRevealed(true);
  };

  const aliveCount = seats.length - Object.keys(deadMap).length;
  const phaseIcon = phase.mode === "night" ? ICONS.moon : phase.mode === "day" ? ICONS.sun : ICONS.clock;
  const hubLabel = phase.mode === "night" ? "夜 · 存活" : phase.mode === "day" ? "昼 · 存活" : "存活";

  const ringSeats = useMemo(() => seats, [seats]);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <h2 className="panel-title" style={{ margin: 0 }}>
          对局
          <span className="meta" style={{ marginLeft: 10, fontWeight: 400 }}>
            板型 9 人 · 屠边制 · 种子 <span className="num">{game?.id.slice(5, 13) ?? "…"}</span>
          </span>
        </h2>
        <div className="row" style={{ gap: 8 }}>
          {game && <StatusTag status={game.status} />}
          {game?.winnerFaction && (
            <span className={`tag ${game.winnerFaction === "werewolf" ? "role-wolf" : "st-ok"}`}>
              {game.winnerFaction === "werewolf" ? "狼人胜" : "好人胜"}
            </span>
          )}
          {!isLive && events.length > 0 && (
            <span className="progress-note">
              事件 {gIdx}/{events.length}
            </span>
          )}
        </div>
      </div>

      <div className="replay-bar" style={{ marginBottom: 12 }}>
        {!isLive && (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => (gIdx >= events.length ? (resetReplay(), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? ICONS.pause : ICONS.play}
              <span>{playing ? "暂停" : gIdx >= events.length ? "重播" : "播放"}</span>
            </button>
            <button className="btn btn-secondary btn-sm" onClick={step}>
              单步
            </button>
            <span className="seg" role="group" aria-label="回放速度">
              {[1, 2, 4].map((s) => (
                <button key={s} data-speed={s} className={speed === s ? "active" : ""} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                resetReplay();
                toast("已重置回放 · 从第 1 夜开始");
              }}
            >
              重放
            </button>
          </>
        )}
      </div>

      <div className="grid-2">
        <div>
          <div className={`phase-strip ${phase.mode}`}>
            <span className="ph-label">
              {phaseIcon}
              <span>{phase.text}</span>
            </span>
            <span className="meta">{phase.meta ?? "9 人局 · 屠边"}</span>
          </div>

          <div className="seat-ring">
            <div className="ring-hub">
              <div className="hub-phase">{hubLabel}</div>
              <div className="hub-alive num">
                <span>{aliveCount}</span>
                <small> / {seats.length || 9}</small>
              </div>
            </div>
            {ringSeats.map((s, i) => {
              const ang = (-90 + i * (360 / (ringSeats.length || 9))) * (Math.PI / 180);
              const R = 36.5;
              const dead = deadMap[s.seat];
              return (
                <div
                  key={s.seat}
                  className={`seat ${dead ? "dead" : ""} ${speaking === s.seat ? "speaking" : ""}`}
                  style={{ left: `${50 + R * Math.cos(ang)}%`, top: `${50 + R * Math.sin(ang)}%` }}
                >
                  <div className="no num">{s.seat}</div>
                  <div className="nm">{s.name}</div>
                  <div className="rl">
                    {(() => {
                      const role = revealed ? roleMap[s.seat] : undefined;
                      if (role) {
                        return (
                          <span className={`tag ${ROLE_CLS[role] ?? ""}`}>{ROLE_NAME[role] ?? role}</span>
                        );
                      }
                      return dead ? (
                          <span className="tag st-fail">{CAUSE_NAME[dead] ?? "出局"}</span>
                        ) : (
                          <span className="meta" style={{ fontSize: 11 }}>
                            存活
                          </span>
                        );
                    })()}
                  </div>
                </div>
              );
            })}
            {ringSeats.length === 0 && <p className="empty-hint">等待对局数据…</p>}
          </div>
        </div>

        <div className="card">
          <h2 className="panel-title">现场</h2>
          <div className="feed">
            {feed.length === 0 && (
              <div className="sysline">
                {ICONS.clock}
                <span>
                  {isLive ? "实时事件流等待推送……" : "回放已就绪——按「播放」逐事件重放这局比赛，或用「单步」逐步检视。"}
                </span>
              </div>
            )}
            {feed.map((f, i) => {
              if (f.kind === "msg")
                return (
                  <div key={i} className={`msg ${f.cls ?? ""}`}>
                    <div className="who">{f.who}</div>
                    <div>{f.text}</div>
                  </div>
                );
              if (f.kind === "vote")
                return (
                  <div key={i} className="msg">
                    <div className="who">投票{f.revote ? " · PK 再投票" : ""}</div>
                    <div className="tally">
                      {f.tally.map((b, j) => (
                        <span key={j} className="vote">
                          {b.voter}→{b.target ?? "弃"}
                        </span>
                      ))}
                    </div>
                    <div>{f.note}</div>
                  </div>
                );
              const Icon = ICONS[f.icon];
              return (
                <div key={i} className={`sysline ${f.bad ? "bad-note" : ""}`}>
                  {Icon}
                  <span>{f.html}</span>
                </div>
              );
            })}
            <div ref={feedEnd} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** 路由壳：/games/:id 有所属比赛则跳转详情页（观战内嵌其中），独立局直接渲染面板 */
export function GameView() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [redirected, setRedirected] = useState(false);

  useEffect(() => {
    if (!id || redirected) return;
    void api
      .game(id)
      .then((d) => {
        if (d.game?.tournamentId) {
          setRedirected(true);
          navigate(`/tournaments/${d.game.tournamentId}`, { replace: true });
        }
      })
      .catch(() => {});
  }, [id, redirected, navigate]);

  if (!id) return <Navigate to="/tournaments" replace />;
  if (redirected) return null;
  return (
    <section className="section screen-pad">
      <div className="container">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/tournaments")}>
          ← 返回列表
        </button>
        <div style={{ marginTop: 16 }}>
          <GamePanel gameId={id} />
        </div>
      </div>
    </section>
  );
}

function gameName(g: GameRow): string {
  return g.tournamentId ? `锦标赛 ${g.tournamentId.slice(0, 8)}` : "独立对局";
}
