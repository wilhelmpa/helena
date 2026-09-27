ALTER TABLE "issue_attachment" DROP CONSTRAINT "issue_attachment_storage_check";--> statement-breakpoint
ALTER TABLE "chat_attachment" ALTER COLUMN "s3_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "initiative_attachment" ALTER COLUMN "s3_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_attachment" ADD COLUMN "vault_path" text;--> statement-breakpoint
ALTER TABLE "chat_attachment" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "initiative_attachment" ADD COLUMN "vault_path" text;--> statement-breakpoint
ALTER TABLE "initiative_attachment" ADD COLUMN "sha256" text;--> statement-breakpoint
CREATE INDEX "chat_attachment_vault_path_idx" ON "chat_attachment" USING btree ("vault_path");--> statement-breakpoint
CREATE INDEX "initiative_attachment_vault_path_idx" ON "initiative_attachment" USING btree ("vault_path");--> statement-breakpoint
ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_storage_check" CHECK ("chat_attachment"."s3_key" IS NOT NULL OR "chat_attachment"."vault_path" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "initiative_attachment" ADD CONSTRAINT "initiative_attachment_storage_check" CHECK ("initiative_attachment"."s3_key" IS NOT NULL OR "initiative_attachment"."vault_path" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_storage_check" CHECK ("issue_attachment"."s3_key" IS NOT NULL OR "issue_attachment"."vault_path" IS NOT NULL);