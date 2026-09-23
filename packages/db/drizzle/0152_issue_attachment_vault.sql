ALTER TABLE "issue_attachment" ALTER COLUMN "s3_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD COLUMN "vault_path" text;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD COLUMN "linked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "issue_attachment_vault_path_idx" ON "issue_attachment" USING btree ("vault_path");--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_storage_check" CHECK (("issue_attachment"."s3_key" IS NULL) <> ("issue_attachment"."vault_path" IS NULL));