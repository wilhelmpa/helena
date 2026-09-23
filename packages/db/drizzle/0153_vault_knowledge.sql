CREATE TABLE "vault_entry" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"project_id" integer,
	"kind" text NOT NULL,
	"mime" text,
	"size_bytes" bigint,
	"mtime" timestamp with time zone,
	"sha256" text,
	"title" text DEFAULT '' NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || translate(path, '/._-', '    ') || ' ' || coalesce(frontmatter ->> 'tags', '')), 'A') || setweight(to_tsvector('german'::regconfig, left(coalesce(text, ''), 100000)), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce(text, ''), 100000)), 'D')) STORED,
	"extraction_status" text DEFAULT 'none' NOT NULL,
	"extraction_error" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_entry_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "vault_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_move" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"sha256" text,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "document_asset" CASCADE;--> statement-breakpoint
DROP TABLE "project_document" CASCADE;--> statement-breakpoint
DROP TABLE "project_document_initiative" CASCADE;--> statement-breakpoint
DROP TABLE "project_document_issue" CASCADE;--> statement-breakpoint
DROP TABLE "project_document_preference" CASCADE;--> statement-breakpoint
DROP TABLE "project_document_revision" CASCADE;--> statement-breakpoint
ALTER TABLE "vault_entry" ADD CONSTRAINT "vault_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_link" ADD CONSTRAINT "vault_link_entry_id_vault_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."vault_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_entry_path_prefix_idx" ON "vault_entry" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "vault_entry_project_idx" ON "vault_entry" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "vault_entry_sha_idx" ON "vault_entry" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "vault_entry_search_idx" ON "vault_entry" USING gin ("search");--> statement-breakpoint
CREATE INDEX "vault_entry_extraction_idx" ON "vault_entry" USING btree ("extraction_status");--> statement-breakpoint
CREATE INDEX "vault_link_entry_idx" ON "vault_link" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "vault_link_target_idx" ON "vault_link" USING btree ("kind","target");--> statement-breakpoint
CREATE INDEX "vault_move_from_idx" ON "vault_move" USING btree ("from_path","moved_at");DROP FUNCTION IF EXISTS default_project_document_owner();--> statement-breakpoint
DROP FUNCTION IF EXISTS capture_project_document_revision();--> statement-breakpoint
DROP FUNCTION IF EXISTS rev_document();--> statement-breakpoint
DROP FUNCTION IF EXISTS rev_document_child();--> statement-breakpoint
DROP FUNCTION IF EXISTS project_document_issue_validate_project();--> statement-breakpoint
DROP FUNCTION IF EXISTS project_document_issue_rev();--> statement-breakpoint
DROP FUNCTION IF EXISTS project_document_initiative_validate_project();--> statement-breakpoint
DROP FUNCTION IF EXISTS project_document_initiative_rev();--> statement-breakpoint

-- The Docs tree of a project moves with its index rows: a note or folder that appears,
-- disappears, is renamed or changes content. A write that only refreshes the recorded
-- modification time moves nothing.
CREATE FUNCTION rev_vault_entry() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.path = OLD.path AND NEW.title = OLD.title
    AND NEW.kind = OLD.kind AND NEW.sha256 IS NOT DISTINCT FROM OLD.sha256
    AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.project_id IS NOT NULL THEN
    PERFORM bump_rev('documents:' || OLD.project_id, OLD.project_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.project_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    PERFORM bump_rev('documents:' || NEW.project_id, NEW.project_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER vault_entry_rev AFTER INSERT OR UPDATE OR DELETE ON vault_entry
  FOR EACH ROW EXECUTE FUNCTION rev_vault_entry();
--> statement-breakpoint

-- A note that starts or stops linking to a task ([[VOL-12]]) changes that task's screen,
-- which lists the notes linking to it.
CREATE FUNCTION rev_vault_task_link() RETURNS trigger AS $$
DECLARE
  r vault_link%ROWTYPE;
  linked_issue_id integer;
  linked_project_id integer;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF r.kind <> 'task' OR r.target !~ '-[0-9]{1,9}$' THEN
    RETURN NULL;
  END IF;
  SELECT i.id, i.project_id INTO linked_issue_id, linked_project_id
  FROM issue i JOIN project p ON p.id = i.project_id
  WHERE p.key = substring(r.target from '^(.*)-[0-9]+$')
    AND i.sequence_number = substring(r.target from '-([0-9]+)$')::integer;
  IF linked_issue_id IS NOT NULL THEN
    PERFORM bump_rev('issue:' || linked_issue_id, linked_project_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER vault_link_rev AFTER INSERT OR DELETE ON vault_link
  FOR EACH ROW EXECUTE FUNCTION rev_vault_task_link();
