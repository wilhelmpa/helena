ALTER TABLE "helena_local_ai_eval" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "helena_local_ai_eval" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "helena_local_ai_eval" ADD CONSTRAINT "helena_local_ai_eval_status_check" CHECK ("helena_local_ai_eval"."status" IN ('running', 'done'));--> statement-breakpoint
UPDATE "helena_local_ai_eval" SET "finished_at" = "ran_at" WHERE "finished_at" IS NULL;