UPDATE "ai_agent" SET "volition_learned_skills" = "runtime_learned_skills"
WHERE "runtime_policy"->>'runtime' = 'helena';
