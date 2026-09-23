ALTER TABLE "issue" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_folder_id_project_view_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."project_view_folder"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_folder_idx" ON "issue" USING btree ("folder_id") WHERE "issue"."folder_id" IS NOT NULL;