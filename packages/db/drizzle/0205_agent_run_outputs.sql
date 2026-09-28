CREATE TABLE "agent_run_output" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "target" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_run_output_kind_check" CHECK ("agent_run_output"."kind" IN ('file', 'preview', 'pr', 'screenshot')),
  CONSTRAINT "agent_run_output_source_check" CHECK ("agent_run_output"."source" IN ('reported', 'inferred'))
);--> statement-breakpoint
ALTER TABLE "agent_run_output" ADD CONSTRAINT "agent_run_output_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_output_unique_idx" ON "agent_run_output" USING btree ("run_id","kind","target");
