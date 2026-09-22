ALTER TABLE "organization_agent_assignment" RENAME COLUMN "openclaw_agent_id" TO "runtime_agent_id";--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "runtime_policy" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "runtime_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_goal" ADD COLUMN "parent_goal_id" integer;--> statement-breakpoint
ALTER TABLE "organization_goal" ADD CONSTRAINT "organization_goal_parent_goal_id_organization_goal_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."organization_goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_goal_parent_idx" ON "organization_goal" USING btree ("team_id","parent_goal_id");--> statement-breakpoint
ALTER TABLE "organization_goal" ADD CONSTRAINT "organization_goal_not_self_parent_check" CHECK ("organization_goal"."parent_goal_id" IS NULL OR "organization_goal"."parent_goal_id" <> "organization_goal"."id");