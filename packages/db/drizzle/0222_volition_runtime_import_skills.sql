CREATE TABLE "helena_agent_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"kind" text NOT NULL,
	"run_id" integer,
	"chat_thread_id" text,
	"model" text,
	"summary" text,
	"compacted_through" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_agent_session_kind_check" CHECK ("helena_agent_session"."kind" IN ('run', 'chat', 'reflection'))
);
--> statement-breakpoint
CREATE TABLE "helena_agent_session_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"step" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_agent_session_item_seq_unique" UNIQUE("session_id","seq"),
	CONSTRAINT "helena_agent_session_item_role_check" CHECK ("helena_agent_session_item"."role" IN ('system', 'user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE TABLE "helena_fact" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"content" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"trust" real DEFAULT 0.5 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"unhelpful_count" integer DEFAULT 0 NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"retrieval_count" integer DEFAULT 0 NOT NULL,
	"contradicted_by" integer,
	"hrr" "bytea",
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "helena_fact_trust_check" CHECK ("helena_fact"."trust" >= 0 AND "helena_fact"."trust" <= 1)
);
--> statement-breakpoint
CREATE TABLE "helena_fact_entity" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"name_lower" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_fact_entity_link" (
	"fact_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	CONSTRAINT "helena_fact_entity_link_fact_id_entity_id_pk" PRIMARY KEY("fact_id","entity_id")
);
--> statement-breakpoint
ALTER TABLE "agent_memory_revision" DROP CONSTRAINT "agent_memory_revision_file_check";--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD CONSTRAINT "helena_agent_session_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD CONSTRAINT "helena_agent_session_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD CONSTRAINT "helena_agent_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD CONSTRAINT "helena_agent_session_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_agent_session_item" ADD CONSTRAINT "helena_agent_session_item_session_id_helena_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."helena_agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact" ADD CONSTRAINT "helena_fact_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact" ADD CONSTRAINT "helena_fact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact" ADD CONSTRAINT "helena_fact_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact" ADD CONSTRAINT "helena_fact_contradicted_by_helena_fact_id_fk" FOREIGN KEY ("contradicted_by") REFERENCES "public"."helena_fact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact_entity" ADD CONSTRAINT "helena_fact_entity_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact_entity" ADD CONSTRAINT "helena_fact_entity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact_entity_link" ADD CONSTRAINT "helena_fact_entity_link_fact_id_helena_fact_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."helena_fact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_fact_entity_link" ADD CONSTRAINT "helena_fact_entity_link_entity_id_helena_fact_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."helena_fact_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_agent_session_agent_idx" ON "helena_agent_session" USING btree ("agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "helena_agent_session_run_idx" ON "helena_agent_session" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "helena_fact_scope_idx" ON "helena_fact" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE INDEX "helena_fact_agent_idx" ON "helena_fact" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "helena_fact_updated_idx" ON "helena_fact" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_fact_entity_name_unique" ON "helena_fact_entity" USING btree ("team_id",coalesce("project_id", 0),"name_lower");--> statement-breakpoint
CREATE INDEX "helena_fact_entity_link_entity_idx" ON "helena_fact_entity_link" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "agent_memory_revision" ADD CONSTRAINT "agent_memory_revision_file_check" CHECK ("agent_memory_revision"."file" IN ('MEMORY.md', 'USER.md') OR "agent_memory_revision"."file" ~ '^notes/[0-9]{4}-[0-9]{2}-[0-9]{2}[.]md$');--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'subtask', 'field', 'schedule', 'manual', 'approval', 'workspace', 'digest', 'heartbeat', 'escalation'));
--> statement-breakpoint
CREATE TABLE "volition_profile_import" (
	"agent_id" integer NOT NULL,
	"source_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"sessions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volition_profile_import_agent_id_source_key_pk" PRIMARY KEY("agent_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD COLUMN "imported_from" jsonb;--> statement-breakpoint
ALTER TABLE "volition_profile_import" ADD CONSTRAINT "volition_profile_import_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "volition_learned_skills" jsonb DEFAULT '[]'::jsonb NOT NULL;
