ALTER TABLE "helena_schedule" ADD COLUMN "gate_mode" text DEFAULT 'shadow' NOT NULL;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD COLUMN "gate_source" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD COLUMN "gate_approved_by" text;--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_gate_mode_check" CHECK ("helena_schedule"."gate_mode" IN ('off', 'shadow', 'active'));--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_gate_source_check" CHECK ("helena_schedule"."gate_source" IN ('none', 'mail', 'audit'));--> statement-breakpoint
ALTER TABLE "helena_schedule" ADD CONSTRAINT "helena_schedule_gate_approved_by_user_id_fk" FOREIGN KEY ("gate_approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
