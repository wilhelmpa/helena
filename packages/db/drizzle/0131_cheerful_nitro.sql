CREATE TABLE "hub_inbox_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"external_event_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"sender" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_inbox_event_source_id_external_event_id_unique" UNIQUE("source_id","external_event_id"),
	CONSTRAINT "hub_inbox_event_status_check" CHECK ("hub_inbox_event"."status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "hub_inbox_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"channel" text NOT NULL,
	"account" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"cursor" text,
	"confidence_threshold" double precision DEFAULT 0.75 NOT NULL,
	"auto_create_tasks" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_inbox_source_team_id_channel_account_unique" UNIQUE("team_id","channel","account"),
	CONSTRAINT "hub_inbox_source_channel_check" CHECK ("hub_inbox_source"."channel" IN ('mail', 'whatsapp')),
	CONSTRAINT "hub_inbox_source_status_check" CHECK ("hub_inbox_source"."status" IN ('disabled', 'connecting', 'connected', 'error')),
	CONSTRAINT "hub_inbox_source_confidence_check" CHECK ("hub_inbox_source"."confidence_threshold" >= 0 AND "hub_inbox_source"."confidence_threshold" <= 1)
);
--> statement-breakpoint
CREATE TABLE "hub_inbox_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"external_thread_id" text NOT NULL,
	"latest_external_message_id" text NOT NULL,
	"sender" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"external_url" text,
	"received_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 1 NOT NULL,
	"project_id" integer,
	"issue_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text,
	"triage_summary" text,
	"triage_status" text DEFAULT 'pending' NOT NULL,
	"triage_run_id" text,
	"triage_generation" integer DEFAULT 0 NOT NULL,
	"triage_attempts" integer DEFAULT 0 NOT NULL,
	"next_triage_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_triage_error" text,
	"confidence" double precision,
	"requires_action" boolean,
	"ticket_status" text DEFAULT 'none' NOT NULL,
	"ticket_attempts" integer DEFAULT 0 NOT NULL,
	"next_ticket_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_inbox_thread_source_id_external_thread_id_unique" UNIQUE("source_id","external_thread_id"),
	CONSTRAINT "hub_inbox_thread_status_check" CHECK ("hub_inbox_thread"."status" IN ('new', 'assigned', 'waiting', 'done')),
	CONSTRAINT "hub_inbox_thread_priority_check" CHECK ("hub_inbox_thread"."priority" IS NULL OR "hub_inbox_thread"."priority" IN ('low', 'medium', 'high', 'urgent')),
	CONSTRAINT "hub_inbox_thread_triage_status_check" CHECK ("hub_inbox_thread"."triage_status" IN ('pending', 'queued', 'running', 'succeeded', 'needs_review', 'failed', 'skipped')),
	CONSTRAINT "hub_inbox_thread_ticket_status_check" CHECK ("hub_inbox_thread"."ticket_status" IN ('none', 'pending', 'running', 'created', 'failed', 'skipped')),
	CONSTRAINT "hub_inbox_thread_confidence_check" CHECK ("hub_inbox_thread"."confidence" IS NULL OR ("hub_inbox_thread"."confidence" >= 0 AND "hub_inbox_thread"."confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "hub_inbox_event" ADD CONSTRAINT "hub_inbox_event_source_id_hub_inbox_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."hub_inbox_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_event" ADD CONSTRAINT "hub_inbox_event_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_source" ADD CONSTRAINT "hub_inbox_source_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_thread" ADD CONSTRAINT "hub_inbox_thread_source_id_hub_inbox_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."hub_inbox_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_thread" ADD CONSTRAINT "hub_inbox_thread_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_thread" ADD CONSTRAINT "hub_inbox_thread_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_thread" ADD CONSTRAINT "hub_inbox_thread_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_inbox_event_due_idx" ON "hub_inbox_event" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "hub_inbox_event_thread_idx" ON "hub_inbox_event" USING btree ("source_id","external_thread_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hub_inbox_source_due_idx" ON "hub_inbox_source" USING btree ("enabled","next_sync_at");--> statement-breakpoint
CREATE INDEX "hub_inbox_thread_team_idx" ON "hub_inbox_thread" USING btree ("team_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hub_inbox_thread_project_idx" ON "hub_inbox_thread" USING btree ("project_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "hub_inbox_thread_triage_due_idx" ON "hub_inbox_thread" USING btree ("triage_status","next_triage_at");--> statement-breakpoint
CREATE INDEX "hub_inbox_thread_ticket_due_idx" ON "hub_inbox_thread" USING btree ("ticket_status","next_ticket_at");
--> statement-breakpoint
CREATE FUNCTION rev_hub_inbox() RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM bump_rev('hub-inbox:' || r.team_id, r.team_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER hub_inbox_source_rev
AFTER INSERT OR UPDATE OR DELETE ON hub_inbox_source
FOR EACH ROW EXECUTE FUNCTION rev_hub_inbox();
--> statement-breakpoint
CREATE TRIGGER hub_inbox_thread_rev
AFTER INSERT OR UPDATE OR DELETE ON hub_inbox_thread
FOR EACH ROW EXECUTE FUNCTION rev_hub_inbox();
