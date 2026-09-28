ALTER TABLE "ai_agent" ADD COLUMN "agent_role" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent" ADD COLUMN "project_scope" text DEFAULT 'selected' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "project_role" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
UPDATE "project" SET "project_role" = 'home' WHERE "key" = 'HOME';
--> statement-breakpoint
UPDATE "ai_agent" SET "project_scope" = 'all' WHERE lower("username") = 'master';
--> statement-breakpoint
UPDATE "ai_agent" SET "agent_role" = 'home'
WHERE "id" = (
  SELECT a."id" FROM "ai_agent" a
  LEFT JOIN "project" p ON p."team_id" = a."team_id" AND p."project_role" = 'home'
  WHERE lower(a."username") = 'master'
  ORDER BY (p."id" IS NOT NULL) DESC, a."id" ASC
  LIMIT 1
);
