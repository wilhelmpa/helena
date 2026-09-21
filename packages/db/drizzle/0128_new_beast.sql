CREATE TABLE "project_provisioning_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"requested_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_provisioning_job_project_unique" UNIQUE("project_id"),
	CONSTRAINT "project_provisioning_job_status_check" CHECK ("project_provisioning_job"."status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "project_view_folder" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_view_folder_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
DROP INDEX "project_view_project_idx";--> statement-breakpoint
ALTER TABLE "project_view" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "project_provisioning_job" ADD CONSTRAINT "project_provisioning_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_view_folder" ADD CONSTRAINT "project_view_folder_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_provisioning_job_due_idx" ON "project_provisioning_job" USING btree ("next_attempt_at") WHERE "project_provisioning_job"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_view_folder_project_idx" ON "project_view_folder" USING btree ("project_id","position");--> statement-breakpoint
ALTER TABLE "project_view" ADD CONSTRAINT "project_view_folder_id_project_view_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."project_view_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_view_project_idx" ON "project_view" USING btree ("project_id","folder_id","position");