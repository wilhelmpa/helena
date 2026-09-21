CREATE TABLE "project_action_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" integer,
	"project_id" integer NOT NULL,
	"issue_id" integer,
	"actor_user_id" text,
	"action_name" text NOT NULL,
	"trigger" text NOT NULL,
	"from_column_id" integer NOT NULL,
	"to_column_id" integer NOT NULL,
	"root_event_id" uuid NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_action_run_trigger_check" CHECK ("project_action_run"."trigger" IN ('manual', 'issue_state_changed')),
	CONSTRAINT "project_action_run_status_check" CHECK ("project_action_run"."status" IN ('pending', 'running', 'succeeded', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "project_action" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_action_run" ADD CONSTRAINT "project_action_run_action_id_project_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."project_action"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_action_run" ADD CONSTRAINT "project_action_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_action_run" ADD CONSTRAINT "project_action_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_action_run" ADD CONSTRAINT "project_action_run_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_action_run_step_uq" ON "project_action_run" USING btree ("root_event_id","action_id","to_column_id");--> statement-breakpoint
CREATE INDEX "project_action_run_due_idx" ON "project_action_run" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "project_action_run_project_idx" ON "project_action_run" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "project_action" ADD CONSTRAINT "project_action_trigger_check" CHECK ("project_action"."trigger" IN ('manual', 'issue_state_changed'));--> statement-breakpoint
CREATE FUNCTION rev_project_action_run() RETURNS trigger AS $$
DECLARE
  r project_action_run%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM bump_rev('action-runs:' || r.project_id, r.project_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER project_action_run_rev AFTER INSERT OR UPDATE OR DELETE ON project_action_run
  FOR EACH ROW EXECUTE FUNCTION rev_project_action_run();
