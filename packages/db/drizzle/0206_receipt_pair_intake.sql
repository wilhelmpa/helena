CREATE TABLE "helena_receipt_pair_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"primary_receipt_id" integer NOT NULL,
	"action" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_receipt_pair_history_action" CHECK ("helena_receipt_pair_history"."action" IN ('auto_link', 'unlink'))
);
--> statement-breakpoint
CREATE TABLE "helena_receipt_pair_suggestion" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_receipt_pair_suggestion_distinct" CHECK ("helena_receipt_pair_suggestion"."receipt_id" <> "helena_receipt_pair_suggestion"."candidate_id"),
	CONSTRAINT "helena_receipt_pair_suggestion_kind" CHECK ("helena_receipt_pair_suggestion"."kind" IN ('pair', 'duplicate')),
	CONSTRAINT "helena_receipt_pair_suggestion_status" CHECK ("helena_receipt_pair_suggestion"."status" IN ('pending', 'linked', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_receipt_id_helena_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."helena_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_primary_receipt_id_helena_receipt_id_fk" FOREIGN KEY ("primary_receipt_id") REFERENCES "public"."helena_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_receipt_id_project_id_team_id_helena_receipt_id_project_id_team_id_fk" FOREIGN KEY ("receipt_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_history" ADD CONSTRAINT "helena_receipt_pair_history_primary_receipt_id_project_id_team_id_helena_receipt_id_project_id_team_id_fk" FOREIGN KEY ("primary_receipt_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_receipt_id_helena_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."helena_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_candidate_id_helena_receipt_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."helena_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_receipt_id_project_id_team_id_helena_receipt_id_project_id_team_id_fk" FOREIGN KEY ("receipt_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_pair_suggestion" ADD CONSTRAINT "helena_receipt_pair_suggestion_candidate_id_project_id_team_id_helena_receipt_id_project_id_team_id_fk" FOREIGN KEY ("candidate_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_receipt_pair_history_project_idx" ON "helena_receipt_pair_history" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_receipt_pair_suggestion_pair_idx" ON "helena_receipt_pair_suggestion" USING btree ("receipt_id","candidate_id");--> statement-breakpoint
CREATE INDEX "helena_receipt_pair_suggestion_project_idx" ON "helena_receipt_pair_suggestion" USING btree ("project_id","status");