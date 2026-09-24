CREATE TABLE "connector_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"credential_id" integer,
	"agent_id" integer,
	"project_id" integer,
	"run_id" integer,
	"connector" text NOT NULL,
	"tool" text NOT NULL,
	"category" text NOT NULL,
	"service" text,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_request_id" integer,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "connector_action_status_check" CHECK ("connector_action"."status" IN ('pending', 'running', 'done', 'failed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "connector_auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"connector" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_credential_use" DROP CONSTRAINT "integration_credential_use_action_check";--> statement-breakpoint
ALTER TABLE "integration_credential_grant" DROP CONSTRAINT "integration_credential_grant_credential_id_agent_id_pk";--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD COLUMN "status_detail" text;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD COLUMN "service" text;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD COLUMN "access" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "mail_account" ADD COLUMN "auth" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_account" ADD COLUMN "fetch_days" integer;--> statement-breakpoint
ALTER TABLE "mail_account" ALTER COLUMN "fetch_days" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "mail_account" ADD COLUMN "pruned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_action" ADD CONSTRAINT "connector_action_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_session" ADD CONSTRAINT "connector_auth_session_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_session" ADD CONSTRAINT "connector_auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_action_pending_idx" ON "connector_action" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "connector_action_team_idx" ON "connector_action" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "connector_auth_session_expires_idx" ON "connector_auth_session" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD CONSTRAINT "integration_credential_grant_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_grant_uq" ON "integration_credential_grant" USING btree ("credential_id",coalesce("agent_id", 0),coalesce("project_id", 0),coalesce("service", ''));--> statement-breakpoint
CREATE INDEX "integration_credential_grant_project_idx" ON "integration_credential_grant" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_status_check" CHECK ("integration_credential"."status" IS NULL OR "integration_credential"."status" IN ('ok', 'needs_auth', 'error'));--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD CONSTRAINT "integration_credential_grant_subject_check" CHECK (("integration_credential_grant"."agent_id" IS NULL) <> ("integration_credential_grant"."project_id" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_credential_grant" ADD CONSTRAINT "integration_credential_grant_access_check" CHECK ("integration_credential_grant"."access" IN ('read', 'write'));--> statement-breakpoint
ALTER TABLE "integration_credential_use" ADD CONSTRAINT "integration_credential_use_action_check" CHECK ("integration_credential_use"."action" IN ('delivered', 'used', 'called', 'denied', 'approval', 'changed'));--> statement-breakpoint
ALTER TABLE "mail_account" ADD CONSTRAINT "mail_account_auth_check" CHECK ("mail_account"."auth" IN ('password', 'xoauth2'));--> statement-breakpoint
ALTER TABLE "mail_account" ADD CONSTRAINT "mail_account_fetch_days_check" CHECK ("mail_account"."fetch_days" IS NULL OR "mail_account"."fetch_days" BETWEEN 1 AND 36500);--> statement-breakpoint
ALTER TABLE "mail_account" ADD COLUMN "reset_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'field', 'schedule', 'manual', 'approval', 'workspace'));
