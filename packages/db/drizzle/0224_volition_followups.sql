CREATE TABLE "volition_followup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"message_id" integer,
	"run_id" integer,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"prompt" text NOT NULL,
	"next_id" integer,
	"wait_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volition_followup_target_check" CHECK (("volition_followup"."message_id" IS NULL) <> ("volition_followup"."run_id" IS NULL)),
	CONSTRAINT "volition_followup_mode_check" CHECK ("volition_followup"."mode" IN ('inject', 'after', 'replace')),
	CONSTRAINT "volition_followup_state_check" CHECK ("volition_followup"."state" IN ('pending', 'applied', 'queued'))
);
--> statement-breakpoint
ALTER TABLE "volition_followup" ADD CONSTRAINT "volition_followup_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_followup" ADD CONSTRAINT "volition_followup_message_id_agent_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_followup" ADD CONSTRAINT "volition_followup_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "volition_followup_agent_state_idx" ON "volition_followup" USING btree ("agent_id","state");