CREATE TABLE "agent_chat_catalog" (
	"agent_id" integer PRIMARY KEY NOT NULL,
	"models" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "thinking_level" text;--> statement-breakpoint
ALTER TABLE "agent_chat_catalog" ADD CONSTRAINT "agent_chat_catalog_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;