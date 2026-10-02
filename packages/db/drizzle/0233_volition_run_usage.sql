ALTER TABLE agent_usage ADD COLUMN provisional boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX agent_usage_provisional_run_uq ON agent_usage (run_id) WHERE kind = 'run' AND run_id IS NOT NULL AND provisional;
--> statement-breakpoint
CREATE FUNCTION volition_record_terminal_run_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'pending' AND NEW.finished_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_usage WHERE run_id = NEW.id AND kind = 'run') THEN
    INSERT INTO agent_usage (agent_id, project_id, run_id, kind, runtime, model, provider, session_id, input_tokens, output_tokens, duration_ms, occurred_at, provisional)
    VALUES (NEW.agent_id, NEW.project_id, NEW.id, 'run', NULL,
      COALESCE(NEW.model_check->'used'->>'model',
        (SELECT model FROM helena_agent_session WHERE run_id = NEW.id AND kind = 'run' ORDER BY updated_at DESC LIMIT 1),
        NEW.model, NEW.model_check->'configured'->>'model'), NEW.model_check->'used'->>'provider', NEW.session_id,
      GREATEST(COALESCE(NEW.input_tokens, 0), 0), GREATEST(COALESCE(NEW.output_tokens, 0), 0),
      GREATEST(0, LEAST(2000000000, EXTRACT(EPOCH FROM (NEW.finished_at - COALESCE(NEW.claimed_at, NEW.started_at))) * 1000))::integer, NEW.finished_at, true)
    ON CONFLICT (run_id) WHERE kind = 'run' AND run_id IS NOT NULL AND provisional DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER volition_terminal_run_usage AFTER INSERT OR UPDATE OF status, finished_at ON agent_run FOR EACH ROW EXECUTE FUNCTION volition_record_terminal_run_usage();
