CREATE TABLE "pipeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_run" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"issue_id" integer,
	"trigger" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor_user_id" text,
	"error" text,
	"start_attempts" integer DEFAULT 0 NOT NULL,
	"next_start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pipeline_run_trigger_check" CHECK ("pipeline_run"."trigger" IN ('manual', 'task_created', 'task_assigned', 'status_changed', 'label_added', 'schedule')),
	CONSTRAINT "pipeline_run_status_check" CHECK ("pipeline_run"."status" IN ('pending', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_step" (
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"iteration" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"summary" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"agent_id" integer,
	"decided_by" text,
	"note" text,
	"wake_at" timestamp with time zone,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pipeline_run_step_run_id_step_id_iteration_pk" PRIMARY KEY("run_id","step_id","iteration"),
	CONSTRAINT "pipeline_run_step_kind_check" CHECK ("pipeline_run_step"."kind" IN ('agent', 'approval', 'condition', 'action', 'wait')),
	CONSTRAINT "pipeline_run_step_status_check" CHECK ("pipeline_run_step"."status" IN ('running', 'waiting', 'succeeded', 'failed', 'canceled', 'simulated'))
);
--> statement-breakpoint
CREATE TABLE "pipeline_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_version_uq" UNIQUE("pipeline_id","version")
);
--> statement-breakpoint
CREATE TABLE "project_pipeline" (
	"project_id" integer NOT NULL,
	"pipeline_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"roles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_id" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_pipeline_project_id_pipeline_id_pk" PRIMARY KEY("project_id","pipeline_id")
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_version_id_pipeline_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pipeline_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_run_id_pipeline_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_step" ADD CONSTRAINT "pipeline_run_step_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_version" ADD CONSTRAINT "pipeline_version_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_version" ADD CONSTRAINT "pipeline_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pipeline" ADD CONSTRAINT "project_pipeline_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pipeline" ADD CONSTRAINT "project_pipeline_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pipeline" ADD CONSTRAINT "project_pipeline_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_team_project_idx" ON "pipeline" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_run_active_uq" ON "pipeline_run" USING btree ("pipeline_id","issue_id") WHERE "pipeline_run"."status" IN ('pending', 'running', 'waiting') AND NOT "pipeline_run"."dry_run";--> statement-breakpoint
CREATE INDEX "pipeline_run_project_idx" ON "pipeline_run" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_run_pipeline_idx" ON "pipeline_run" USING btree ("pipeline_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_run_issue_idx" ON "pipeline_run" USING btree ("issue_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pipeline_run_start_idx" ON "pipeline_run" USING btree ("status","next_start_at");--> statement-breakpoint
CREATE INDEX "pipeline_run_step_waiting_idx" ON "pipeline_run_step" USING btree ("kind","status");