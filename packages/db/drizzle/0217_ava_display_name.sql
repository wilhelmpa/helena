INSERT INTO app_setting (key, value)
VALUES ('brand.displayName', '"Ava"'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = '"Ava"'::jsonb, updated_at = now()
WHERE app_setting.value = '"Helena"'::jsonb;--> statement-breakpoint
UPDATE "user" AS person
SET name = (SELECT value #>> '{}' FROM app_setting WHERE key = 'brand.displayName')
WHERE person.name = 'Helena'
  AND EXISTS (
    SELECT 1 FROM ai_agent AS agent
    WHERE agent.user_id = person.id AND agent.agent_role = 'home'
  );--> statement-breakpoint
UPDATE ai_agent
SET instructions = replace(
  replace(
    instructions,
    'You are the Home agent, the master of all agents of this system.',
    'Du bist ' || (SELECT value #>> '{}' FROM app_setting WHERE key = 'brand.displayName') ||
      ', der Home-Agent und Leiter aller Agenten dieses Systems.'
  ),
  'Work across projects, keep tasks traceable in Helena,',
  'Work across projects, keep tasks traceable in ' ||
    (SELECT value #>> '{}' FROM app_setting WHERE key = 'brand.displayName') || ','
)
WHERE agent_role = 'home'
  AND instructions LIKE 'You are the Home agent, the master of all agents of this system.%';
