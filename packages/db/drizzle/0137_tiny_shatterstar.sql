CREATE TABLE "project_workflow_assignment" (
	"project_id" integer NOT NULL,
	"workflow_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capability_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_workflow_assignment_project_id_workflow_id_pk" PRIMARY KEY("project_id","workflow_id"),
	CONSTRAINT "project_workflow_assignment_id_check" CHECK ("project_workflow_assignment"."workflow_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "project_workflow_assignment" ADD CONSTRAINT "project_workflow_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workflow_assignment" ADD CONSTRAINT "project_workflow_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_workflow_assignment_project_idx" ON "project_workflow_assignment" USING btree ("project_id","enabled","workflow_id");