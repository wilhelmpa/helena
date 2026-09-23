CREATE TABLE "service_heartbeat" (
	"service" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_team_start" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"issue_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"actor_user_id" text,
	"event_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_team_start_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "agent_team_start_status_check" CHECK ("agent_team_start"."status" IN ('pending', 'started', 'refused', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "claims" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_team_start" ADD CONSTRAINT "agent_team_start_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_team_start" ADD CONSTRAINT "agent_team_start_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_team_start" ADD CONSTRAINT "agent_team_start_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_team_start" ADD CONSTRAINT "agent_team_start_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_team_start_due_idx" ON "agent_team_start" USING btree ("next_attempt_at") WHERE "agent_team_start"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "agent_team_start_issue_idx" ON "agent_team_start" USING btree ("issue_id","id");