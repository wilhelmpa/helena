DROP INDEX "project_member_user_idx";--> statement-breakpoint
CREATE INDEX "project_member_user_project_idx" ON "project_member" USING btree ("user_id","project_id");