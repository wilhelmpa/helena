CREATE TABLE "project_action_run_step" (
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_action_run_step_run_id_node_id_pk" PRIMARY KEY("run_id","node_id"),
	CONSTRAINT "project_action_run_step_type_check" CHECK ("project_action_run_step"."node_type" IN ('trigger', 'condition', 'action')),
	CONSTRAINT "project_action_run_step_status_check" CHECK ("project_action_run_step"."status" IN ('pending', 'running', 'succeeded', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "project_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"created_by" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_template_team_kind_name_uq" UNIQUE("team_id","kind","name"),
	CONSTRAINT "project_template_kind_check" CHECK ("project_template"."kind" IN ('project', 'board'))
);
--> statement-breakpoint
CREATE TABLE "organization_agent_assignment" (
	"team_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"department_id" integer,
	"reports_to_agent_id" integer,
	"role_title" text DEFAULT '' NOT NULL,
	"openclaw_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_agent_assignment_team_id_agent_id_pk" PRIMARY KEY("team_id","agent_id"),
	CONSTRAINT "organization_agent_not_self_manager_check" CHECK ("organization_agent_assignment"."reports_to_agent_id" IS NULL OR "organization_agent_assignment"."reports_to_agent_id" <> "organization_agent_assignment"."agent_id")
);
--> statement-breakpoint
CREATE TABLE "organization_department" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_department_not_self_parent_check" CHECK ("organization_department"."parent_id" IS NULL OR "organization_department"."parent_id" <> "organization_department"."id")
);
--> statement-breakpoint
CREATE TABLE "organization_goal" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"department_id" integer,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"target_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_goal_status_check" CHECK ("organization_goal"."status" IN ('planned', 'active', 'achieved', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "organization_project_assignment" (
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"department_id" integer,
	"instructions" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_project_assignment_team_id_project_id_pk" PRIMARY KEY("team_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "project_action" ADD COLUMN "workflow" jsonb;--> statement-breakpoint
ALTER TABLE "project_action_run" ADD COLUMN "workflow" jsonb;--> statement-breakpoint
ALTER TABLE "project_action_run_step" ADD CONSTRAINT "project_action_run_step_run_id_project_action_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."project_action_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_template" ADD CONSTRAINT "project_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD CONSTRAINT "organization_agent_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD CONSTRAINT "organization_agent_assignment_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD CONSTRAINT "organization_agent_assignment_department_id_organization_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."organization_department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_agent_assignment" ADD CONSTRAINT "organization_agent_assignment_reports_to_agent_id_ai_agent_id_fk" FOREIGN KEY ("reports_to_agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_department" ADD CONSTRAINT "organization_department_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_department" ADD CONSTRAINT "organization_department_parent_id_organization_department_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organization_department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_goal" ADD CONSTRAINT "organization_goal_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_goal" ADD CONSTRAINT "organization_goal_department_id_organization_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."organization_department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_goal" ADD CONSTRAINT "organization_goal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_project_assignment" ADD CONSTRAINT "organization_project_assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_project_assignment" ADD CONSTRAINT "organization_project_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_project_assignment" ADD CONSTRAINT "organization_project_assignment_department_id_organization_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."organization_department"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_action_run_step_run_idx" ON "project_action_run_step" USING btree ("run_id","updated_at");--> statement-breakpoint
CREATE INDEX "project_template_team_idx" ON "project_template" USING btree ("team_id","kind","name");--> statement-breakpoint
CREATE INDEX "organization_agent_department_idx" ON "organization_agent_assignment" USING btree ("team_id","department_id");--> statement-breakpoint
CREATE INDEX "organization_agent_manager_idx" ON "organization_agent_assignment" USING btree ("team_id","reports_to_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_department_team_name_uq" ON "organization_department" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "organization_department_team_parent_idx" ON "organization_department" USING btree ("team_id","parent_id");--> statement-breakpoint
CREATE INDEX "organization_goal_team_idx" ON "organization_goal" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "organization_goal_department_idx" ON "organization_goal" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "organization_goal_project_idx" ON "organization_goal" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "organization_project_department_idx" ON "organization_project_assignment" USING btree ("team_id","department_id");