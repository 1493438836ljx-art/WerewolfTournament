// 信息隔离唯一收口：所有发给某座位的私有事件必须经 agentEventsFor()。
// 属性测试保证：座位 i 收不到座位 j 的角色/查验/用药等私有信息。
import type { AgentEvent, Seat } from "@wt/protocol";
import type { EngineEvent, GameState } from "./types.js";
import { aliveSeats } from "./types.js";

/** 某座位可见的引擎事件 */
export function visibleEventsFor(state: GameState, seat: Seat): EngineEvent[] {
  return state.log.filter(
    (ev) => ev.visibility === "public" || (typeof ev.visibility === "object" && ev.visibility.seats.includes(seat)),
  );
}

type TimeoutWhich = Extract<AgentEvent, { kind: "your_timeout" }>["which"];
const TIMEOUT_WHICH: Record<string, TimeoutWhich> = {
  wolf_kill: "night_action",
  seer_check: "night_action",
  witch_action: "night_action",
  hunter_shoot: "hunter",
  speech: "speech",
  vote: "vote",
  last_words: "last_words",
};

/** 引擎事件 -> 协议 AgentEvent 翻译（跳过无对应协议形状的事件） */
export function toAgentEvents(events: EngineEvent[], viewerSeat: Seat): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const ev of events) {
    const p = ev.payload as Record<string, unknown>;
    switch (ev.kind) {
      case "night_begun":
        out.push({ kind: "night_begun", night: p.night as number });
        break;
      case "dawn_deaths":
        out.push({ kind: "dawn_deaths", night: p.night as number, deaths: p.deaths as Seat[] });
        break;
      case "speech":
        out.push({
          kind: "speech_heard",
          day: p.day as number,
          seat: p.seat as Seat,
          speech_kind: p.kind as "speech" | "pk",
          text: p.text as string,
        });
        break;
      case "last_words":
        out.push({
          kind: "speech_heard",
          day: (p.day as number | undefined) ?? (p.night as number),
          seat: p.seat as Seat,
          speech_kind: "last_words",
          text: p.text as string,
        });
        break;
      case "vote_result": {
        const e: AgentEvent = {
          kind: "vote_result",
          day: p.day as number,
          round: p.round as number,
          tally: p.tally as Array<{ voter: Seat; target: Seat | null }>,
          eliminated: p.eliminated as Seat | null,
        };
        const pk = p.pk_candidates as Seat[] | undefined;
        if (pk && pk.length > 0) e.pk_candidates = pk;
        out.push(e);
        break;
      }
      case "hunter_shot":
        out.push({ kind: "hunter_shot", by: p.by as Seat, target: p.target as Seat | null });
        break;
      case "wolf_target_locked":
        out.push({ kind: "wolf_kill_locked", night: p.night as number, target: p.target as Seat | null });
        break;
      case "seer_result":
        if (p.seat === viewerSeat) {
          out.push({
            kind: "seer_result",
            night: p.night as number,
            target: p.target as Seat,
            result: p.result as "wolf" | "human",
          });
        }
        break;
      case "player_disqualified":
        out.push({ kind: "player_disqualified", seat: p.seat as Seat, reason: p.reason as string });
        break;
      case "timeout_default":
        if (p.seat === viewerSeat) {
          out.push({ kind: "your_timeout", which: TIMEOUT_WHICH[p.which as string] ?? "speech" });
        }
        break;
      // game_started/speech_order/witch_*/win/reveal 不作为 AgentEvent：
      // 分别由 game_start 消息、speech_request.order、女巫请求、game_end 消息承载
      default:
        break;
    }
  }
  return out;
}

/** 发给某座位的全部协议事件（唯一出口） */
export function agentEventsFor(state: GameState, seat: Seat): AgentEvent[] {
  return toAgentEvents(visibleEventsFor(state, seat), seat);
}

/** 发给某座位的 seq 之后的新事件（编排器增量 notify 用）；返回 [事件列表, 最新seq] */
export function agentEventsSince(
  state: GameState,
  seat: Seat,
  lastSeq: number,
): { events: AgentEvent[]; lastSeq: number } {
  const visible = visibleEventsFor(state, seat).filter((e) => e.seq > lastSeq);
  return {
    events: toAgentEvents(visible, seat),
    lastSeq: visible.length ? visible[visible.length - 1]!.seq : lastSeq,
  };
}

// ---------- 观众 / 裁判视图 ----------
export interface SpectatorSnapshot {
  gameId: string;
  night: number;
  day: number;
  phase: string;
  alive: Seat[];
  seats: Array<{ seat: Seat; name: string; alive: boolean; death?: { cause: string; turn: number } }>;
  penalties: Record<number, number>;
  winner?: { faction: string; reason: string };
}

export function spectatorView(s: GameState): SpectatorSnapshot {
  return {
    gameId: s.gameId,
    night: s.night,
    day: s.day,
    phase: phaseText(s),
    alive: aliveSeats(s),
    seats: s.seats.map((x) => ({ seat: x.seat, name: x.name, alive: x.alive, death: x.death })),
    penalties: { ...s.penalties },
    winner: s.winner,
  };
}

/** LLM 裁判全知视图 */
export interface RefereeSnapshot extends SpectatorSnapshot {
  roles: Array<{ seat: Seat; role: string; faction: string }>;
  seerChecks: Array<{ night: number; target: Seat; result: string }>;
  witchPotions: { heal: boolean; poison: boolean };
  currentKill: Seat | null;
  votes: Array<{ day: number; round: number; ballots: Array<{ voter: Seat; target: Seat | null }>; eliminated: Seat | null }>;
  pending: Array<{ kind: string; seat: Seat }>;
  recentEvents: Array<{ seq: number; kind: string; payload: unknown }>;
}

export function refereeView(s: GameState, recentEventCount = 30): RefereeSnapshot {
  return {
    ...spectatorView(s),
    roles: s.seats.map((x) => ({ seat: x.seat, role: x.role, faction: x.faction })),
    seerChecks: s.seerChecks,
    witchPotions: s.witchPotions,
    currentKill: s.currentKill,
    votes: s.votes.map((v) => ({ day: v.day, round: v.round, ballots: v.ballots, eliminated: v.eliminated })),
    pending: s.pending.map((p) => ({ kind: p.kind, seat: p.seat })),
    recentEvents: s.log.slice(-recentEventCount).map((e) => ({ seq: e.seq, kind: e.kind, payload: e.payload })),
  };
}

function phaseText(s: GameState): string {
  const p = s.phase;
  switch (p.t) {
    case "night":
      return `第 ${p.no} 夜`;
    case "dawn":
      return `第 ${p.no} 夜结算`;
    case "day":
      return `第 ${p.no} 天（${p.step}）`;
    case "game_over":
      return "对局结束";
  }
}
