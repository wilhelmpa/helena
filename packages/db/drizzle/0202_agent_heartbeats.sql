CREATE TABLE "agent_heartbeat_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"project_id" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"run_id" integer,
	CONSTRAINT "agent_heartbeat_event_outcome_check" CHECK ("agent_heartbeat_event"."outcome" IN ('queued', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_interval_minutes" integer;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_start" text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_end" text DEFAULT '17:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "heartbeat_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_heartbeat_event" ADD CONSTRAINT "agent_heartbeat_event_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_heartbeat_event" ADD CONSTRAINT "agent_heartbeat_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_heartbeat_event_agent_idx" ON "agent_heartbeat_event" USING btree ("agent_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'subtask', 'field', 'schedule', 'manual', 'approval', 'workspace', 'digest', 'heartbeat'));--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_heartbeat_interval_check" CHECK ("ai_agent"."heartbeat_interval_minutes" IS NULL OR "ai_agent"."heartbeat_interval_minutes" BETWEEN 5 AND 10080);