ALTER TABLE "telegram_channel_event" ADD COLUMN "pairing_id" uuid;--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD COLUMN "pairing_id" uuid DEFAULT gen_random_uuid() NOT NULL;