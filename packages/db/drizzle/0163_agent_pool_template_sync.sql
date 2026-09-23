CREATE TABLE "agent_template_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"groups" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "source_template_id" integer;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "template_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "template_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_template_sync_log" ADD CONSTRAINT "agent_template_sync_log_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_template_sync_log" ADD CONSTRAINT "agent_template_sync_log_template_id_ai_agent_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_template_sync_log" ADD CONSTRAINT "agent_template_sync_log_copy_id_ai_agent_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_template_sync_log_team_idx" ON "agent_template_sync_log" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_template_sync_log_template_idx" ON "agent_template_sync_log" USING btree ("template_id","synced_at");--> statement-breakpoint
CREATE INDEX "agent_template_sync_log_copy_idx" ON "agent_template_sync_log" USING btree ("copy_id","synced_at");--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_source_template_id_ai_agent_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_source_template_idx" ON "ai_agent" USING btree ("source_template_id");--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_template_no_source_check" CHECK (NOT ("ai_agent"."template" AND "ai_agent"."source_template_id" IS NOT NULL));