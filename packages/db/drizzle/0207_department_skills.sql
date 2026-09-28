CREATE TABLE "organization_department_skill" (
	"department_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	CONSTRAINT "organization_department_skill_department_id_skill_id_pk" PRIMARY KEY("department_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "organization_department" ADD COLUMN "skills_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_department_skill" ADD CONSTRAINT "organization_department_skill_department_id_organization_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."organization_department"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_department_skill" ADD CONSTRAINT "organization_department_skill_skill_id_agent_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."agent_skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_department_skill_skill_idx" ON "organization_department_skill" USING btree ("skill_id");