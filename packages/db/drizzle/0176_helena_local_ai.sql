CREATE TABLE "helena_local_ai_eval" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"server_id" integer NOT NULL,
	"model" text NOT NULL,
	"score" real NOT NULL,
	"threshold" real NOT NULL,
	"passed" boolean NOT NULL,
	"cases" integer NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms_p50" integer,
	"tokens_per_second" real,
	"error" text,
	"ran_by" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_model_server" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"key_source" text DEFAULT 'file' NOT NULL,
	"key_file" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"context_length" integer DEFAULT 65536 NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" jsonb,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_model_server_key_source_check" CHECK ("helena_model_server"."key_source" IN ('file', 'stored', 'none'))
);
--> statement-breakpoint
ALTER TABLE "helena_local_ai_eval" ADD CONSTRAINT "helena_local_ai_eval_server_id_helena_model_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."helena_model_server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_local_ai_eval" ADD CONSTRAINT "helena_local_ai_eval_ran_by_user_id_fk" FOREIGN KEY ("ran_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_local_ai_eval_class_idx" ON "helena_local_ai_eval" USING btree ("class_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_server_slug_idx" ON "helena_model_server" USING btree ("slug");