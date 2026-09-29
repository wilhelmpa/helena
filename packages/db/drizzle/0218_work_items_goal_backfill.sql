-- The task field "Ziel" now names an organization goal (helena_goal_task), not a project
-- initiative. A task that hung under an initiative which contributes to an organization
-- goal keeps that goal: the goal it inherited becomes the goal it names itself, so its
-- progress and its "Warum" chain read the same as before. Only where neither the task nor
-- its parent already names a goal, which would win over the inherited one. Tasks under an
-- initiative without an organization goal keep their initiative link, untouched.
INSERT INTO "helena_goal_task" ("issue_id", "goal_id", "team_id")
SELECT i."id", l."goal_id", p."team_id"
FROM "issue" i
JOIN "initiative" ini ON ini."id" = i."initiative_id" AND ini."project_id" = i."project_id"
JOIN "helena_project_goal_link" l ON l."initiative_id" = ini."id"
JOIN "project" p ON p."id" = i."project_id"
JOIN "organization_goal" g ON g."id" = l."goal_id" AND g."team_id" = p."team_id"
WHERE NOT EXISTS (SELECT 1 FROM "helena_goal_task" t WHERE t."issue_id" = i."id")
  AND (
    i."parent_id" IS NULL
    OR NOT EXISTS (SELECT 1 FROM "helena_goal_task" t WHERE t."issue_id" = i."parent_id")
  )
ON CONFLICT ("issue_id") DO NOTHING;
