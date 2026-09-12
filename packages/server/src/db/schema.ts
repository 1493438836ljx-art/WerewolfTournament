// Drizzle schema —— 平台全部持久化表。
// 对局事件权威存储在 game_events（append-only）；JSONL 下载由此表流式导出。
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  doublePrecision,
  serial,
} from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  dir: text("dir").notNull(),
  manifestJson: jsonb("manifest_json").notNull(),
  selfcheckStatus: text("selfcheck_status").notNull().default("pending"), // pending|ok|fail
  selfcheckDetail: jsonb("selfcheck_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tournaments = pgTable("tournaments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft|running|done|aborted
  configJson: jsonb("config_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const games = pgTable("games", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id").references(() => tournaments.id),
  seq: integer("seq").notNull(),
  status: text("status").notNull().default("pending"), // pending|running|done|aborted
  seed: text("seed").notNull(),
  configJson: jsonb("config_json").notNull(),
  winnerFaction: text("winner_faction"), // werewolf|village
  winReason: text("win_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const gameSeats = pgTable(
  "game_seats",
  {
    gameId: text("game_id").notNull().references(() => games.id),
    seat: integer("seat").notNull(),
    agentId: text("agent_id").notNull(),
    role: text("role").notNull(),
    alive: boolean("alive").notNull().default(true),
    deathCause: text("death_cause"), // wolf|poison|vote|hunter|disqualify
    deathTurn: integer("death_turn"),
    teamWon: boolean("team_won"),
    penalties: doublePrecision("penalties").notNull().default(0),
    mvp: boolean("mvp").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seat] })],
);

// append-only 事件流：payloadPublic 为观众可见内容，payloadPrivate 按座位存私有信息副本（泄漏审计用）
export const gameEvents = pgTable(
  "game_events",
  {
    gameId: text("game_id").notNull().references(() => games.id),
    seq: integer("seq").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    actorSeat: integer("actor_seat"),
    payloadPublic: jsonb("payload_public"),
    payloadPrivateJson: jsonb("payload_private_json"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seq] })],
);

export const votes = pgTable(
  "votes",
  {
    gameId: text("game_id").notNull().references(() => games.id),
    day: integer("day").notNull(),
    round: integer("round").notNull(),
    /** sheriff=警长竞选票 | exile=放逐票 */
    kind: text("kind").notNull().default("exile"),
    voterSeat: integer("voter_seat").notNull(),
    targetSeat: integer("target_seat"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.day, t.round, t.kind, t.voterSeat] })],
);

export const scores = pgTable("scores", {
  id: serial("id").primaryKey(),
  tournamentId: text("tournament_id").notNull().references(() => tournaments.id),
  agentId: text("agent_id").notNull(),
  gameId: text("game_id").notNull().references(() => games.id),
  seat: integer("seat").notNull(),
  points: doublePrecision("points").notNull().default(0),
  mvp: boolean("mvp").notNull().default(false),
  penalties: doublePrecision("penalties").notNull().default(0),
  breakdownJson: jsonb("breakdown_json"),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  gameId: text("game_id"),
  agentId: text("agent_id"),
  purpose: text("purpose").notNull(), // announce|arbitrate|mvp|agent_proxy
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inTokens: integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  ok: boolean("ok").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
