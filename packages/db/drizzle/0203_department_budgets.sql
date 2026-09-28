ALTER TABLE "helena_budget" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_department_id_organization_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."organization_department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_budget" DROP CONSTRAINT "helena_budget_target_check";--> statement-breakpoint
ALTER TABLE "helena_budget" ADD CONSTRAINT "helena_budget_target_check" CHECK ((("agent_id" IS NOT NULL)::int + ("project_id" IS NOT NULL)::int + ("department_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_budget_department_uq" ON "helena_budget" USING btree ("department_id","metric","period") WHERE "department_id" IS NOT NULL;
