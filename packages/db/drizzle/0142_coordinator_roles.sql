-- Each project's Hermes coordinator leads its agent team. Coordinators created before
-- this carry no organization assignment; one is added, and a role set by hand is kept.
INSERT INTO "organization_agent_assignment" ("team_id", "agent_id", "role")
SELECT "team_id", "id", 'coordinator'
FROM "ai_agent"
WHERE "kind" = 'external' AND "username" LIKE 'hermes-%-coordinator'
ON CONFLICT ("team_id", "agent_id") DO UPDATE SET "role" = 'coordinator'
WHERE "organization_agent_assignment"."role" IS NULL;
