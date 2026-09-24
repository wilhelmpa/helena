ALTER TABLE "agent_runtime_action" DROP CONSTRAINT "agent_runtime_action_kind_check";--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "model_check" jsonb;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "model_check" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runtime_action" ADD CONSTRAINT "agent_runtime_action_kind_check" CHECK ("agent_runtime_action"."kind" IN ('discard-skill', 'pin-skill', 'write-memory', 'rewrite-profile'));