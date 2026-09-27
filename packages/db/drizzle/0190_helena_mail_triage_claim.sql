CREATE TABLE "helena_mail_triage_claim" (
	"project_id" integer PRIMARY KEY NOT NULL,
	"run_token" text NOT NULL,
	"runtime" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helena_mail_triage_claim" ADD CONSTRAINT "helena_mail_triage_claim_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;