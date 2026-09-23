CREATE TABLE "owner_terminal_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"event" text NOT NULL,
	"kind" text,
	"session_name" text,
	"device" text,
	"ip_address" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_terminal_audit_event_check" CHECK ("owner_terminal_audit"."event" IN ('step_up_ok', 'step_up_fail', 'rate_limited', 'grant_revoked', 'session_start', 'session_end', 'token_rejected'))
);
--> statement-breakpoint
CREATE TABLE "owner_terminal_grant" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"method" text NOT NULL,
	"device" text NOT NULL,
	"ip_address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_terminal_grant_method_check" CHECK ("owner_terminal_grant"."method" IN ('totp', 'passkey'))
);
--> statement-breakpoint
ALTER TABLE "owner_terminal_audit" ADD CONSTRAINT "owner_terminal_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_terminal_grant" ADD CONSTRAINT "owner_terminal_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_terminal_audit_user_idx" ON "owner_terminal_audit" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "owner_terminal_audit_event_idx" ON "owner_terminal_audit" USING btree ("user_id","event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_terminal_grant_session_uq" ON "owner_terminal_grant" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "owner_terminal_grant_user_idx" ON "owner_terminal_grant" USING btree ("user_id","created_at" DESC NULLS LAST);