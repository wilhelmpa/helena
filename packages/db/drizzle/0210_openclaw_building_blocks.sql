CREATE TABLE "standing_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"author_user_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"decided_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_order_scope_check" CHECK (("standing_order"."project_id" IS NULL) <> ("standing_order"."agent_id" IS NULL)),
	CONSTRAINT "standing_order_status_check" CHECK ("standing_order"."status" IN ('proposed', 'confirmed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "telegram_alert_notice" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_key" text NOT NULL,
	"alert_opened_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "telegram_alert_notice_status_check" CHECK ("telegram_alert_notice"."status" IN ('pending', 'acknowledged', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "telegram_approval_notice" (
	"id" serial PRIMARY KEY NOT NULL,
	"approval_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_channel_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"update_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"approval_id" integer,
	"approved" boolean,
	"state" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"answer_message_id" integer,
	"response_text" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_channel_event_kind_check" CHECK ("telegram_channel_event"."kind" IN ('message', 'decision')),
	CONSTRAINT "telegram_channel_event_state_check" CHECK ("telegram_channel_event"."state" IN ('pending', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
UPDATE "user_telegram_account" SET "telegram_user_id" = "chat_id" WHERE "chat_id" ~ '^[0-9]+$';--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD COLUMN "selected_agent_id" integer;--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD COLUMN "selected_project_id" integer;--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD COLUMN "current_thread_id" text;--> statement-breakpoint
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order" ADD CONSTRAINT "standing_order_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_alert_notice" ADD CONSTRAINT "telegram_alert_notice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_approval_notice" ADD CONSTRAINT "telegram_approval_notice_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_approval_notice" ADD CONSTRAINT "telegram_approval_notice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channel_event" ADD CONSTRAINT "telegram_channel_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channel_event" ADD CONSTRAINT "telegram_channel_event_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channel_event" ADD CONSTRAINT "telegram_channel_event_answer_message_id_agent_chat_message_id_fk" FOREIGN KEY ("answer_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standing_order_project_idx" ON "standing_order" USING btree ("project_id","status","active");--> statement-breakpoint
CREATE INDEX "standing_order_agent_idx" ON "standing_order" USING btree ("agent_id","status","active");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_alert_notice_uq" ON "telegram_alert_notice" USING btree ("alert_key","alert_opened_at","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_approval_notice_uq" ON "telegram_approval_notice" USING btree ("approval_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_channel_event_update_uq" ON "telegram_channel_event" USING btree ("bot_id","update_id");--> statement-breakpoint
CREATE INDEX "telegram_channel_event_pending_idx" ON "telegram_channel_event" USING btree ("state","id");--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD CONSTRAINT "user_telegram_account_selected_agent_id_ai_agent_id_fk" FOREIGN KEY ("selected_agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_telegram_account" ADD CONSTRAINT "user_telegram_account_selected_project_id_project_id_fk" FOREIGN KEY ("selected_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_telegram_account_telegram_user_id_unique" ON "user_telegram_account" USING btree ("telegram_user_id") WHERE "user_telegram_account"."telegram_user_id" IS NOT NULL;