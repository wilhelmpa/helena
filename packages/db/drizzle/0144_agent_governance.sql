ALTER TABLE "agent_run" ADD COLUMN "blocked_question" text;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "daily_token_ceiling" bigint;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "monthly_token_ceiling" bigint;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "monthly_token_ceiling" bigint;--> statement-breakpoint
CREATE INDEX "agent_run_agent_finished_idx" ON "agent_run" USING btree ("agent_id","finished_at");