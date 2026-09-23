ALTER TABLE "agent_run" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "resumes" integer DEFAULT 0 NOT NULL;