CREATE TABLE "helena_alert" (
	"key" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"subject" jsonb NOT NULL,
	"text" jsonb NOT NULL,
	"href" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "helena_alert_key_check" CHECK (length("helena_alert"."key") <= 300)
);
--> statement-breakpoint
CREATE TABLE "helena_push_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"visible_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_push_subscription" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"vapid_key" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"categories" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "notification_delivery" DROP CONSTRAINT "notification_delivery_channel_check";--> statement-breakpoint
ALTER TABLE "notification_delivery" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "helena_push_presence" ADD CONSTRAINT "helena_push_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_push_subscription" ADD CONSTRAINT "helena_push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_alert_open_idx" ON "helena_alert" USING btree ("source") WHERE "helena_alert"."resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_push_subscription_endpoint_idx" ON "helena_push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "helena_push_subscription_user_idx" ON "helena_push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_push_dedupe_idx" ON "notification_delivery" USING btree ("recipient",("payload" ->> 'dedupeKey')) WHERE "notification_delivery"."channel" = 'push' AND "notification_delivery"."status" = 'pending' AND ("notification_delivery"."payload" ->> 'dedupeKey') IS NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_project_check" CHECK ("notification_delivery"."project_id" IS NOT NULL OR "notification_delivery"."channel" = 'push');--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_delivery"."channel" IN ('email', 'telegram', 'push'));