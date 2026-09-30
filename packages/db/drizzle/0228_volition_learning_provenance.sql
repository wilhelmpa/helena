ALTER TABLE "agent_memory_revision" ADD COLUMN "source_context" jsonb;
ALTER TABLE "team" ADD COLUMN "agent_context_limits" jsonb DEFAULT '{}'::jsonb NOT NULL;
