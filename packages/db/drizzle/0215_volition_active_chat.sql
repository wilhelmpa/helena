CREATE TABLE "volition_active_chat" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"thread_id" text,
	"agent_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volition_active_chat_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
ALTER TABLE "volition_active_chat" ADD CONSTRAINT "volition_active_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_active_chat" ADD CONSTRAINT "volition_active_chat_thread_id_agent_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_active_chat" ADD CONSTRAINT "volition_active_chat_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;