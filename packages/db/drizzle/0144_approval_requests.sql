CREATE TABLE "approval_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"run_id" integer,
	"issue_id" integer,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"follow_up_run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_request_kind_check" CHECK ("approval_request"."kind" IN ('send', 'publish', 'pay', 'delete', 'other')),
	CONSTRAINT "approval_request_status_check" CHECK ("approval_request"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_type_check";--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_follow_up_run_id_agent_run_id_fk" FOREIGN KEY ("follow_up_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_request_project_status_idx" ON "approval_request" USING btree ("project_id","status","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "approval_request_agent_idx" ON "approval_request" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'field', 'schedule', 'manual', 'approval'));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_check" CHECK ("notification"."type" IN ('assigned', 'mentioned', 'commented', 'state_changed', 'approval_requested'));--> statement-breakpoint
CREATE FUNCTION rev_approval_request() RETURNS trigger AS $$
DECLARE
  r record;
  team integer;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT team_id INTO team FROM project WHERE id = r.project_id;
  -- A request deleted with its project has no team left to move.
  IF team IS NOT NULL THEN
    PERFORM bump_rev('approvals:' || team, team);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approval_request_rev
AFTER INSERT OR UPDATE OR DELETE ON approval_request
FOR EACH ROW EXECUTE FUNCTION rev_approval_request();
