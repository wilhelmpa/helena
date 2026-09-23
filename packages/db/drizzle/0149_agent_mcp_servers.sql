CREATE TABLE "agent_mcp_server" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"env" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_mcp_server_team_id_name_unique" UNIQUE("team_id","name"),
	CONSTRAINT "agent_mcp_server_transport_check" CHECK ("agent_mcp_server"."transport" IN ('stdio', 'http', 'sse'))
);
--> statement-breakpoint
CREATE TABLE "agent_mcp_server_link" (
	"agent_id" integer NOT NULL,
	"mcp_server_id" integer NOT NULL,
	CONSTRAINT "agent_mcp_server_link_agent_id_mcp_server_id_pk" PRIMARY KEY("agent_id","mcp_server_id")
);
--> statement-breakpoint
ALTER TABLE "agent_mcp_server" ADD CONSTRAINT "agent_mcp_server_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_server_link" ADD CONSTRAINT "agent_mcp_server_link_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mcp_server_link" ADD CONSTRAINT "agent_mcp_server_link_mcp_server_id_agent_mcp_server_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."agent_mcp_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_mcp_server_team_idx" ON "agent_mcp_server" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "agent_mcp_server_link_server_idx" ON "agent_mcp_server_link" USING btree ("mcp_server_id");