ALTER TABLE "ai_agent" ADD COLUMN "source_template_id" integer;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "template_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "template_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_source_template_id_ai_agent_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_source_template_idx" ON "ai_agent" USING btree ("source_template_id");--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_template_no_source_check" CHECK (NOT ("ai_agent"."template" AND "ai_agent"."source_template_id" IS NOT NULL));