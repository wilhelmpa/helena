CREATE TABLE "helena_provider_limit" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"source" text NOT NULL,
	"login" text,
	"plan" text,
	"windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra" jsonb,
	"reset_credits" integer,
	"allowed" boolean,
	"via" text DEFAULT 'probe' NOT NULL,
	"unavailable" text,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_provider_limit_via_check" CHECK ("helena_provider_limit"."via" IN ('probe', 'passive'))
);
--> statement-breakpoint
CREATE TABLE "helena_provider_limit_agent" (
	"limit_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_provider_limit_agent_limit_id_agent_id_pk" PRIMARY KEY("limit_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "helena_provider_limit_agent" ADD CONSTRAINT "helena_provider_limit_agent_limit_id_helena_provider_limit_id_fk" FOREIGN KEY ("limit_id") REFERENCES "public"."helena_provider_limit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_provider_limit_agent" ADD CONSTRAINT "helena_provider_limit_agent_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_provider_limit_account_idx" ON "helena_provider_limit" USING btree ("provider","account");--> statement-breakpoint
CREATE INDEX "helena_provider_limit_agent_agent_idx" ON "helena_provider_limit_agent" USING btree ("agent_id");