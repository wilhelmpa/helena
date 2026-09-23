CREATE TABLE "mail_account" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_tls" boolean DEFAULT true NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_tls" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"password_ciphertext" text,
	"password_iv" text,
	"password_auth_tag" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_trash" boolean DEFAULT false NOT NULL,
	"sync_spam" boolean DEFAULT false NOT NULL,
	"triage_enabled" boolean DEFAULT false NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_account_team_id_address_unique" UNIQUE("team_id","address"),
	CONSTRAINT "mail_account_sync_status_check" CHECK ("mail_account"."sync_status" IN ('idle', 'importing', 'synced', 'error'))
);
--> statement-breakpoint
CREATE TABLE "mail_action" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"folder_id" integer NOT NULL,
	"uid" bigint NOT NULL,
	"kind" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_action_kind_check" CHECK ("mail_action"."kind" IN ('seen', 'unseen', 'flag', 'unflag', 'archive', 'trash'))
);
--> statement-breakpoint
CREATE TABLE "mail_attachment" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"vault_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_contact" (
	"team_id" integer NOT NULL,
	"address" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_contact_team_id_address_pk" PRIMARY KEY("team_id","address")
);
--> statement-breakpoint
CREATE TABLE "mail_draft" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"created_by_user_id" text,
	"thread_id" integer,
	"reply_to_message_id" integer,
	"issue_id" integer,
	"mode" text DEFAULT 'new' NOT NULL,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"send_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"approval_request_id" integer,
	"sent_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_draft_mode_check" CHECK ("mail_draft"."mode" IN ('new', 'reply', 'reply_all', 'forward')),
	CONSTRAINT "mail_draft_status_check" CHECK ("mail_draft"."status" IN ('draft', 'pending_approval', 'queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "mail_folder" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"sync" boolean DEFAULT true NOT NULL,
	"uid_validity" bigint,
	"uid_next" bigint DEFAULT 0 NOT NULL,
	"highest_modseq" text,
	"total_count" integer DEFAULT 0 NOT NULL,
	"synced_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "mail_folder_account_id_path_unique" UNIQUE("account_id","path"),
	CONSTRAINT "mail_folder_role_check" CHECK ("mail_folder"."role" IS NULL OR "mail_folder"."role" IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all'))
);
--> statement-breakpoint
CREATE TABLE "mail_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"thread_id" integer NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_address" text DEFAULT '' NOT NULL,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address_text" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"text_body" text DEFAULT '' NOT NULL,
	"html_body" text,
	"has_remote_images" boolean DEFAULT false NOT NULL,
	"allow_remote_images" boolean DEFAULT false NOT NULL,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"attachment_folder" text,
	"size" integer DEFAULT 0 NOT NULL,
	"raw_key" text NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"answered" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple'::regconfig, coalesce("subject", '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce("from_name", '') || ' ' || coalesce("address_text", '')), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce("text_body", ''), 100000)), 'C')) STORED,
	CONSTRAINT "mail_message_account_id_message_id_unique" UNIQUE("account_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "mail_message_folder" (
	"folder_id" integer NOT NULL,
	"uid" bigint NOT NULL,
	"message_id" integer NOT NULL,
	CONSTRAINT "mail_message_folder_folder_id_uid_pk" PRIMARY KEY("folder_id","uid")
);
--> statement-breakpoint
CREATE TABLE "mail_rule" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"account_id" integer,
	"match_type" text NOT NULL,
	"value" text NOT NULL,
	"project_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_rule_match_type_check" CHECK ("mail_rule"."match_type" IN ('address', 'domain'))
);
--> statement-breakpoint
CREATE TABLE "mail_thread" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"project_id" integer,
	"suggested_project_id" integer,
	"thread_key" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_from_name" text DEFAULT '' NOT NULL,
	"last_from_address" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_thread_account_id_thread_key_unique" UNIQUE("account_id","thread_key")
);
--> statement-breakpoint
CREATE TABLE "mail_thread_issue" (
	"thread_id" integer NOT NULL,
	"issue_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_thread_issue_thread_id_issue_id_pk" PRIMARY KEY("thread_id","issue_id")
);
--> statement-breakpoint
ALTER TABLE "mail_account" ADD CONSTRAINT "mail_account_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_account" ADD CONSTRAINT "mail_account_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_action" ADD CONSTRAINT "mail_action_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_action" ADD CONSTRAINT "mail_action_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_action" ADD CONSTRAINT "mail_action_folder_id_mail_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_attachment" ADD CONSTRAINT "mail_attachment_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_contact" ADD CONSTRAINT "mail_contact_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_thread_id_mail_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_reply_to_message_id_mail_message_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."mail_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_draft" ADD CONSTRAINT "mail_draft_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_folder" ADD CONSTRAINT "mail_folder_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message" ADD CONSTRAINT "mail_message_thread_id_mail_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_folder" ADD CONSTRAINT "mail_message_folder_folder_id_mail_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."mail_folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_folder" ADD CONSTRAINT "mail_message_folder_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rule" ADD CONSTRAINT "mail_rule_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rule" ADD CONSTRAINT "mail_rule_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rule" ADD CONSTRAINT "mail_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread" ADD CONSTRAINT "mail_thread_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread" ADD CONSTRAINT "mail_thread_account_id_mail_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread" ADD CONSTRAINT "mail_thread_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread" ADD CONSTRAINT "mail_thread_suggested_project_id_project_id_fk" FOREIGN KEY ("suggested_project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread_issue" ADD CONSTRAINT "mail_thread_issue_thread_id_mail_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_thread_issue" ADD CONSTRAINT "mail_thread_issue_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_account_project_idx" ON "mail_account" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "mail_action_account_idx" ON "mail_action" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "mail_attachment_message_idx" ON "mail_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_draft_due_idx" ON "mail_draft" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "mail_draft_team_idx" ON "mail_draft" USING btree ("team_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mail_message_thread_idx" ON "mail_message" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "mail_message_attachment_folder_idx" ON "mail_message" USING btree ("attachment_folder");--> statement-breakpoint
CREATE INDEX "mail_message_search_idx" ON "mail_message" USING gin ("search");--> statement-breakpoint
CREATE INDEX "mail_message_folder_message_idx" ON "mail_message_folder" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_rule_team_idx" ON "mail_rule" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "mail_thread_team_idx" ON "mail_thread" USING btree ("team_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mail_thread_project_idx" ON "mail_thread" USING btree ("project_id","last_message_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mail_thread_issue_issue_idx" ON "mail_thread_issue" USING btree ("issue_id");--> statement-breakpoint
-- The Gmail accounts assigned to projects become IMAP/SMTP accounts of the same
-- projects. They have no password yet, so the worker leaves them alone until the owner
-- enters an app password.
INSERT INTO "mail_account" ("team_id", "project_id", "name", "address", "imap_host", "smtp_host", "username")
SELECT p."team_id", m."project_id", p."name", lower(m."account"), 'imap.gmail.com', 'smtp.gmail.com', lower(m."account")
FROM "project_mail_account" m
JOIN "project" p ON p."id" = m."project_id"
ON CONFLICT ("team_id", "address") DO NOTHING;
--> statement-breakpoint
DROP TABLE "project_mail_account" CASCADE;
--> statement-breakpoint
-- Agents join a project on the team's default role; it lets them search and read the
-- project's mail and write drafts. Sending always goes through an approval.
UPDATE "team_role"
SET "permissions" = "permissions" || '{"mail": {"create": true, "edit": false, "read": true, "delete": false}}'::jsonb
WHERE "is_default";
--> statement-breakpoint
CREATE FUNCTION rev_mail() RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM bump_rev('mail:' || r.team_id, r.team_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mail_account_rev AFTER INSERT OR UPDATE OR DELETE ON mail_account
FOR EACH ROW EXECUTE FUNCTION rev_mail();
--> statement-breakpoint
CREATE TRIGGER mail_thread_rev AFTER INSERT OR UPDATE OR DELETE ON mail_thread
FOR EACH ROW EXECUTE FUNCTION rev_mail();
--> statement-breakpoint
CREATE TRIGGER mail_message_rev AFTER INSERT OR UPDATE OR DELETE ON mail_message
FOR EACH ROW EXECUTE FUNCTION rev_mail();
--> statement-breakpoint
CREATE TRIGGER mail_draft_rev AFTER INSERT OR UPDATE OR DELETE ON mail_draft
FOR EACH ROW EXECUTE FUNCTION rev_mail();
--> statement-breakpoint
CREATE TRIGGER mail_thread_issue_rev AFTER INSERT OR UPDATE OR DELETE ON mail_thread_issue
FOR EACH ROW EXECUTE FUNCTION rev_issue_child('issue_id', 'detail');
