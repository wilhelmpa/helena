CREATE TABLE "helena_receipt_pair_suggestion" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "project"("id") ON DELETE cascade,
  "team_id" integer NOT NULL REFERENCES "team"("id") ON DELETE cascade,
  "receipt_id" integer NOT NULL,
  "candidate_id" integer NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "helena_receipt_pair_suggestion_distinct" CHECK ("receipt_id" <> "candidate_id"),
  CONSTRAINT "helena_receipt_pair_suggestion_kind" CHECK ("kind" IN ('pair', 'duplicate')),
  CONSTRAINT "helena_receipt_pair_suggestion_status" CHECK ("status" IN ('pending', 'linked', 'ignored')),
  FOREIGN KEY ("receipt_id", "project_id", "team_id") REFERENCES "helena_receipt"("id", "project_id", "team_id") ON DELETE cascade,
  FOREIGN KEY ("candidate_id", "project_id", "team_id") REFERENCES "helena_receipt"("id", "project_id", "team_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "helena_receipt_pair_suggestion_pair_idx" ON "helena_receipt_pair_suggestion" ("receipt_id", "candidate_id");
--> statement-breakpoint
CREATE INDEX "helena_receipt_pair_suggestion_project_idx" ON "helena_receipt_pair_suggestion" ("project_id", "status");
--> statement-breakpoint
CREATE TABLE "helena_receipt_pair_history" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "project"("id") ON DELETE cascade,
  "team_id" integer NOT NULL REFERENCES "team"("id") ON DELETE cascade,
  "receipt_id" integer NOT NULL,
  "primary_receipt_id" integer NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('auto_link', 'unlink')),
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("receipt_id", "project_id", "team_id") REFERENCES "helena_receipt"("id", "project_id", "team_id") ON DELETE cascade,
  FOREIGN KEY ("primary_receipt_id", "project_id", "team_id") REFERENCES "helena_receipt"("id", "project_id", "team_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "helena_receipt_pair_history_project_idx" ON "helena_receipt_pair_history" ("project_id", "created_at" DESC);
