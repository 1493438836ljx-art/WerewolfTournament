CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dir" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"selfcheck_status" text DEFAULT 'pending' NOT NULL,
	"selfcheck_detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"game_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor_seat" integer,
	"payload_public" jsonb,
	"payload_private_json" jsonb,
	CONSTRAINT "game_events_game_id_seq_pk" PRIMARY KEY("game_id","seq")
);
--> statement-breakpoint
CREATE TABLE "game_seats" (
	"game_id" text NOT NULL,
	"seat" integer NOT NULL,
	"agent_id" text NOT NULL,
	"role" text NOT NULL,
	"alive" boolean DEFAULT true NOT NULL,
	"death_cause" text,
	"death_turn" integer,
	"team_won" boolean,
	"penalties" double precision DEFAULT 0 NOT NULL,
	"mvp" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_seats_game_id_seat_pk" PRIMARY KEY("game_id","seat")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text,
	"seq" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seed" text NOT NULL,
	"config_json" jsonb NOT NULL,
	"winner_faction" text,
	"win_reason" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" text,
	"agent_id" text,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"game_id" text NOT NULL,
	"seat" integer NOT NULL,
	"points" double precision DEFAULT 0 NOT NULL,
	"mvp" boolean DEFAULT false NOT NULL,
	"penalties" double precision DEFAULT 0 NOT NULL,
	"breakdown_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"game_id" text NOT NULL,
	"day" integer NOT NULL,
	"round" integer NOT NULL,
	"voter_seat" integer NOT NULL,
	"target_seat" integer,
	CONSTRAINT "votes_game_id_day_round_voter_seat_pk" PRIMARY KEY("game_id","day","round","voter_seat")
);
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_seats" ADD CONSTRAINT "game_seats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;