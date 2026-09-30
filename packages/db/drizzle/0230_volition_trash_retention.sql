CREATE TABLE "volition_trash_purge" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"team_id" integer,
	"project_id" integer,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volition_trash_purge_kind_check" CHECK ("volition_trash_purge"."kind" in ('chat', 'vault'))
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "trash_retention_days" integer;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "trash_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "volition_trash_purge" ADD CONSTRAINT "volition_trash_purge_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volition_trash_purge" ADD CONSTRAINT "volition_trash_purge_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "volition_trash_purge_project_idx" ON "volition_trash_purge" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "volition_trash_purge_batch_idx" ON "volition_trash_purge" USING btree ("batch_id");