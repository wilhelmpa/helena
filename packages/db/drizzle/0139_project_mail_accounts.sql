CREATE TABLE "project_mail_account" (
	"project_id" integer PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_mail_account_provider_check" CHECK ("project_mail_account"."provider" IN ('gmail'))
);
--> statement-breakpoint
ALTER TABLE "project_mail_account" ADD CONSTRAINT "project_mail_account_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "project_mail_account" ("project_id", "account")
SELECT "id", CASE lower("name")
	WHEN 'privat' THEN 'wilhelmpa@gmail.com'
	WHEN 'familie' THEN 'patrick@emrani-wilhelm.de'
	WHEN 'volition.one' THEN 'patrick.wilhelm@volition.one'
END
FROM "project"
WHERE lower("name") IN ('privat', 'familie', 'volition.one')
ON CONFLICT ("project_id") DO NOTHING;
