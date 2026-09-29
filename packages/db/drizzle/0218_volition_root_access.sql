CREATE TABLE "volition_root_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"run_id" integer,
	"message_id" integer,
	"approval_id" integer,
	"command" text NOT NULL,
	"reason" text NOT NULL,
	"origin" text NOT NULL,
	"runtime" text NOT NULL,
	"taint_sources" jsonb NOT NULL,
	"persistence" jsonb NOT NULL,
	"epoch" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"unit" text,
	"exit_code" integer,
	"output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "root_origin" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "observed_runtime" text;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "taint_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "root_origin" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "observed_runtime" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "taint_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "volition_root_execution" ADD CONSTRAINT "volition_root_execution_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_root_execution" ADD CONSTRAINT "volition_root_execution_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_root_execution" ADD CONSTRAINT "volition_root_execution_message_id_agent_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_root_execution" ADD CONSTRAINT "volition_root_execution_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "ai_agent" SET "runtime_policy" = "runtime_policy" || '{"runtime":"hermes","toolDeny":[],"skillsDisabled":[]}'::jsonb WHERE "id" = 1 AND "agent_role" = 'home';
