ALTER TABLE "project_action" DROP CONSTRAINT "project_action_trigger_check";--> statement-breakpoint
ALTER TABLE "project_action_run" DROP CONSTRAINT "project_action_run_trigger_check";--> statement-breakpoint
ALTER TABLE "hub_inbox_source" ADD COLUMN "automation_actor_user_id" text;--> statement-breakpoint
ALTER TABLE "hub_inbox_source" ADD CONSTRAINT "hub_inbox_source_automation_actor_user_id_user_id_fk" FOREIGN KEY ("automation_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_action" ADD CONSTRAINT "project_action_trigger_check" CHECK ("project_action"."trigger" IN ('manual', 'issue_state_changed', 'issue_comment_added'));--> statement-breakpoint
ALTER TABLE "project_action_run" ADD CONSTRAINT "project_action_run_trigger_check" CHECK ("project_action_run"."trigger" IN ('manual', 'issue_state_changed', 'issue_comment_added'));