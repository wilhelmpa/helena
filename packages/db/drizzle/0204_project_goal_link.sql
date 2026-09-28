CREATE TABLE "helena_project_goal_link" (
	"initiative_id" integer PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helena_project_goal_link" ADD CONSTRAINT "helena_project_goal_link_initiative_id_initiative_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_project_goal_link" ADD CONSTRAINT "helena_project_goal_link_goal_id_organization_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."organization_goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_project_goal_link_goal_idx" ON "helena_project_goal_link" USING btree ("goal_id");