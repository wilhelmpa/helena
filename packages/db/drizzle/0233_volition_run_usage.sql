CREATE UNIQUE INDEX agent_usage_run_kind_uq ON agent_usage (run_id) WHERE kind = 'run' AND run_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION volition_record_terminal_run_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'pending' AND NEW.finished_at IS NOT NULL THEN
    INSERT INTO agent_usage (agent_id, project_id, run_id, kind, runtime, model, provider, session_id, input_tokens, output_tokens, duration_ms, occurred_at)
    VALUES (NEW.agent_id, NEW.project_id, NEW.id, 'run', NULL,
      COALESCE(NEW.model_check->'used'->>'model', NEW.model), NEW.model_check->'used'->>'provider', NEW.session_id,
      GREATEST(COALESCE(NEW.input_tokens, 0), 0), GREATEST(COALESCE(NEW.output_tokens, 0), 0),
      GREATEST(0, LEAST(2000000000, EXTRACT(EPOCH FROM (NEW.finished_at - COALESCE(NEW.claimed_at, NEW.started_at))) * 1000))::integer, NEW.finished_at)
    ON CONFLICT (run_id) WHERE kind = 'run' AND run_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER volition_terminal_run_usage AFTER INSERT OR UPDATE OF status, finished_at ON agent_run FOR EACH ROW EXECUTE FUNCTION volition_record_terminal_run_usage();
