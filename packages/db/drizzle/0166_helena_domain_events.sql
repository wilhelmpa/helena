CREATE TABLE "helena_domain_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"subject" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"team_id" integer,
	"project_id" integer,
	"actor" text,
	"event" jsonb NOT NULL,
	"fanned_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_domain_event_delivery" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_row_id" bigint NOT NULL,
	"consumer" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helena_domain_event_delivery" ADD CONSTRAINT "helena_domain_event_delivery_event_row_id_helena_domain_event_id_fk" FOREIGN KEY ("event_row_id") REFERENCES "public"."helena_domain_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_domain_event_event_id_idx" ON "helena_domain_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "helena_domain_event_pending_idx" ON "helena_domain_event" USING btree ("id") WHERE "helena_domain_event"."fanned_out_at" is null;--> statement-breakpoint
CREATE INDEX "helena_domain_event_type_idx" ON "helena_domain_event" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_domain_event_delivery_event_consumer_idx" ON "helena_domain_event_delivery" USING btree ("event_row_id","consumer");--> statement-breakpoint
CREATE INDEX "helena_domain_event_delivery_due_idx" ON "helena_domain_event_delivery" USING btree ("next_attempt_at") WHERE "helena_domain_event_delivery"."status" = 'pending';