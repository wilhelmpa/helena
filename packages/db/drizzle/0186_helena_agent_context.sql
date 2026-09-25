CREATE TABLE "helena_goal_note" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"goal_id" integer NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"proposed_status" text,
	"decision" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_goal_note_status_check" CHECK ("helena_goal_note"."proposed_status" IS NULL OR "helena_goal_note"."proposed_status" IN ('planned', 'active', 'achieved', 'paused')),
	CONSTRAINT "helena_goal_note_decision_check" CHECK ("helena_goal_note"."decision" IS NULL OR "helena_goal_note"."decision" IN ('accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "helena_goal_task" (
	"issue_id" integer PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"linked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_chat_reflection" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"agent_id" integer NOT NULL,
	"reason" text NOT NULL,
	"upto_message_id" integer NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claims" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"session_id" text,
	"model" text,
	"saved" jsonb,
	"summary" text,
	"last_error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_chat_reflection_status_check" CHECK ("helena_chat_reflection"."status" IN ('pending', 'success', 'failed', 'canceled')),
	CONSTRAINT "helena_chat_reflection_reason_check" CHECK ("helena_chat_reflection"."reason" IN ('idle', 'turns'))
);
--> statement-breakpoint
ALTER TABLE "helena_goal_note" ADD CONSTRAINT "helena_goal_note_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_note" ADD CONSTRAINT "helena_goal_note_goal_id_organization_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."organization_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_note" ADD CONSTRAINT "helena_goal_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_note" ADD CONSTRAINT "helena_goal_note_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_task" ADD CONSTRAINT "helena_goal_task_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_task" ADD CONSTRAINT "helena_goal_task_goal_id_organization_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."organization_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_task" ADD CONSTRAINT "helena_goal_task_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_goal_task" ADD CONSTRAINT "helena_goal_task_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_chat_reflection" ADD CONSTRAINT "helena_chat_reflection_thread_id_agent_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_chat_reflection" ADD CONSTRAINT "helena_chat_reflection_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_goal_note_goal_idx" ON "helena_goal_note" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX "helena_goal_task_goal_idx" ON "helena_goal_task" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "helena_chat_reflection_due_idx" ON "helena_chat_reflection" USING btree ("agent_id","next_attempt_at") WHERE "helena_chat_reflection"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "helena_chat_reflection_thread_idx" ON "helena_chat_reflection" USING btree ("thread_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_chat_reflection_waiting_uq" ON "helena_chat_reflection" USING btree ("thread_id") WHERE "helena_chat_reflection"."status" = 'pending';