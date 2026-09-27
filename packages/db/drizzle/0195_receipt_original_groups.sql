CREATE UNIQUE INDEX "helena_receipt_scope_idx" ON "helena_receipt" USING btree ("id","project_id","team_id");
--> statement-breakpoint
CREATE TABLE "helena_receipt_original_link" (
	"receipt_id" integer PRIMARY KEY NOT NULL,
	"primary_receipt_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_receipt_original_distinct" CHECK ("helena_receipt_original_link"."receipt_id" <> "helena_receipt_original_link"."primary_receipt_id")
);
--> statement-breakpoint
ALTER TABLE "helena_receipt_original_link" ADD CONSTRAINT "helena_receipt_original_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_original_link" ADD CONSTRAINT "helena_receipt_original_child_fk" FOREIGN KEY ("receipt_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_original_link" ADD CONSTRAINT "helena_receipt_original_primary_fk" FOREIGN KEY ("primary_receipt_id","project_id","team_id") REFERENCES "public"."helena_receipt"("id","project_id","team_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_receipt_original_primary_idx" ON "helena_receipt_original_link" USING btree ("primary_receipt_id");--> statement-breakpoint
