CREATE TABLE "helena_decision" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer,
	"agent_id" integer,
	"run_id" integer,
	"chat_message_id" integer,
	"class_id" text NOT NULL,
	"subject" text,
	"question_id" text NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"choice" text,
	"probabilities" jsonb,
	"confidence" double precision,
	"threshold" double precision NOT NULL,
	"status" text NOT NULL,
	"credential_id" integer,
	"backend" text,
	"model" text,
	"latency_ms" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_eur" double precision,
	"error" text,
	"input_hash" text NOT NULL,
	"input_text" text,
	"outcome" text,
	"outcome_source" text,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_decision_kind_check" CHECK ("helena_decision"."kind" IN ('choice', 'yesno')),
	CONSTRAINT "helena_decision_status_check" CHECK ("helena_decision"."status" IN ('decided', 'unsure', 'off', 'no_backend', 'timeout', 'error')),
	CONSTRAINT "helena_decision_outcome_source_check" CHECK ("helena_decision"."outcome_source" IS NULL OR "helena_decision"."outcome_source" IN ('owner', 'caller'))
);
--> statement-breakpoint
CREATE TABLE "helena_decision_class_setting" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"class_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"credential_id" integer,
	"fallback_credential_id" integer,
	"threshold" double precision,
	"timeout_ms" integer,
	"store_input" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_decision_class_setting_threshold_check" CHECK ("helena_decision_class_setting"."threshold" IS NULL OR ("helena_decision_class_setting"."threshold" >= 0 AND "helena_decision_class_setting"."threshold" <= 1)),
	CONSTRAINT "helena_decision_class_setting_timeout_check" CHECK ("helena_decision_class_setting"."timeout_ms" IS NULL OR ("helena_decision_class_setting"."timeout_ms" >= 200 AND "helena_decision_class_setting"."timeout_ms" <= 30000))
);
--> statement-breakpoint
CREATE TABLE "helena_decision_eval" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"class_id" text NOT NULL,
	"credential_id" integer,
	"backend_label" text DEFAULT '' NOT NULL,
	"model" text,
	"threshold" double precision NOT NULL,
	"questions" integer DEFAULT 0 NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"correct_answered" integer DEFAULT 0 NOT NULL,
	"precision" double precision,
	"coverage" double precision,
	"accuracy" double precision,
	"passed" boolean DEFAULT false NOT NULL,
	"latency_p50_ms" integer,
	"latency_p95_ms" integer,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_eur" double precision,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_mail_classification" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"thread_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"status" text NOT NULL,
	"project_id" integer,
	"category" text,
	"priority" text,
	"needs_reply" boolean,
	"create_task" boolean,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issue_id" integer,
	"error" text,
	"corrected_by_user_id" text,
	"corrected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_mail_classification_status_check" CHECK ("helena_mail_classification"."status" IN ('classified', 'unsure', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "helena_model_route" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"project_id" integer,
	"run_id" integer,
	"chat_message_id" integer,
	"from_model" text NOT NULL,
	"to_model" text NOT NULL,
	"routed" boolean DEFAULT false NOT NULL,
	"tier" text,
	"confidence" double precision,
	"needs_context" double precision,
	"reason" text NOT NULL,
	"decision_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_model_router_setting" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"agent_id" integer,
	"project_id" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_upgrade" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_model_router_setting_scope_check" CHECK (("helena_model_router_setting"."agent_id" IS NULL) <> ("helena_model_router_setting"."project_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "helena_bank_account" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"iban" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helena_bank_import" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"bank_account_id" integer NOT NULL,
	"filename" text NOT NULL,
	"format" text NOT NULL,
	"sha256" text NOT NULL,
	"entries" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"from_date" date,
	"to_date" date,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_bank_import_format_check" CHECK ("helena_bank_import"."format" IN ('camt053', 'csv'))
);
--> statement-breakpoint
CREATE TABLE "helena_bank_transaction" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"bank_account_id" integer NOT NULL,
	"import_id" integer,
	"booking_date" date NOT NULL,
	"value_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"counterparty_name" text DEFAULT '' NOT NULL,
	"counterparty_iban" text,
	"purpose" text DEFAULT '' NOT NULL,
	"end_to_end_id" text,
	"mandate_id" text,
	"creditor_id" text,
	"bank_reference" text,
	"bank_code" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_bank_transaction_status_check" CHECK ("helena_bank_transaction"."status" IN ('open', 'matched', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "helena_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"source" text NOT NULL,
	"mail_attachment_id" integer,
	"vault_path" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"issuer" text,
	"invoice_number" text,
	"invoice_date" date,
	"due_date" date,
	"total_gross" numeric(14, 2),
	"currency" text DEFAULT 'EUR' NOT NULL,
	"iban" text,
	"vat_amount" numeric(14, 2),
	"direction" text DEFAULT 'incoming' NOT NULL,
	"extraction" text DEFAULT 'none' NOT NULL,
	"extraction_error" text,
	"text_excerpt" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_receipt_source_check" CHECK ("helena_receipt"."source" IN ('mail', 'upload', 'vault')),
	CONSTRAINT "helena_receipt_status_check" CHECK ("helena_receipt"."status" IN ('open', 'matched', 'ignored')),
	CONSTRAINT "helena_receipt_direction_check" CHECK ("helena_receipt"."direction" IN ('incoming', 'outgoing'))
);
--> statement-breakpoint
CREATE TABLE "helena_receipt_match" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"receipt_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"score" double precision,
	"confidence" double precision,
	"decision_id" bigint,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helena_receipt_match_status_check" CHECK ("helena_receipt_match"."status" IN ('proposed', 'confirmed', 'rejected')),
	CONSTRAINT "helena_receipt_match_method_check" CHECK ("helena_receipt_match"."method" IN ('rule', 'decision', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision" ADD CONSTRAINT "helena_decision_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_class_setting" ADD CONSTRAINT "helena_decision_class_setting_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_class_setting" ADD CONSTRAINT "helena_decision_class_setting_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_class_setting" ADD CONSTRAINT "helena_decision_class_setting_fallback_credential_id_integration_credential_id_fk" FOREIGN KEY ("fallback_credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_class_setting" ADD CONSTRAINT "helena_decision_class_setting_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_eval" ADD CONSTRAINT "helena_decision_eval_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_eval" ADD CONSTRAINT "helena_decision_eval_credential_id_integration_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."integration_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_decision_eval" ADD CONSTRAINT "helena_decision_eval_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_thread_id_mail_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."mail_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_message_id_mail_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_mail_classification" ADD CONSTRAINT "helena_mail_classification_corrected_by_user_id_user_id_fk" FOREIGN KEY ("corrected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_route" ADD CONSTRAINT "helena_model_route_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_route" ADD CONSTRAINT "helena_model_route_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_route" ADD CONSTRAINT "helena_model_route_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_route" ADD CONSTRAINT "helena_model_route_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_route" ADD CONSTRAINT "helena_model_route_chat_message_id_agent_chat_message_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."agent_chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_router_setting" ADD CONSTRAINT "helena_model_router_setting_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_router_setting" ADD CONSTRAINT "helena_model_router_setting_agent_id_ai_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_router_setting" ADD CONSTRAINT "helena_model_router_setting_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_model_router_setting" ADD CONSTRAINT "helena_model_router_setting_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_account" ADD CONSTRAINT "helena_bank_account_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_account" ADD CONSTRAINT "helena_bank_account_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_import" ADD CONSTRAINT "helena_bank_import_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_import" ADD CONSTRAINT "helena_bank_import_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_import" ADD CONSTRAINT "helena_bank_import_bank_account_id_helena_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."helena_bank_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_import" ADD CONSTRAINT "helena_bank_import_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_transaction" ADD CONSTRAINT "helena_bank_transaction_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_transaction" ADD CONSTRAINT "helena_bank_transaction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_transaction" ADD CONSTRAINT "helena_bank_transaction_bank_account_id_helena_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."helena_bank_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_bank_transaction" ADD CONSTRAINT "helena_bank_transaction_import_id_helena_bank_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."helena_bank_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt" ADD CONSTRAINT "helena_receipt_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt" ADD CONSTRAINT "helena_receipt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt" ADD CONSTRAINT "helena_receipt_mail_attachment_id_mail_attachment_id_fk" FOREIGN KEY ("mail_attachment_id") REFERENCES "public"."mail_attachment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt" ADD CONSTRAINT "helena_receipt_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_match" ADD CONSTRAINT "helena_receipt_match_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_match" ADD CONSTRAINT "helena_receipt_match_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_match" ADD CONSTRAINT "helena_receipt_match_receipt_id_helena_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."helena_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_match" ADD CONSTRAINT "helena_receipt_match_transaction_id_helena_bank_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."helena_bank_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helena_receipt_match" ADD CONSTRAINT "helena_receipt_match_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helena_decision_team_class_idx" ON "helena_decision" USING btree ("team_id","class_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "helena_decision_subject_idx" ON "helena_decision" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "helena_decision_run_idx" ON "helena_decision" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_decision_class_setting_team_class_idx" ON "helena_decision_class_setting" USING btree ("team_id","class_id");--> statement-breakpoint
CREATE INDEX "helena_decision_eval_team_class_idx" ON "helena_decision_eval" USING btree ("team_id","class_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_mail_classification_message_idx" ON "helena_mail_classification" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "helena_mail_classification_thread_idx" ON "helena_mail_classification" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "helena_mail_classification_team_idx" ON "helena_mail_classification" USING btree ("team_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_route_run_idx" ON "helena_model_route" USING btree ("run_id") WHERE "helena_model_route"."run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_route_chat_idx" ON "helena_model_route" USING btree ("chat_message_id") WHERE "helena_model_route"."chat_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "helena_model_route_agent_idx" ON "helena_model_route" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_router_setting_agent_idx" ON "helena_model_router_setting" USING btree ("agent_id") WHERE "helena_model_router_setting"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_model_router_setting_project_idx" ON "helena_model_router_setting" USING btree ("project_id") WHERE "helena_model_router_setting"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "helena_bank_account_iban_idx" ON "helena_bank_account" USING btree ("project_id","iban") WHERE "helena_bank_account"."iban" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "helena_bank_account_project_idx" ON "helena_bank_account" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "helena_bank_import_account_idx" ON "helena_bank_import" USING btree ("bank_account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_bank_transaction_dedupe_idx" ON "helena_bank_transaction" USING btree ("bank_account_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "helena_bank_transaction_project_date_idx" ON "helena_bank_transaction" USING btree ("project_id","booking_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_receipt_file_idx" ON "helena_receipt" USING btree ("project_id","sha256");--> statement-breakpoint
CREATE INDEX "helena_receipt_project_idx" ON "helena_receipt" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "helena_receipt_match_pair_idx" ON "helena_receipt_match" USING btree ("receipt_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helena_receipt_match_confirmed_idx" ON "helena_receipt_match" USING btree ("receipt_id") WHERE "helena_receipt_match"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "helena_receipt_match_project_idx" ON "helena_receipt_match" USING btree ("project_id","status");