ALTER TABLE "user_preference" ALTER COLUMN "header_layout" SET DEFAULT 'classic';--> statement-breakpoint
UPDATE "user_preference" SET "header_layout" = 'classic' WHERE "header_layout" = 'single';
