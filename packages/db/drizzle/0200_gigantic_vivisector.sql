CREATE UNIQUE INDEX "ai_agent_one_home_uq" ON "ai_agent" USING btree ("agent_role") WHERE "ai_agent"."agent_role" = 'home';--> statement-breakpoint
CREATE UNIQUE INDEX "project_one_home_uq" ON "project" USING btree ("project_role") WHERE "project"."project_role" = 'home';--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_role_check" CHECK ("ai_agent"."agent_role" IN ('agent', 'home'));--> statement-breakpoint
ALTER TABLE "ai_agent" ADD CONSTRAINT "ai_agent_project_scope_check" CHECK ("ai_agent"."project_scope" IN ('selected', 'all'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_role_check" CHECK ("project"."project_role" IN ('project', 'home'));--> statement-breakpoint
-- The factory reset seeds its technical Home rows after migrations. Translate those
-- legacy bootstrap identifiers once, at the write boundary; runtime reads the roles.
CREATE FUNCTION assign_home_project_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key = 'HOME' THEN NEW.project_role := 'home'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_home_role_on_insert BEFORE INSERT ON project
FOR EACH ROW EXECUTE FUNCTION assign_home_project_role();
--> statement-breakpoint
CREATE FUNCTION assign_home_agent_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lower(NEW.username) = 'master' THEN
    NEW.agent_role := 'home';
    NEW.project_scope := 'all';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER agent_home_role_on_insert BEFORE INSERT ON ai_agent
FOR EACH ROW EXECUTE FUNCTION assign_home_agent_role();
