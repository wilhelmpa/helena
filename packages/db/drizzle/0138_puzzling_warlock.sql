CREATE TABLE "project_deprovisioning_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"project" jsonb NOT NULL,
	"requested_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_deprovisioning_job_project_unique" UNIQUE("project_id"),
	CONSTRAINT "project_deprovisioning_job_status_check" CHECK ("project_deprovisioning_job"."status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "project_deprovisioning_job_due_idx" ON "project_deprovisioning_job" USING btree ("next_attempt_at") WHERE "project_deprovisioning_job"."status" = 'pending';