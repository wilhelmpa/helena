CREATE TABLE "helena_system_job" (
	"id" text PRIMARY KEY NOT NULL,
	"fired_through" timestamp with time zone DEFAULT now() NOT NULL,
	"schedule_key" text DEFAULT '' NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_workflow_id" text,
	"last_trigger" text
);
--> statement-breakpoint
CREATE TABLE "helena_update" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"component" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"installed" text,
	"available" text,
	"update_available" boolean DEFAULT false NOT NULL,
	"security" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"notes_url" text,
	"group_key" text,
	"applicable" boolean DEFAULT false NOT NULL,
	"hint" jsonb,
	"detail" text,
	"error" text,
	"data" jsonb,
	"summary" text,
	"highlights" jsonb,
	"risk" text,
	"breaking" boolean,
	"summary_for" text,
	"summary_run_id" integer,
	"summary_model" text,
	"summary_error" text,
	"summarized_at" timestamp with time zone,
	"available_since" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_update_risk_check" CHECK ("helena_update"."risk" IS NULL OR "helena_update"."risk" IN ('low', 'medium', 'high')),
	CONSTRAINT "helena_update_kind_check" CHECK ("helena_update"."kind" IN ('runtime', 'system', 'tool', 'app'))
);
--> statement-breakpoint
CREATE TABLE "helena_update_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"component" text NOT NULL,
	"name" text NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_version" text,
	"to_version" text,
	"state" text DEFAULT 'running' NOT NULL,
	"ref" text,
	"backup_path" text,
	"log" text,
	"error" text,
	"result" jsonb,
	"health" jsonb,
	"requested_by_user_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "helena_update_action_state_check" CHECK ("helena_update_action"."state" IN ('running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "reasoning" text;--> statement-breakpoint
ALTER TABLE "helena_update" ADD CONSTRAINT "helena_update_summary_run_id_agent_run_id_fk" FOREIGN KEY ("summary_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_update_action" ADD CONSTRAINT "helena_update_action_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_update_component_uq" ON "helena_update" USING btree ("source","component");--> statement-breakpoint
CREATE INDEX "helena_update_action_requested_idx" ON "helena_update_action" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_update_action_running_uq" ON "helena_update_action" USING btree ("source","component") WHERE "helena_update_action"."state" = 'running';--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'field', 'schedule', 'manual', 'approval', 'workspace', 'digest'));