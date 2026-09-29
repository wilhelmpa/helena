CREATE TABLE "volition_profile_import" (
	"agent_id" integer NOT NULL,
	"source_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"sessions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volition_profile_import_agent_id_source_key_pk" PRIMARY KEY("agent_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "helena_agent_session" ADD COLUMN "imported_from" jsonb;--> statement-breakpoint
ALTER TABLE "volition_profile_import" ADD CONSTRAINT "volition_profile_import_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;