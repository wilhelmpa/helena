ALTER TABLE "agent_run" ADD COLUMN "work_class" text;--> statement-breakpoint
ALTER TABLE "helena_local_ai_eval" ADD COLUMN "eval_version" integer DEFAULT 1 NOT NULL;