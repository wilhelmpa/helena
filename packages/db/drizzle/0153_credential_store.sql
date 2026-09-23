CREATE TABLE "integration_credential_grant" (
	"credential_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	CONSTRAINT "integration_credential_grant_credential_id_agent_id_pk" PRIMARY KEY("credential_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "integration_credential_use" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"credential_id" integer,
	"credential_label" text NOT NULL,
	"agent_id" integer,
	"agent_name" text NOT NULL,
	"run_id" integer,
	"chat_message_id" integer,
	"action" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_credential_use_action_check" CHECK ("integration_credential_use"."action" IN ('delivered', 'used'))
);
--> statement-breakpoint
ALTER TABLE "integration_credential" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD CONSTRAINT "integration_credential_grant_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD CONSTRAINT "integration_credential_grant_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credential_grant_agent_idx" ON "integration_credential_grant" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "integration_credential_use_credential_idx" ON "integration_credential_use" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_credential_use_team_idx" ON "integration_credential_use" USING btree ("team_id","created_at");--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credential_project_idx" ON "integration_credential" USING btree ("project_id");