CREATE OR REPLACE FUNCTION assign_home_agent_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lower(NEW.username) = 'master' AND NOT EXISTS (
    SELECT 1 FROM ai_agent WHERE agent_role = 'home'
  ) THEN
    NEW.agent_role := 'home';
    NEW.project_scope := 'all';
  END IF;
  RETURN NEW;
END $$;
