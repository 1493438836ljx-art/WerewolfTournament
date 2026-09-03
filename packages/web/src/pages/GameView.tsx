import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type GameRow } from "../api.js";
import { useTopic, type BusEvent } from "../ws.js";

interface SeatView {
  seat: number;
  name: string;
  alive: boolean;
  death?: { cause: string; turn: number };
}
interface Snapshot {
  gameId: string;
  night: number;
  day: number;
  phase: string;
  alive: number[];
  seats: SeatView[];
  winner?: { faction: string; reason: string };
}

interface FeedItem {
  id: string;
  type: "speech" | "last_words" | "pk" | "notice" | "vote" | "tally";
  seat?: number;
  text?: string;
  extra?: unknown;
}

export function GameView() {
  const { id } = useParams<{ id: string }>();
  const [game, setGame] = useState<GameRow | null>(null);
  const [revealed, setRevealed] = useState<Array<{ seat: number; role: string; faction: string; teamWon: boolean | null }> | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [live, setLive] = useState(true);
  const feedEnd = useRef<HTMLDivElement>(null);

  const loadMeta = useCallback(() => {
    if (!id) return;
    api.game(id).then((d) => {
      setGame(d.game);
      setRevealed(d.game.status === "done" ? d.seats.map((s) => ({ seat: s.seat, role: s.role, faction: s.teamWon ? (s.role === "werewolf" ? "werewolf" : "village") : s.role === "werewolf" ? "werewolf" : "village", teamWon: s.teamWon })) : null);
    }).catch(() => {});
  }, [id]);
  useEffect(loadMeta, [loadMeta]);

  // 已结束的对局：拉取全量事件回放
  useEffect(() => {
    if (!id || !game || game.status !== "done") return;
    setLive(false);
    fetch(`/api/games/${id}/events`)
      .then((r) => r.text())
      .then((text) => {
        const items: FeedItem[] = [];
        let i = 0;
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            const ev = JSON.parse(line) as { kind: string; payload: unknown; private?: unknown };
            const item = toFeedItem(ev.kind, ev.payload, i++);
            if (item) items.push(item);
          } catch {
            /* skip */
          }
        }
        setFeed(items);
      })
      .catch(() => {});
  }, [id, game]);

  // 进行中对局：WS 实时
  const onEvent = useCallback((ev: BusEvent) => {
    if (ev.kind === "snapshot") {
      setSnap(ev.payload as Snapshot);
      return;
    }
    const item = toFeedItem(ev.kind, ev.payload, `${ev.kind}-${ev.seq ?? feed.length}`);
    if (item) setFeed((f) => [...f.slice(-200), item]);
  }, [feed.length]);
  useTopic(live && game?.status !== "done" && id ? `game/${id}` : null, onEvent);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  const phaseClass = !snap
    ? "over"
    : snap.winner
      ? "over"
      : snap.phase.includes("夜")
        ? "night"
        : "day";

  return (
    <div className="page">
      <div className={`phase-bar ${phaseClass}`}>
        {snap?.winner
          ? `🏆 ${snap.winner.faction === "werewolf" ? "狼人阵营" : "好人阵营"}获胜：${snap.winner.reason}`
          : (snap?.phase ?? (game?.status === "done" ? "对局结束" : "等待开始…"))}
        {snap && !snap.winner && <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>存活 {snap.alive.length}</span>}
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>座位</h2>
          <div className="seats">
            {(snap?.seats ?? []).map((s) => {
              const rv = revealed?.find((r) => r.seat === s.seat);
              return (
                <div key={s.seat} className={`seat ${s.alive ? "" : "dead"}`}>
                  <div className="no">{s.seat} 号</div>
                  <div className="nm">{s.name}</div>
                  <div className="rl">
                    {rv ? (
                      <span className={`tag ${rv.faction}`}>{roleName(rv.role)}</span>
                    ) : s.alive ? (
                      <span className="muted">存活</span>
                    ) : (
                      <span className="tag fail">{causeName(s.death?.cause)}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {!snap && <span className="muted">等待对局数据…</span>}
          </div>
        </div>

        <div className="panel">
          <h2>现场</h2>
          <div className="feed">
            {feed.map((f) => (
              <div key={f.id} className={`msg ${f.type === "pk" ? "pk" : f.type === "last_words" ? "lastwords" : ""}`}>
                {f.type === "speech" || f.type === "pk" || f.type === "last_words" ? (
                  <>
                    <div className="who">
                      {f.seat} 号 · {f.type === "pk" ? "PK 辩词" : f.type === "last_words" ? "遗言" : "发言"}
                    </div>
                    <div>{f.text}</div>
                  </>
                ) : (
                  renderNotice(f)
                )}
              </div>
            ))}
            {feed.length === 0 && <span className="muted">（暂无事件）</span>}
            <div ref={feedEnd} />
          </div>
        </div>
      </div>
    </div>
  );
}

function toFeedItem(kind: string, payload: unknown, key: string | number): FeedItem | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "speech":
      return { id: String(key), type: p.kind === "pk" ? "pk" : "speech", seat: p.seat as number, text: p.text as string };
    case "last_words":
      return { id: String(key), type: "last_words", seat: p.seat as number, text: p.text as string };
    case "night_begun":
      return { id: String(key), type: "notice", text: `🌙 第 ${p.night} 夜开始` };
    case "dawn_deaths": {
      const d = (p.deaths as number[]) ?? [];
      return { id: String(key), type: "notice", text: d.length ? `☀️ 天亮，昨夜 ${d.join("、")} 号倒下` : "☀️ 天亮，平安夜" };
    }
    case "speech_order":
      return { id: String(key), type: "notice", text: `🗣️ 发言顺序：${(p.order as number[])?.join(" → ")}` };
    case "vote_result":
      return { id: String(key), type: "vote", extra: p };
    case "hunter_shot":
      return {
        id: String(key),
        type: "notice",
        text: p.target ? `🔫 ${p.by} 号翻牌猎人，带走 ${p.target} 号` : `🔫 ${p.by} 号翻牌猎人，未开枪`,
      };
    case "timeout_default":
      return { id: String(key), type: "notice", text: `⏱ ${p.seat} 号超时（${p.which}），平台代答` };
    case "player_disqualified":
      return { id: String(key), type: "notice", text: `⚠️ ${p.seat} 号因违规被取消资格` };
    case "win":
      return { id: String(key), type: "notice", text: `🏆 ${p.faction === "werewolf" ? "狼人阵营" : "好人阵营"}获胜（${p.reason}）` };
    case "game_summary":
      return { id: String(key), type: "notice", text: `📊 对局结束${p.mvp ? `，MVP：${p.mvp} 号` : ""}` };
    default:
      return null;
  }
}

function renderNotice(f: FeedItem) {
  if (f.type === "vote") {
    const p = f.extra as { tally?: Array<{ voter: number; target: number | null }>; eliminated?: number | null; pk_candidates?: number[]; round?: number };
    return (
      <>
        <div className="who">🗳️ 投票{p.round === 2 ? "（PK 再投票）" : ""}</div>
        <div className="tally">
          {p.tally?.map((b, i) => (
            <span key={i} className="vote">
              {b.voter}→{b.target ?? "弃"}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 4 }}>
          {p.pk_candidates?.length
            ? `平票：${p.pk_candidates.join("、")} 号进入 PK`
            : p.eliminated != null
              ? `${p.eliminated} 号被放逐`
              : "平安日，无人出局"}
        </div>
      </>
    );
  }
  return <div>{f.text}</div>;
}

function roleName(r: string) {
  return { werewolf: "狼人", seer: "预言家", witch: "女巫", hunter: "猎人", villager: "村民" }[r] ?? r;
}
function causeName(c?: string) {
  return { wolf: "夜晚遇害", poison: "中毒", vote: "被放逐", hunter: "被枪杀", disqualify: "违规" }[c ?? ""] ?? "出局";
}
