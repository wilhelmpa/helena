ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_trigger_check";--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_check" CHECK ("agent_run"."trigger" IN ('mention', 'delegation', 'subtask', 'field', 'schedule', 'manual', 'approval', 'workspace', 'digest'));
