ALTER TABLE "agent_mcp_server" ADD COLUMN "catalog_managed" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE TABLE "volition_catalog_source" (
  "id" serial PRIMARY KEY,
  "team_id" integer NOT NULL REFERENCES "team"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "locator" text NOT NULL,
  "role" text NOT NULL DEFAULT '',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "volition_catalog_source_kind_check" CHECK ("kind" IN ('github-skills', 'npm-mcp', 'pypi-mcp', 'github-mcp')),
  CONSTRAINT "volition_catalog_source_team_id_kind_locator_unique" UNIQUE("team_id", "kind", "locator")
);--> statement-breakpoint
CREATE TABLE "volition_catalog_item" (
  "id" serial PRIMARY KEY,
  "source_id" integer NOT NULL REFERENCES "volition_catalog_source"("id") ON DELETE cascade,
  "path" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "latest_revision_id" integer,
  CONSTRAINT "volition_catalog_item_source_id_path_unique" UNIQUE("source_id", "path")
);--> statement-breakpoint
CREATE INDEX "volition_catalog_item_name_idx" ON "volition_catalog_item"("name");--> statement-breakpoint
CREATE TABLE "volition_catalog_revision" (
  "id" serial PRIMARY KEY,
  "item_id" integer NOT NULL REFERENCES "volition_catalog_item"("id") ON DELETE cascade,
  "pin" text NOT NULL,
  "sha256" text NOT NULL,
  "license" text,
  "size" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "findings" jsonb NOT NULL,
  "approved" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "volition_catalog_revision_approved_check" CHECK ("approved" IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT "volition_catalog_revision_item_id_pin_unique" UNIQUE("item_id", "pin")
);--> statement-breakpoint
CREATE TABLE "volition_catalog_install" (
  "id" serial PRIMARY KEY,
  "item_id" integer NOT NULL REFERENCES "volition_catalog_item"("id") ON DELETE cascade,
  "team_id" integer NOT NULL REFERENCES "team"("id") ON DELETE cascade,
  "revision_id" integer NOT NULL REFERENCES "volition_catalog_revision"("id"),
  "previous_revision_id" integer REFERENCES "volition_catalog_revision"("id"),
  "skill_id" integer REFERENCES "agent_skill"("id") ON DELETE set null,
  "mcp_server_id" integer REFERENCES "agent_mcp_server"("id") ON DELETE set null,
  "scope" jsonb NOT NULL DEFAULT '{}',
  "installed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "volition_catalog_install_team_id_item_id_unique" UNIQUE("team_id", "item_id")
);--> statement-breakpoint
CREATE TABLE "volition_catalog_proposal" (
  "id" serial PRIMARY KEY,
  "team_id" integer NOT NULL REFERENCES "team"("id") ON DELETE cascade,
  "item_id" integer NOT NULL REFERENCES "volition_catalog_item"("id") ON DELETE cascade,
  "agent_id" integer REFERENCES "ai_agent"("id") ON DELETE set null,
  "proposed_by" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "reason" text NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "volition_catalog_proposal_state_check" CHECK ("state" IN ('pending', 'accepted', 'rejected'))
);--> statement-breakpoint
CREATE INDEX "volition_catalog_proposal_team_idx" ON "volition_catalog_proposal"("team_id", "state");
