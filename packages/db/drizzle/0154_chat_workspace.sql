CREATE TABLE "chat_prompt" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" integer,
	"command" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "issue_id" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "active_message_id" integer;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_prompt" ADD CONSTRAINT "chat_prompt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_prompt" ADD CONSTRAINT "chat_prompt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_prompt_user_scope_command_uq" ON "chat_prompt" USING btree ("user_id",coalesce("project_id", 0),"command");--> statement-breakpoint
ALTER TABLE "agent_chat_message" ADD CONSTRAINT "agent_chat_message_parent_id_agent_chat_message_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD CONSTRAINT "agent_chat_thread_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_thread" ADD CONSTRAINT "agent_chat_thread_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_chat_message_parent_idx" ON "agent_chat_message" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "agent_chat_thread_user_idx" ON "agent_chat_thread" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_chat_thread_issue_idx" ON "agent_chat_thread" USING btree ("issue_id");--> statement-breakpoint
UPDATE "agent_chat_message" m SET "parent_id" = p.prev
  FROM (SELECT "id", lag("id") OVER (PARTITION BY "thread_id" ORDER BY "id") AS prev FROM "agent_chat_message") p
  WHERE p."id" = m."id";--> statement-breakpoint
UPDATE "agent_chat_thread" t SET "active_message_id" = (SELECT max(m."id") FROM "agent_chat_message" m WHERE m."thread_id" = t."id");--> statement-breakpoint
UPDATE "agent_chat_message" m SET "session_id" = t."cli_session_id"
  FROM "agent_chat_thread" t
  WHERE t."id" = m."thread_id" AND m."role" = 'assistant' AND t."cli_session_id" IS NOT NULL;--> statement-breakpoint
UPDATE "agent_chat_thread" t SET "project_id" = s."project_id"
  FROM (
    SELECT a."id" AS agent_id, min(pm."project_id") AS project_id
    FROM "ai_agent" a JOIN "project_member" pm ON pm."user_id" = a."user_id"
    WHERE lower(a."username") <> 'master'
    GROUP BY a."id"
    HAVING count(*) = 1
  ) s
  WHERE s.agent_id = t."agent_id";
