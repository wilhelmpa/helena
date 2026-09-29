ALTER TABLE "ai_agent" ADD COLUMN "volition_learned_skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "ai_agent" SET "volition_learned_skills" = "runtime_learned_skills"
WHERE "runtime_policy"->>'runtime' = 'helena';
