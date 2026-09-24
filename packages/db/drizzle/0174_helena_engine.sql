CREATE TABLE "helena_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"kind" text NOT NULL,
	"pipeline_id" integer,
	"title" text DEFAULT '' NOT NULL,
	"agent_id" integer,
	"instructions" text DEFAULT '' NOT NULL,
	"mode" text,
	"task_id" integer,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"catch_up" text DEFAULT 'skip' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fired_through" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"schedule_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_schedule_key_uq" UNIQUE("project_id","schedule_key"),
	CONSTRAINT "helena_schedule_kind_check" CHECK ("helena_schedule"."kind" IN ('routine', 'workflow')),
	CONSTRAINT "helena_schedule_mode_check" CHECK ("helena_schedule"."mode" IS NULL OR "helena_schedule"."mode" IN ('new', 'reopen')),
	CONSTRAINT "helena_schedule_catch_up_check" CHECK ("helena_schedule"."catch_up" IN ('skip', 'once')),
	CONSTRAINT "helena_schedule_target_check" CHECK (("helena_schedule"."kind" = 'workflow') = ("helena_schedule"."pipeline_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "helena_workflow_hook" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"pipeline_id" integer NOT NULL,
	"secret" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "helena_workflow_hook_uq" UNIQUE("project_id","pipeline_id")
);
--> statement-breakpoint
ALTER TABLE "agent_team_start" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_team_start" CASCADE;--> statement-breakpoint
ALTER TABLE "ai_agent" DROP CONSTRAINT "ai_agent_kind_check";--> statement-breakpoint
ALTER TABLE "pipeline_run" DROP CONSTRAINT "pipeline_run_trigger_check";--> statement-breakpoint
ALTER TABLE "pipeline_run" DROP CONSTRAINT "pipeline_run_status_check";--> statement-breakpoint
ALTER TABLE "pipeline_run_step" DROP CONSTRAINT "pipeline_run_step_kind_check";--> statement-breakpoint
ALTER TABLE "pipeline_run_step" DROP CONSTRAINT "pipeline_run_step_status_check";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP CONSTRAINT "ai_agent_model_credential_id_integration_credential_id_fk";
--> statement-breakpoint
DROP INDEX "pipeline_run_start_idx";--> statement-breakpoint
ALTER TABLE "pipeline_run" ALTER COLUMN "pipeline_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_run" ALTER COLUMN "version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "kind" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "agent_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD COLUMN "agent_run_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD COLUMN "state" jsonb;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_task_id_issue_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_workflow_hook" ADD CONSTRAINT "helena_workflow_hook_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_workflow_hook" ADD CONSTRAINT "helena_workflow_hook_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_workflow_hook" ADD CONSTRAINT "helena_workflow_hook_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_schedule_pipeline_uq" ON "helena_schedule" USING btree ("project_id","pipeline_id") WHERE "helena_schedule"."pipeline_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "helena_schedule_project_idx" ON "helena_schedule" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_schedule_id_helena_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."helena_schedule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_team_active_uq" ON "pipeline_run" USING btree ("issue_id","agent_id") WHERE "pipeline_run"."kind" = 'agent_team' AND "pipeline_run"."status" IN ('pending', 'running', 'waiting') AND NOT "pipeline_run"."dry_run";--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_fire_uq" ON "pipeline_run" USING btree ("schedule_id","scheduled_for") WHERE "pipeline_run"."schedule_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pipeline_run_schedule_idx" ON "pipeline_run" USING btree ("schedule_id","scheduled_for" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_run_status_idx" ON "pipeline_run" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "pipeline_run_step_agent_run_idx" ON "pipeline_run_step" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "pipeline_run_step_wait_key_idx" ON "pipeline_run_step" USING btree (("state"->'wait'->>'key')) WHERE "pipeline_run_step"."status" = 'waiting' AND ("pipeline_run_step"."state"->'wait') IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "model_credential_id";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "tools";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "temperature";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "max_steps";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "api_key_ciphertext";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "api_key_iv";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "api_key_auth_tag";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "memory_enabled";--> statement-breakpoint
ALTER TABLE "ai_agent" DROP COLUMN "memory_last_messages";--> statement-breakpoint
ALTER TABLE "pipeline_run" DROP COLUMN "start_attempts";--> statement-breakpoint
ALTER TABLE "pipeline_run" DROP COLUMN "next_start_at";--> statement-breakpoint
ALTER TABLE "project_pipeline" DROP COLUMN "schedule_id";--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_kind_check" CHECK ("ai_agent"."kind" = 'external');--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_kind_check" CHECK ("pipeline_run"."kind" IN ('workflow', 'agent_team', 'routine'));--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_source_check" CHECK (("pipeline_run"."kind" = 'workflow') = ("pipeline_run"."pipeline_id" IS NOT NULL AND "pipeline_run"."version_id" IS NOT NULL)
        AND ("pipeline_run"."kind" = 'workflow' OR "pipeline_run"."definition" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_trigger_check" CHECK ("pipeline_run"."trigger" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_status_check" CHECK ("pipeline_run"."status" IN ('pending', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'rejected', 'skipped'));--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_kind_check" CHECK ("pipeline_run_step"."kind" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$');--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_status_check" CHECK ("pipeline_run_step"."status" IN ('running', 'waiting', 'succeeded', 'failed', 'canceled', 'simulated', 'skipped'));--> statement-breakpoint
-- The mappings the Mastra bridge kept in project settings: the engine records the agent run of a step on the step itself.
DELETE FROM "project_setting" WHERE "key" LIKE 'mastra-%';--> statement-breakpoint
-- The tables of the in-process Mastra agent runtime (created at runtime by @mastra/pg, all empty on live).
DROP TABLE IF EXISTS "mastra_agent_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_agents" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_ai_spans" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_background_tasks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_channel_config" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_channel_installations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_dataset_items" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_dataset_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_datasets" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_experiment_results" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_experiments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_favorites" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_client_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_clients" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_server_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_mcp_servers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_messages" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_notifications" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_observational_memory" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_prompt_block_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_prompt_blocks" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_resources" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_schedule_triggers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_schedules" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorer_definition_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorer_definitions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_scorers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skill_blobs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skill_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_skills" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_thread_state" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_threads" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_tool_provider_connections" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workflow_definitions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workflow_snapshot" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workspace_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "mastra_workspaces" CASCADE;
