ALTER TABLE "helena_budget" DROP CONSTRAINT "helena_budget_target_check";--> statement-breakpoint
ALTER TABLE "helena_budget" DROP CONSTRAINT "helena_budget_period_check";--> statement-breakpoint
ALTER TABLE "helena_budget" ADD COLUMN "issue_id" integer;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD COLUMN "goal_id" integer;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_goal_id_organization_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."organization_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_budget_issue_uq" ON "helena_budget" USING btree ("issue_id","metric","period") WHERE "helena_budget"."issue_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_budget_goal_uq" ON "helena_budget" USING btree ("goal_id","metric","period") WHERE "helena_budget"."goal_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_target_check" CHECK ((("helena_budget"."agent_id" IS NOT NULL)::int + ("helena_budget"."issue_id" IS NOT NULL)::int + ("helena_budget"."project_id" IS NOT NULL)::int + ("helena_budget"."department_id" IS NOT NULL)::int + ("helena_budget"."goal_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_period_check" CHECK ("helena_budget"."period" IN ('day', 'week', 'month'));