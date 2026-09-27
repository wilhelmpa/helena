CREATE TABLE "helena_paper_order_intent" (
	"account_id" text NOT NULL,
	"client_order_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"project_id" integer,
	"credential_id" integer,
	"state" text DEFAULT 'uncertain' NOT NULL,
	"broker_order" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_paper_order_intent_account_id_client_order_id_pk" PRIMARY KEY("account_id","client_order_id"),
	CONSTRAINT "helena_paper_order_intent_state_check" CHECK ("helena_paper_order_intent"."state" IN ('uncertain', 'active', 'terminal'))
);
--> statement-breakpoint
ALTER TABLE "helena_paper_order_intent" ADD CONSTRAINT "helena_paper_order_intent_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_paper_order_intent" ADD CONSTRAINT "helena_paper_order_intent_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_paper_order_intent_account_state_idx" ON "helena_paper_order_intent" USING btree ("account_id","state");