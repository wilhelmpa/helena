ALTER TABLE "organization_agent_assignment" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD COLUMN "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD CONSTRAINT "organization_agent_role_check" CHECK ("organization_agent_assignment"."role" IS NULL OR "organization_agent_assignment"."role" IN ('coordinator', 'specialist', 'reviewer'));--> statement-breakpoint
UPDATE "organization_agent_assignment" SET "role" = 'coordinator'
FROM "ai_agent"
WHERE "ai_agent"."id" = "organization_agent_assignment"."agent_id"
  AND "ai_agent"."username" LIKE 'hermes-%-coordinator';
