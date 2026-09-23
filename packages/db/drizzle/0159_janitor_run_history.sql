CREATE TABLE "janitor_run" (
	"job" text PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleaned" integer,
	"error" text
);
