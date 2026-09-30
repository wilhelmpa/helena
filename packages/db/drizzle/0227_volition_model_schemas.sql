ALTER TABLE "ai_agent" ADD COLUMN "model_role" text NOT NULL DEFAULT 'general';
ALTER TABLE "ai_agent" ADD COLUMN "model_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE "ai_agent"
SET "model_role" = CASE WHEN "agent_role" = 'home' THEN 'home' ELSE 'general' END,
    "model_overrides" = jsonb_strip_nulls(jsonb_build_object(
      'runtime', "runtime_policy"->'runtime',
      'model', to_jsonb("model"),
      'reasoning', "runtime_policy"->'reasoningEffort',
      'escalation', CASE WHEN "runtime_policy"->'helena'->'escalation' IS NOT NULL THEN
        jsonb_build_object(
          'target', "runtime_policy"->'helena'->'escalation'->'target',
          'failures', CASE WHEN "runtime_policy"->'helena'->'escalation'->>'onFailure' = 'true' THEN 1 ELSE 0 END,
          'stalledSteps', 0,
          'onRequest', coalesce("runtime_policy"->'helena'->'escalation'->>'mode' <> 'never', true)
        ) ELSE NULL END
    ));
