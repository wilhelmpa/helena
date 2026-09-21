ALTER TABLE "hub_inbox_event" ADD COLUMN "issue_activity_id" integer;--> statement-breakpoint
ALTER TABLE "hub_inbox_source" ADD COLUMN "auto_task_project_id" integer;--> statement-breakpoint
ALTER TABLE "hub_inbox_event" ADD CONSTRAINT "hub_inbox_event_issue_activity_id_issue_activity_id_fk" FOREIGN KEY ("issue_activity_id") REFERENCES "public"."issue_activity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_source" ADD CONSTRAINT "hub_inbox_source_auto_task_project_id_project_id_fk" FOREIGN KEY ("auto_task_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_inbox_event" ADD CONSTRAINT "hub_inbox_event_issue_activity_id_unique" UNIQUE("issue_activity_id");