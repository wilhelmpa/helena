-- Custom SQL migration file, put your code below! --
-- 'agent-runs:<projectId>' moves when a run of the project is queued, starts, ends or
-- is removed. A heartbeat only extends the lease, so it does not move the scope.
CREATE FUNCTION rev_agent_run() RETURNS trigger AS $$
DECLARE
  r agent_run%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM bump_rev('agent-runs:' || r.project_id, r.project_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER agent_run_rev AFTER INSERT OR DELETE OR UPDATE OF status, started_at, finished_at
  ON agent_run FOR EACH ROW EXECUTE FUNCTION rev_agent_run();
