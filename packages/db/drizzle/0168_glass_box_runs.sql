ALTER TABLE "agent_run" ADD COLUMN "continued_from_run_id" integer;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_continued_from_run_id_agent_run_id_fk" FOREIGN KEY ("continued_from_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "agent_memory_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"file" text NOT NULL,
	"content" text NOT NULL,
	"sha256" text NOT NULL,
	"source" text NOT NULL,
	"proposal_id" integer,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memory_revision_file_check" CHECK ("agent_memory_revision"."file" IN ('MEMORY.md', 'USER.md')),
	CONSTRAINT "agent_memory_revision_source_check" CHECK ("agent_memory_revision"."source" IN ('agent', 'owner', 'observed'))
);
--> statement-breakpoint
CREATE TABLE "agent_proposal" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposal_kind_check" CHECK ("agent_proposal"."kind" IN ('memory-write', 'hermes-update')),
	CONSTRAINT "agent_proposal_status_check" CHECK ("agent_proposal"."status" IN ('pending', 'approved', 'rejected', 'applied', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "agent_run_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"claim" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"requested_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	CONSTRAINT "agent_runtime_request_status_check" CHECK ("agent_runtime_request"."status" IN ('pending', 'claimed', 'answered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_memory_revision" ADD CONSTRAINT "agent_memory_revision_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_revision" ADD CONSTRAINT "agent_memory_revision_proposal_id_agent_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."agent_proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_revision" ADD CONSTRAINT "agent_memory_revision_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal" ADD CONSTRAINT "agent_proposal_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposal" ADD CONSTRAINT "agent_proposal_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_event" ADD CONSTRAINT "agent_run_event_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_request" ADD CONSTRAINT "agent_runtime_request_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_request" ADD CONSTRAINT "agent_runtime_request_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memory_revision_agent_idx" ON "agent_memory_revision" USING btree ("agent_id","file","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposal_external_uq" ON "agent_proposal" USING btree (coalesce("agent_id", 0),"kind","external_id");--> statement-breakpoint
CREATE INDEX "agent_proposal_status_idx" ON "agent_proposal" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "agent_run_event_run_idx" ON "agent_run_event" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "agent_runtime_request_agent_idx" ON "agent_runtime_request" USING btree ("agent_id","status","id");--> statement-breakpoint
CREATE INDEX "agent_runtime_request_created_idx" ON "agent_runtime_request" USING btree ("created_at");