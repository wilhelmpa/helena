CREATE TABLE "helena_agent_run_tombstone" (
	"run_id" integer PRIMARY KEY NOT NULL,
	"agent_id" integer,
	"project_id" integer,
	"issue_id" integer,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"last_error" text,
	"failure" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"row" jsonb NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "helena_agent_run_tombstone_project_idx" ON "helena_agent_run_tombstone" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "helena_agent_run_tombstone_agent_idx" ON "helena_agent_run_tombstone" USING btree ("agent_id","finished_at");--> statement-breakpoint
-- Every deleted agent_run row is kept in helena_agent_run_tombstone before it goes, whether a
-- person deleted it or its agent, project or ticket took it along (ON DELETE CASCADE fires
-- row triggers on the referencing table too). TRUNCATE, which only the test reset uses, does
-- not fire it.
CREATE OR REPLACE FUNCTION helena_keep_deleted_agent_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO helena_agent_run_tombstone (run_id, agent_id, project_id, issue_id, status, "trigger",
      last_error, failure, created_at, finished_at, "row", deleted_by)
  VALUES (OLD.id, OLD.agent_id, OLD.project_id, OLD.issue_id, OLD.status, OLD."trigger",
      OLD.last_error, OLD.failure, OLD.created_at, OLD.finished_at, to_jsonb(OLD),
      current_user || coalesce('/' || nullif(current_setting('application_name', true), ''), ''))
  ON CONFLICT (run_id) DO UPDATE SET "row" = EXCLUDED."row", status = EXCLUDED.status,
      deleted_at = now(), deleted_by = EXCLUDED.deleted_by;
  RETURN OLD;
END $$;--> statement-breakpoint
CREATE TRIGGER helena_agent_run_keep BEFORE DELETE ON agent_run
  FOR EACH ROW EXECUTE FUNCTION helena_keep_deleted_agent_run();
