ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_schedule_id_agent_schedule_id_fk";--> statement-breakpoint
DROP INDEX "agent_run_schedule_fire_uq";--> statement-breakpoint
DROP INDEX "agent_run_schedule_idx";--> statement-breakpoint
ALTER TABLE "agent_run" DROP COLUMN "schedule_id";--> statement-breakpoint
ALTER TABLE "agent_run" DROP COLUMN "scheduled_for";--> statement-breakpoint
DROP TABLE "agent_schedule";
