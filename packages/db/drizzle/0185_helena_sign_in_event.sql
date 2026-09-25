CREATE TABLE "helena_sign_in_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"method" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"identity" text,
	"provider" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_sign_in_event_method_check" CHECK ("helena_sign_in_event"."method" IN ('edge', 'local_owner')),
	CONSTRAINT "helena_sign_in_event_outcome_check" CHECK ("helena_sign_in_event"."outcome" IN ('ok', 'refused'))
);
--> statement-breakpoint
ALTER TABLE "helena_sign_in_event" ADD CONSTRAINT "helena_sign_in_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_sign_in_event_created_idx" ON "helena_sign_in_event" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "helena_sign_in_event_method_idx" ON "helena_sign_in_event" USING btree ("method","created_at" DESC NULLS LAST);