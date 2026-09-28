CREATE TABLE "issue_work_claim" (
	"issue_id" integer PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"claim" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD COLUMN "precheck_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_work_claim" ADD CONSTRAINT "issue_work_claim_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_claim" ADD CONSTRAINT "issue_work_claim_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_work_claim_expiry_idx" ON "issue_work_claim" USING btree ("expires_at");