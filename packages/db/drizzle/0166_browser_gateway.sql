CREATE TABLE "browser_gateway_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"agent_name" text NOT NULL,
	"actor" text NOT NULL,
	"tool" text NOT NULL,
	"target" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_gateway_event_actor_check" CHECK ("browser_gateway_event"."actor" IN ('agent', 'owner'))
);
--> statement-breakpoint
ALTER TABLE "agent_mcp_server" ADD COLUMN "builtin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "browser_gateway_event" ADD CONSTRAINT "browser_gateway_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_gateway_event" ADD CONSTRAINT "browser_gateway_event_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_gateway_event_project_idx" ON "browser_gateway_event" USING btree ("project_id","id");