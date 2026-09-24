CREATE TABLE "helena_model_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"runtime" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"detail" text,
	"agent_id" integer,
	"run_id" integer,
	"chat_message_id" integer,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_model_availability_state_check" CHECK ("helena_model_availability"."state" IN ('unavailable', 'works'))
);
--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "failure" jsonb;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "failure" jsonb;--> statement-breakpoint
ALTER TABLE "helena_model_availability" ADD CONSTRAINT "helena_model_availability_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_availability" ADD CONSTRAINT "helena_model_availability_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_availability" ADD CONSTRAINT "helena_model_availability_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_availability_route_idx" ON "helena_model_availability" USING btree ("runtime","provider","model");