ALTER TABLE "domains" DROP CONSTRAINT "domains_name_unique";--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN "budget_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_requirements" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handover_checklist_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_phases" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "client_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_unique" ON "domains" USING btree ("name") WHERE "domains"."archived_at" is null;--> statement-breakpoint
-- Les demandes déjà acceptées sur un projet ont déjà augmenté son budget ou son temps prévu.
UPDATE "change_requests" SET "budget_applied_at" = "updated_at" WHERE "project_id" IS NOT NULL AND (coalesce("estimated_minutes", 0) <> 0 OR coalesce("amount_cents", 0) <> 0) AND ("status" = 'accepted' OR "id"::text IN (SELECT "entity_id" FROM "audit_log" WHERE "action" = 'change_request.accepted'));
