-- agent_usage belongs to hub/hermes-in-helena (86873c87); it is created here only while that
-- branch is not on the hub yet, and drops out of this migration when it is regenerated there.
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
CREATE TABLE "helena_budget" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"agent_id" integer,
	"project_id" integer,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"limit_value" numeric(18, 4) NOT NULL,
	"warned_for" timestamp with time zone,
	"reached_for" timestamp with time zone,
	"grace_for" timestamp with time zone,
	"grace_runs" integer DEFAULT 0 NOT NULL,
	"grace_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_budget_target_check" CHECK (("helena_budget"."agent_id" IS NULL) <> ("helena_budget"."project_id" IS NULL)),
	CONSTRAINT "helena_budget_metric_check" CHECK ("helena_budget"."metric" IN ('tokens', 'cost', 'time')),
	CONSTRAINT "helena_budget_period_check" CHECK ("helena_budget"."period" IN ('day', 'month')),
	CONSTRAINT "helena_budget_limit_check" CHECK ("helena_budget"."limit_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "helena_model_price" (
	"model" text PRIMARY KEY NOT NULL,
	"provider" text,
	"input_eur_per_m" numeric(14, 6) NOT NULL,
	"output_eur_per_m" numeric(14, 6) NOT NULL,
	"cache_read_eur_per_m" numeric(14, 6),
	"cache_write_eur_per_m" numeric(14, 6),
	"source" text NOT NULL,
	"source_usd" jsonb,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_model_price_source_check" CHECK ("helena_model_price"."source" IN ('models.dev', 'manual')),
	CONSTRAINT "helena_model_price_positive_check" CHECK ("helena_model_price"."input_eur_per_m" >= 0 AND "helena_model_price"."output_eur_per_m" >= 0
        AND coalesce("helena_model_price"."cache_read_eur_per_m", 0) >= 0 AND coalesce("helena_model_price"."cache_write_eur_per_m", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "helena_policy_decision" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"project_id" integer,
	"agent_id" integer,
	"run_id" integer,
	"chat_message_id" integer,
	"adapter" text NOT NULL,
	"tool" text,
	"category" text NOT NULL,
	"scope" text,
	"outcome" text NOT NULL,
	"level" smallint NOT NULL,
	"level_source" text NOT NULL,
	"reason" text NOT NULL,
	"policy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"approval_id" integer,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_policy_decision_outcome_check" CHECK ("helena_policy_decision"."outcome" IN ('allow', 'needs-approval', 'deny'))
);
--> statement-breakpoint
ALTER TABLE "approval_request" DROP CONSTRAINT "approval_request_kind_check";--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "autopilot_level" smallint;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "autopilot_level" smallint;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "autopilot_raise" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "autopilot_level" smallint;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "policy_reason" text;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "autopilot_level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_price" ADD CONSTRAINT "helena_model_price_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_policy_decision" ADD CONSTRAINT "helena_policy_decision_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_usage_agent_time_idx" ON "agent_usage" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_project_time_idx" ON "agent_usage" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_time_idx" ON "agent_usage" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "agent_usage_run_idx" ON "agent_usage" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_budget_agent_uq" ON "helena_budget" USING btree ("agent_id","metric","period") WHERE "helena_budget"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_budget_project_uq" ON "helena_budget" USING btree ("project_id","metric","period") WHERE "helena_budget"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "helena_policy_decision_project_idx" ON "helena_policy_decision" USING btree ("project_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "helena_policy_decision_agent_idx" ON "helena_policy_decision" USING btree ("agent_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "helena_policy_decision_run_idx" ON "helena_policy_decision" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "helena_policy_decision_created_idx" ON "helena_policy_decision" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_autopilot_level_check" CHECK ("ai_agent"."autopilot_level" IS NULL OR "ai_agent"."autopilot_level" BETWEEN 0 AND 3);--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_kind_check" CHECK ("approval_request"."kind" IN ('send', 'publish', 'pay', 'delete', 'write', 'execute', 'credentials', 'budget', 'other'));--> statement-breakpoint
-- Checked here and not in the schema, which would re-indent the whole project table.
ALTER TABLE "project" ADD CONSTRAINT "project_autopilot_level_check" CHECK ("project"."autopilot_level" BETWEEN 0 AND 3);--> statement-breakpoint
-- The token ceilings of agents and projects become their token budgets (Helena's Autopilot).
INSERT INTO "helena_budget" ("team_id", "agent_id", "metric", "period", "limit_value")
SELECT "team_id", "id", 'tokens', 'day', "daily_token_ceiling" FROM "ai_agent"
WHERE "daily_token_ceiling" IS NOT NULL AND "daily_token_ceiling" > 0;--> statement-breakpoint
INSERT INTO "helena_budget" ("team_id", "agent_id", "metric", "period", "limit_value")
SELECT "team_id", "id", 'tokens', 'month', "monthly_token_ceiling" FROM "ai_agent"
WHERE "monthly_token_ceiling" IS NOT NULL AND "monthly_token_ceiling" > 0;--> statement-breakpoint
INSERT INTO "helena_budget" ("team_id", "project_id", "metric", "period", "limit_value")
SELECT "team_id", "id", 'tokens', 'month', "monthly_token_ceiling" FROM "project"
WHERE "monthly_token_ceiling" IS NOT NULL AND "monthly_token_ceiling" > 0;
