CREATE TABLE "agent_egress_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"run_id" integer,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"connections" integer DEFAULT 1 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_egress_event_decision_check" CHECK ("agent_egress_event"."decision" IN ('allowed', 'blocked')),
	CONSTRAINT "agent_egress_event_port_check" CHECK ("agent_egress_event"."port" >= 0 AND "agent_egress_event"."port" <= 65535)
);
--> statement-breakpoint
ALTER TABLE "agent_egress_event" ADD CONSTRAINT "agent_egress_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_egress_event" ADD CONSTRAINT "agent_egress_event_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_egress_event" ADD CONSTRAINT "agent_egress_event_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_egress_event_project_idx" ON "agent_egress_event" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "agent_egress_event_last_idx" ON "agent_egress_event" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "agent_egress_event_run_idx" ON "agent_egress_event" USING btree ("run_id");