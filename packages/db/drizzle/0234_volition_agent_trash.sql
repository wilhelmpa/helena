ALTER TABLE "ai_agent" ADD COLUMN "deleted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE ai_agent AS a
SET deleted_at = now()
WHERE a.id = 116 AND a.team_id = 1 AND a.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM "user" AS u
    JOIN project_member AS pm ON pm.user_id = u.id
    JOIN project AS p ON p.id = pm.project_id
    WHERE u.id = a.user_id
      AND u.name = 'ABSCHLUSSTEST 122C Organigramm'
      AND p.key = 'ELLI' AND p.team_id = a.team_id
  );
