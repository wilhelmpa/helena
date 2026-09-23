DROP INDEX "approval_request_pending_run_uq";--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "command" text;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_request_pending_run_uq" ON "approval_request" USING btree ("run_id","kind","action",md5(coalesce("command", ''))) WHERE "approval_request"."status" = 'pending' AND "approval_request"."run_id" IS NOT NULL;