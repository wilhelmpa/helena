CREATE TABLE "agent_runtime_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runtime_action_kind_check" CHECK ("agent_runtime_action"."kind" IN ('discard-skill', 'pin-skill', 'write-memory'))
);
--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "runtime_learned_skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime_action" ADD CONSTRAINT "agent_runtime_action_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runtime_action_agent_idx" ON "agent_runtime_action" USING btree ("agent_id","id");