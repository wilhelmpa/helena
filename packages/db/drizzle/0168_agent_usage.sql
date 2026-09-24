CREATE TABLE "agent_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"project_id" integer,
	"run_id" integer,
	"chat_message_id" integer,
	"kind" text NOT NULL,
	"runtime" text,
	"model" text,
	"provider" text,
	"session_id" text,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_usage_kind_check" CHECK ("agent_usage"."kind" IN ('run', 'chat', 'reflection'))
);
--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_usage_agent_time_idx" ON "agent_usage" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_project_time_idx" ON "agent_usage" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_time_idx" ON "agent_usage" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_run_idx" ON "agent_usage" USING btree ("run_id");