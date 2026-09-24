CREATE TABLE "knowledge_chunk" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"model" text,
	"embedding" real[],
	"embedded_at" timestamp with time zone,
	CONSTRAINT "knowledge_chunk_item_ordinal_key" UNIQUE("item_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "knowledge_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"item_id" text NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"visibility" text NOT NULL,
	"owner_id" text,
	"permission" text,
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"href" text NOT NULL,
	"mime_type" text,
	"language" text,
	"group_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"author" text,
	"origin" text,
	"run_id" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('german'::regconfig, left(coalesce(text, ''), 100000)), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce(text, ''), 100000)), 'D')) STORED,
	CONSTRAINT "knowledge_item_source_item_key" UNIQUE("source","item_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_source_state" (
	"source" text PRIMARY KEY NOT NULL,
	"watermark" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_sweep_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_board" ADD COLUMN "vault_path" text;--> statement-breakpoint
ALTER TABLE "note_board" ADD COLUMN "vault_sha256" text;--> statement-breakpoint
ALTER TABLE "vault_entry" ADD COLUMN "last_author" text;--> statement-breakpoint
ALTER TABLE "vault_entry" ADD COLUMN "last_run_id" integer;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_item_id_knowledge_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_link" ADD CONSTRAINT "knowledge_link_item_id_knowledge_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunk_pending_idx" ON "knowledge_chunk" USING btree ("id") WHERE "knowledge_chunk"."embedding" IS NULL;--> statement-breakpoint
CREATE INDEX "knowledge_item_search_idx" ON "knowledge_item" USING gin ("search");--> statement-breakpoint
CREATE INDEX "knowledge_item_scope_idx" ON "knowledge_item" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_owner_idx" ON "knowledge_item" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_updated_idx" ON "knowledge_item" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_link_item_idx" ON "knowledge_link" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "knowledge_link_target_idx" ON "knowledge_link" USING btree ("target");--> statement-breakpoint
CREATE UNIQUE INDEX "note_board_vault_path_key" ON "note_board" USING btree ("vault_path") WHERE "note_board"."vault_path" IS NOT NULL;