CREATE TABLE "helena_browser_task_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"source" text NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"backend" text NOT NULL,
	"credential_id" integer,
	"backend_label" text DEFAULT '' NOT NULL,
	"provider" text,
	"policy" text,
	"model_configured" text,
	"model_reported" text,
	"goal" text NOT NULL,
	"mode" text DEFAULT 'act' NOT NULL,
	"max_steps" integer DEFAULT 20 NOT NULL,
	"start_url" text,
	"value_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"decisions" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"decision_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"provider_cost_usd" double precision,
	"run_id" integer,
	"chat_message_id" integer,
	"chat_thread_id" text,
	"final_frame" text,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"created_by" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "helena_browser_task_run_source_check" CHECK ("helena_browser_task_run"."source" IN ('agent', 'lab')),
	CONSTRAINT "helena_browser_task_run_kind_check" CHECK ("helena_browser_task_run"."kind" IN ('task', 'check', 'choose')),
	CONSTRAINT "helena_browser_task_run_backend_check" CHECK ("helena_browser_task_run"."backend" IN ('decision', 'standard', 'jev-browser'))
);
--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_kind_check";--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_browser_task_run" ADD CONSTRAINT "helena_browser_task_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_browser_task_run_token_idx" ON "helena_browser_task_run" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "helena_browser_task_run_project_idx" ON "helena_browser_task_run" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "helena_browser_task_run_team_idx" ON "helena_browser_task_run" USING btree ("team_id","id");--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_kind_check" CHECK ("agent_usage"."kind" IN ('run', 'chat', 'reflection', 'tool'));