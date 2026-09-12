ALTER TABLE "votes" ADD COLUMN "kind" text DEFAULT 'exile' NOT NULL;--> statement-breakpoint
ALTER TABLE "votes" DROP CONSTRAINT "votes_game_id_day_round_voter_seat_pk";--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_game_id_day_round_kind_voter_seat_pk" PRIMARY KEY("game_id","day","round","kind","voter_seat");
