ALTER TABLE "ai_agent" ADD COLUMN "template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Each project coordinator reports to the Home agent of its team. A reporting line set
-- by hand is kept, and so is a Home agent that reports to the coordinator.
UPDATE "organization_agent_assignment" AS "assignment"
SET "reports_to_agent_id" = "home"."id", "updated_at" = now()
FROM "ai_agent" AS "coordinator", "ai_agent" AS "home"
WHERE "coordinator"."id" = "assignment"."agent_id"
  AND "coordinator"."username" LIKE 'hermes-%-coordinator'
  AND "assignment"."role" = 'coordinator'
  AND "assignment"."reports_to_agent_id" IS NULL
  AND "home"."team_id" = "assignment"."team_id"
  AND lower("home"."username") = 'master'
  AND NOT EXISTS (
    SELECT 1 FROM "organization_agent_assignment" AS "home_assignment"
    WHERE "home_assignment"."agent_id" = "home"."id"
      AND "home_assignment"."reports_to_agent_id" = "coordinator"."id"
  );
