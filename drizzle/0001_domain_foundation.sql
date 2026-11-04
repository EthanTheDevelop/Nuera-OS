CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twenty_id" text,
	"kind" text NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"subject" text NOT NULL,
	"body" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_member_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_twenty_id_unique" UNIQUE("twenty_id"),
	CONSTRAINT "activities_kind_check" CHECK ("activities"."kind" in ('note', 'call', 'meeting', 'email', 'task'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twenty_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"address_line" text,
	"city" text,
	"postal_code" text,
	"country" text,
	"status" text DEFAULT 'prospect' NOT NULL,
	"activity" text,
	"siren" text,
	"phone" text,
	"source" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_member_id" uuid,
	"notes" text,
	"merged_into_id" uuid,
	"archived_at" timestamp with time zone,
	"twenty_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_twenty_id_unique" UNIQUE("twenty_id"),
	CONSTRAINT "companies_status_check" CHECK ("companies"."status" in ('prospect', 'client', 'subscriber', 'former', 'partner'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twenty_id" text NOT NULL,
	"company_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_title" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"twenty_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_twenty_id_unique" UNIQUE("twenty_id"),
	CONSTRAINT "contacts_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "contacts_roles_check" CHECK ("contacts"."roles" <@ array['decision', 'signatory', 'technical', 'billing']::text[])
);
--> statement-breakpoint
CREATE TABLE "crm_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object" text NOT NULL,
	"cursor" text,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_sync_state_object_unique" UNIQUE("object")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twenty_id" text NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"name" text NOT NULL,
	"stage" text DEFAULT 'NEW' NOT NULL,
	"amount_cents" integer,
	"expected_close_on" date,
	"probability" integer,
	"source" text,
	"need" text,
	"budget_estimate_cents" integer,
	"owner_member_id" uuid,
	"next_action" text,
	"next_action_on" date,
	"lost_reason" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"twenty_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_twenty_id_unique" UNIQUE("twenty_id"),
	CONSTRAINT "opportunities_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "opportunities_stage_check" CHECK ("opportunities"."stage" in ('NEW', 'QUALIFIED', 'QUOTE_SENT', 'NEGOTIATION', 'WON', 'LOST')),
	CONSTRAINT "opportunities_probability_check" CHECK ("opportunities"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_stage_history_from_check" CHECK ("opportunity_stage_history"."from_stage" in ('NEW', 'QUALIFIED', 'QUOTE_SENT', 'NEGOTIATION', 'WON', 'LOST')),
	CONSTRAINT "opportunity_stage_history_to_check" CHECK ("opportunity_stage_history"."to_stage" in ('NEW', 'QUALIFIED', 'QUOTE_SENT', 'NEGOTIATION', 'WON', 'LOST'))
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"activity" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"scope" text,
	"exclusions" text,
	"conditions" text,
	"validity_days" integer,
	"deposit_percent" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_kind_check" CHECK ("catalog_items"."kind" in ('project', 'recurring', 'option')),
	CONSTRAINT "catalog_items_activity_check" CHECK ("catalog_items"."activity" in ('vitrine', 'landing', 'ecommerce', 'sur_mesure', 'maintenance', 'hebergement', 'accompagnement', 'audit')),
	CONSTRAINT "catalog_items_deposit_check" CHECK ("catalog_items"."deposit_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"label" text NOT NULL,
	"unit_label" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_quantity_check" CHECK ("quote_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"scope" text,
	"exclusions" text,
	"conditions" text,
	"valid_until" date,
	"deposit_percent" integer,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"tax_percent" integer DEFAULT 20 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"estimated_minutes" integer DEFAULT 0 NOT NULL,
	"change_note" text,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_versions_quote_version_unique" UNIQUE("quote_id","version"),
	CONSTRAINT "quote_versions_id_quote_unique" UNIQUE("id","quote_id"),
	CONSTRAINT "quote_versions_deposit_check" CHECK ("quote_versions"."deposit_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"parent_quote_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"accepted_version_id" uuid,
	"issued_by_note" text,
	"indy_reference" text,
	"official_document_url" text,
	"docuseal_submission_id" text,
	"signature_status" text DEFAULT 'none' NOT NULL,
	"signed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"refused_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_number_unique" UNIQUE("number"),
	CONSTRAINT "quotes_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('draft', 'sent', 'negotiation', 'accepted', 'refused', 'expired')),
	CONSTRAINT "quotes_signature_status_check" CHECK ("quotes"."signature_status" in ('none', 'pending', 'signed', 'declined', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"ticket_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"estimated_minutes" integer,
	"amount_cents" integer,
	"quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('open', 'accepted', 'refused', 'converted'))
);
--> statement-breakpoint
CREATE TABLE "client_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"due_on" date,
	"received_at" timestamp with time zone,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_requirements_status_check" CHECK ("client_requirements"."status" in ('expected', 'received'))
);
--> statement-breakpoint
CREATE TABLE "deliverable_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"reviewer_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverable_reviews_decision_check" CHECK ("deliverable_reviews"."decision" in ('validated', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"document_id" uuid,
	"requires_client_validation" boolean DEFAULT false NOT NULL,
	"feedback_rounds_included" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverables_status_check" CHECK ("deliverables"."status" in ('draft', 'to_validate', 'validated', 'changes_requested'))
);
--> statement-breakpoint
CREATE TABLE "handover_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"done_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"consequence" text,
	"decision" text,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_member_unique" UNIQUE("project_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"due_on" date,
	"status" text DEFAULT 'todo' NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_phases_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "project_phases_status_check" CHECK ("project_phases"."status" in ('todo', 'in_progress', 'done'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"quote_id" uuid,
	"name" text NOT NULL,
	"activity" text,
	"objective" text,
	"scope" text,
	"status" text DEFAULT 'preparation' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"owner_member_id" uuid,
	"start_on" date,
	"due_on" date,
	"delivered_on" date,
	"budget_cents" integer,
	"estimated_minutes" integer,
	"client_step_label" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_number_unique" UNIQUE("number"),
	CONSTRAINT "projects_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "projects_activity_check" CHECK ("projects"."activity" in ('vitrine', 'landing', 'ecommerce', 'sur_mesure', 'maintenance', 'hebergement', 'accompagnement', 'audit')),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('preparation', 'active', 'blocked', 'in_validation', 'delivered', 'closed')),
	CONSTRAINT "projects_priority_check" CHECK ("projects"."priority" in ('low', 'normal', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_pair_unique" UNIQUE("task_id","depends_on_task_id"),
	CONSTRAINT "task_dependencies_not_self_check" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"phase_id" uuid,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_member_id" uuid,
	"due_on" date,
	"estimated_minutes" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_number_unique" UNIQUE("number"),
	CONSTRAINT "tasks_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('todo', 'in_progress', 'blocked', 'done')),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low', 'normal', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "member_absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_absences_dates_check" CHECK ("member_absences"."end_on" >= "member_absences"."start_on")
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"company_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"ticket_id" uuid,
	"title" text NOT NULL,
	"deliverable_label" text,
	"deliverable_received_on" date,
	"due_on" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"planned_cost_cents" integer,
	"committed_cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_company_required_check" CHECK (("missions"."project_id" is null and "missions"."ticket_id" is null) or "missions"."company_id" is not null),
	CONSTRAINT "missions_task_project_check" CHECK ("missions"."task_id" is null or "missions"."project_id" is not null),
	CONSTRAINT "missions_status_check" CHECK ("missions"."status" in ('planned', 'in_progress', 'delivered', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"title" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"weekly_capacity_minutes" integer DEFAULT 0 NOT NULL,
	"hourly_cost_cents" integer,
	"day_rate_cents" integer,
	"conditions" text,
	"specialty" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "team_members_kind_check" CHECK ("team_members"."kind" in ('partner', 'employee', 'contractor')),
	CONSTRAINT "team_members_status_check" CHECK ("team_members"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"company_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"ticket_id" uuid,
	"contract_id" uuid,
	"work_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"category" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"hourly_cost_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_minutes_check" CHECK ("time_entries"."minutes" > 0),
	CONSTRAINT "time_entries_attachment_check" CHECK ("time_entries"."category" in ('prospecting', 'admin') or "time_entries"."company_id" is not null),
	CONSTRAINT "time_entries_company_required_check" CHECK (("time_entries"."project_id" is null and "time_entries"."ticket_id" is null and "time_entries"."contract_id" is null) or "time_entries"."company_id" is not null),
	CONSTRAINT "time_entries_task_project_check" CHECK ("time_entries"."task_id" is null or "time_entries"."project_id" is not null),
	CONSTRAINT "time_entries_category_check" CHECK ("time_entries"."category" in ('production', 'corrections', 'support', 'prospecting', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"commit_sha" text,
	"commit_message" text,
	"triggered_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_seconds" integer,
	"source" text DEFAULT 'coolify' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "deployments_status_check" CHECK ("deployments"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "deployments_source_check" CHECK ("deployments"."source" in ('coolify', 'nuera'))
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"registrar" text,
	"expires_on" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"tls_status" text DEFAULT 'unknown' NOT NULL,
	"tls_expires_on" date,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_name_unique" UNIQUE("name"),
	CONSTRAINT "domains_tls_status_check" CHECK ("domains"."tls_status" in ('valid', 'expiring', 'expired', 'error', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "site_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"environment_id" uuid,
	"external_id" text,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"taken_at" timestamp with time zone,
	"size_bytes" bigint,
	"off_site" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_backups_status_check" CHECK ("site_backups"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "site_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"coolify_app_uuid" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"status_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_environments_site_kind_unique" UNIQUE("site_id","kind"),
	CONSTRAINT "site_environments_id_site_unique" UNIQUE("id","site_id"),
	CONSTRAINT "site_environments_kind_check" CHECK ("site_environments"."kind" in ('development', 'staging', 'production')),
	CONSTRAINT "site_environments_status_check" CHECK ("site_environments"."status" in ('running', 'stopped', 'error', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "site_uptime_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"day" date NOT NULL,
	"uptime_ratio" double precision,
	"avg_response_ms" integer,
	"server_errors" integer,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_uptime_samples_site_day_unique" UNIQUE("site_id","day")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"contract_id" uuid,
	"name" text NOT NULL,
	"primary_domain" text,
	"kind" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"technology" text,
	"cms_kind" text,
	"cms_admin_url" text,
	"repo_url" text,
	"repo_branch" text,
	"hosting_label" text,
	"hosted_by_nuera" boolean DEFAULT true NOT NULL,
	"server_label" text,
	"owner_member_id" uuid,
	"live_on" date,
	"coolify_project_uuid" text,
	"monitor_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "sites_kind_check" CHECK ("sites"."kind" in ('vitrine', 'landing', 'ecommerce', 'sur_mesure')),
	CONSTRAINT "sites_status_check" CHECK ("sites"."status" in ('planned', 'staging', 'live', 'paused', 'archived')),
	CONSTRAINT "sites_cms_kind_check" CHECK ("sites"."cms_kind" in ('payload', 'wordpress', 'other', 'none'))
);
--> statement-breakpoint
CREATE TABLE "contract_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_price_cents" integer,
	"to_price_cents" integer,
	"note" text,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_events_kind_check" CHECK ("contract_events"."kind" in ('created', 'price_change', 'renewed', 'suspended', 'terminated', 'note'))
);
--> statement-breakpoint
CREATE TABLE "contract_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_sites_contract_site_unique" UNIQUE("contract_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid,
	"quote_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'to_start' NOT NULL,
	"start_on" date,
	"end_on" date,
	"renews_on" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"monthly_cost_cents" integer,
	"included_minutes" integer,
	"included_tickets" integer,
	"scope" text,
	"exclusions" text,
	"conditions" text,
	"response_hours" integer,
	"resolution_hours" integer,
	"signature_status" text DEFAULT 'none' NOT NULL,
	"docuseal_submission_id" text,
	"terminated_at" timestamp with time zone,
	"termination_note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_number_unique" UNIQUE("number"),
	CONSTRAINT "contracts_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "contracts_kind_check" CHECK ("contracts"."kind" in ('hosting', 'maintenance', 'support', 'accompaniment')),
	CONSTRAINT "contracts_status_check" CHECK ("contracts"."status" in ('to_start', 'active', 'to_review', 'suspended', 'terminated', 'expired')),
	CONSTRAINT "contracts_period_check" CHECK ("contracts"."period" in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "contracts_signature_status_check" CHECK ("contracts"."signature_status" in ('none', 'pending', 'signed', 'declined', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"site_id" uuid,
	"ticket_id" uuid,
	"title" text NOT NULL,
	"planned_on" date,
	"done_on" date,
	"result" text,
	"minutes" integer,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"included_minutes" integer,
	"included_tickets" integer,
	"scope" text,
	"exclusions" text,
	"response_hours" integer,
	"resolution_hours" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plans_period_check" CHECK ("maintenance_plans"."period" in ('monthly', 'quarterly', 'yearly'))
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_from_status_check" CHECK ("ticket_events"."from_status" in ('received', 'qualified', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "ticket_events_to_status_check" CHECK ("ticket_events"."to_status" in ('received', 'qualified', 'in_progress', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"contract_id" uuid,
	"project_id" uuid,
	"subject" text NOT NULL,
	"description" text,
	"channel" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"assignee_member_id" uuid,
	"due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"coverage" text DEFAULT 'undetermined' NOT NULL,
	"is_incident" boolean DEFAULT false NOT NULL,
	"opened_by_user_id" uuid,
	"change_request_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "tickets_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "tickets_channel_check" CHECK ("tickets"."channel" in ('portal', 'email', 'phone', 'internal', 'monitoring')),
	CONSTRAINT "tickets_category_check" CHECK ("tickets"."category" in ('incident', 'bug', 'assistance', 'question', 'change')),
	CONSTRAINT "tickets_severity_check" CHECK ("tickets"."severity" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" in ('received', 'qualified', 'in_progress', 'resolved', 'closed')),
	CONSTRAINT "tickets_coverage_check" CHECK ("tickets"."coverage" in ('undetermined', 'covered', 'not_covered', 'overage'))
);
--> statement-breakpoint
CREATE TABLE "direct_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"project_id" uuid,
	"site_id" uuid,
	"contract_id" uuid,
	"member_id" uuid,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"incurred_on" date NOT NULL,
	"recurring_period" text,
	"nature" text DEFAULT 'actual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "direct_costs_company_required_check" CHECK (("direct_costs"."project_id" is null and "direct_costs"."site_id" is null and "direct_costs"."contract_id" is null) or "direct_costs"."company_id" is not null),
	CONSTRAINT "direct_costs_category_check" CHECK ("direct_costs"."category" in ('subcontracting', 'hosting', 'license', 'purchase', 'other')),
	CONSTRAINT "direct_costs_recurring_period_check" CHECK ("direct_costs"."recurring_period" in ('monthly', 'quarterly', 'yearly')),
	CONSTRAINT "direct_costs_nature_check" CHECK ("direct_costs"."nature" in ('forecast', 'actual'))
);
--> statement-breakpoint
CREATE TABLE "finance_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"filename" text,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_imports_source_check" CHECK ("finance_imports"."source" in ('indy_csv', 'manual', 'indy_api'))
);
--> statement-breakpoint
CREATE TABLE "financial_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"contract_id" uuid,
	"quote_id" uuid,
	"schedule_item_id" uuid,
	"kind" text DEFAULT 'invoice' NOT NULL,
	"source" text NOT NULL,
	"external_ref" text,
	"issuer_member_id" uuid,
	"issued_on" date,
	"due_on" date,
	"amount_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"paid_on" date,
	"document_id" uuid,
	"client_visible" boolean DEFAULT false NOT NULL,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_documents_source_ref_unique" UNIQUE("source","external_ref"),
	CONSTRAINT "financial_documents_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "financial_documents_kind_check" CHECK ("financial_documents"."kind" in ('invoice', 'credit_note')),
	CONSTRAINT "financial_documents_source_check" CHECK ("financial_documents"."source" in ('indy_csv', 'manual', 'indy_api')),
	CONSTRAINT "financial_documents_status_check" CHECK ("financial_documents"."status" in ('issued', 'overdue', 'paid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "payment_schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"quote_id" uuid,
	"contract_id" uuid,
	"label" text NOT NULL,
	"due_on" date,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"financial_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_schedule_items_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "payment_schedule_items_status_check" CHECK ("payment_schedule_items"."status" in ('planned', 'invoiced', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_versions_document_version_unique" UNIQUE("document_id","version"),
	CONSTRAINT "document_versions_id_document_unique" UNIQUE("id","document_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"project_id" uuid,
	"contract_id" uuid,
	"site_id" uuid,
	"ticket_id" uuid,
	"quote_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'final' NOT NULL,
	"current_version_id" uuid,
	"uploaded_by_client" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_id_company_unique" UNIQUE("id","company_id"),
	CONSTRAINT "documents_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "documents_company_required_check" CHECK (("documents"."project_id" is null and "documents"."contract_id" is null and "documents"."site_id" is null and "documents"."ticket_id" is null and "documents"."quote_id" is null) or "documents"."company_id" is not null),
	CONSTRAINT "documents_client_visibility_check" CHECK ("documents"."visibility" <> 'client' or "documents"."company_id" is not null),
	CONSTRAINT "documents_kind_check" CHECK ("documents"."kind" in ('quote', 'contract', 'invoice', 'mockup', 'brief', 'minutes', 'deliverable', 'client_file', 'other')),
	CONSTRAINT "documents_visibility_check" CHECK ("documents"."visibility" in ('internal', 'client')),
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('draft', 'to_validate', 'validated', 'signed', 'final'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_article_versions_article_version_unique" UNIQUE("article_id","version")
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"site_id" uuid,
	"project_id" uuid,
	"author_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_articles_kind_check" CHECK ("knowledge_articles"."kind" in ('internal', 'technical', 'faq'))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"activity" text,
	"name" text NOT NULL,
	"body" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_kind_check" CHECK ("templates"."kind" in ('brief', 'checklist', 'message', 'project_plan')),
	CONSTRAINT "templates_activity_check" CHECK ("templates"."activity" in ('vitrine', 'landing', 'ecommerce', 'sur_mesure', 'maintenance', 'hebergement', 'accompagnement', 'audit'))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"project_id" uuid,
	"opportunity_id" uuid,
	"title" text NOT NULL,
	"kind" text,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"channel" text,
	"location" text,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "appointments_source_check" CHECK ("appointments"."source" in ('manual', 'cal')),
	CONSTRAINT "appointments_company_required_check" CHECK ("appointments"."project_id" is null or "appointments"."company_id" is not null),
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('planned', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"document_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_entity_type_check" CHECK ("comments"."entity_type" in ('task', 'project', 'ticket', 'deliverable'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"contact_id" uuid,
	"subject" text,
	"last_message_at" timestamp with time zone,
	"unread_internal" integer DEFAULT 0 NOT NULL,
	"unread_client" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_company_unique" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_contact_id" uuid,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"document_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_conversation_unique" UNIQUE("id","conversation_id"),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('inbound', 'outbound', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "reply_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"body" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"tone" text,
	"context_summary" text,
	"requested_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_suggestions_status_check" CHECK ("reply_suggestions"."status" in ('ready', 'used', 'dismissed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "portal_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_memberships_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "portal_memberships_status_check" CHECK ("portal_memberships"."status" in ('invited', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "portal_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notify_message" boolean DEFAULT true NOT NULL,
	"notify_validation" boolean DEFAULT true NOT NULL,
	"notify_invoice" boolean DEFAULT true NOT NULL,
	"notify_requirement" boolean DEFAULT true NOT NULL,
	"notify_report" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"trigger_label" text,
	"action_label" text,
	"tool_label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" text NOT NULL,
	"event_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_rule_event_unique" UNIQUE("rule_key","event_id"),
	CONSTRAINT "automation_runs_status_check" CHECK ("automation_runs"."status" in ('running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"company_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"dedupe_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"html" text,
	"text" text,
	"template" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_check" CHECK ("email_outbox"."status" in ('pending', 'sent', 'failed', 'not_configured'))
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_service_unique" UNIQUE("service"),
	CONSTRAINT "integration_connections_service_check" CHECK ("integration_connections"."service" in ('twenty', 'coolify', 'indy', 'payload', 'docuseal', 'n8n', 'uptime_kuma', 'openai', 'smtp', 'cal')),
	CONSTRAINT "integration_connections_status_check" CHECK ("integration_connections"."status" in ('connected', 'degraded', 'unavailable', 'not_configured', 'to_verify'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_kind_unique" UNIQUE("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" text,
	"href" text,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_dedupe_unique" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "notifications_severity_check" CHECK ("notifications"."severity" in ('info', 'warning', 'danger'))
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"scope" text NOT NULL,
	"year" integer NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_pkey" PRIMARY KEY("scope","year")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"scope" text,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_runs_service_check" CHECK ("sync_runs"."service" in ('twenty', 'coolify', 'indy', 'payload', 'docuseal', 'n8n', 'uptime_kuma', 'openai', 'smtp', 'cal')),
	CONSTRAINT "sync_runs_status_check" CHECK ("sync_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"theme" text DEFAULT 'light' NOT NULL,
	"accent" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"home_path" text,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"dashboard_layout" jsonb,
	"daily_digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_preferences_theme_check" CHECK ("user_preferences"."theme" in ('light', 'dark', 'system')),
	CONSTRAINT "user_preferences_density_check" CHECK ("user_preferences"."density" in ('comfortable', 'compact'))
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"external_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_receipts_service_external_unique" UNIQUE("service","external_id"),
	CONSTRAINT "webhook_receipts_service_check" CHECK ("webhook_receipts"."service" in ('twenty', 'coolify', 'indy', 'payload', 'docuseal', 'n8n', 'uptime_kuma', 'openai', 'smtp', 'cal')),
	CONSTRAINT "webhook_receipts_status_check" CHECK ("webhook_receipts"."status" in ('received', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'viewer';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_member_id_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_company_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_company_fk" FOREIGN KEY ("opportunity_id","company_id") REFERENCES "public"."opportunities"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_member_id_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_merged_into_id_companies_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_member_id_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_company_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "public"."quote_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_company_fk" FOREIGN KEY ("opportunity_id","company_id") REFERENCES "public"."opportunities"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_parent_company_fk" FOREIGN KEY ("parent_quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."quote_versions"("id","quote_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_version_fk" FOREIGN KEY ("accepted_version_id","id") REFERENCES "public"."quote_versions"("id","quote_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_ticket_company_fk" FOREIGN KEY ("ticket_id","company_id") REFERENCES "public"."tickets"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_requirements" ADD CONSTRAINT "client_requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_requirements" ADD CONSTRAINT "client_requirements_document_project_fk" FOREIGN KEY ("document_id","project_id") REFERENCES "public"."documents"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_phase_project_fk" FOREIGN KEY ("phase_id","project_id") REFERENCES "public"."project_phases"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_document_project_fk" FOREIGN KEY ("document_id","project_id") REFERENCES "public"."documents"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_checklist_items" ADD CONSTRAINT "handover_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_blockers" ADD CONSTRAINT "project_blockers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_member_id_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_company_fk" FOREIGN KEY ("opportunity_id","company_id") REFERENCES "public"."opportunities"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_member_id_team_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_phase_project_fk" FOREIGN KEY ("phase_id","project_id") REFERENCES "public"."project_phases"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_project_fk" FOREIGN KEY ("parent_task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_ticket_company_fk" FOREIGN KEY ("ticket_id","company_id") REFERENCES "public"."tickets"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticket_company_fk" FOREIGN KEY ("ticket_id","company_id") REFERENCES "public"."tickets"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_site_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."site_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_backups" ADD CONSTRAINT "site_backups_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_backups" ADD CONSTRAINT "site_backups_environment_site_fk" FOREIGN KEY ("environment_id","site_id") REFERENCES "public"."site_environments"("id","site_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_environments" ADD CONSTRAINT "site_environments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_uptime_samples" ADD CONSTRAINT "site_uptime_samples_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_owner_member_id_team_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sites" ADD CONSTRAINT "contract_sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sites" ADD CONSTRAINT "contract_sites_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_sites" ADD CONSTRAINT "contract_sites_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_interventions" ADD CONSTRAINT "maintenance_interventions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_interventions" ADD CONSTRAINT "maintenance_interventions_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_interventions" ADD CONSTRAINT "maintenance_interventions_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_interventions" ADD CONSTRAINT "maintenance_interventions_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_interventions" ADD CONSTRAINT "maintenance_interventions_ticket_company_fk" FOREIGN KEY ("ticket_id","company_id") REFERENCES "public"."tickets"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_member_id_team_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_change_request_company_fk" FOREIGN KEY ("change_request_id","company_id") REFERENCES "public"."change_requests"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_imports" ADD CONSTRAINT "finance_imports_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_issuer_member_id_team_members_id_fk" FOREIGN KEY ("issuer_member_id") REFERENCES "public"."team_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_schedule_company_fk" FOREIGN KEY ("schedule_item_id","company_id") REFERENCES "public"."payment_schedule_items"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_document_company_fk" FOREIGN KEY ("document_id","company_id") REFERENCES "public"."documents"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_document_company_fk" FOREIGN KEY ("financial_document_id","company_id") REFERENCES "public"."financial_documents"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contract_company_fk" FOREIGN KEY ("contract_id","company_id") REFERENCES "public"."contracts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_site_company_fk" FOREIGN KEY ("site_id","company_id") REFERENCES "public"."sites"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_ticket_company_fk" FOREIGN KEY ("ticket_id","company_id") REFERENCES "public"."tickets"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_quote_company_fk" FOREIGN KEY ("quote_id","company_id") REFERENCES "public"."quotes"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."document_versions"("id","document_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_article_versions_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_article_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_company_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_opportunity_company_fk" FOREIGN KEY ("opportunity_id","company_id") REFERENCES "public"."opportunities"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_company_fk" FOREIGN KEY ("document_id","company_id") REFERENCES "public"."documents"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."projects"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_company_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_company_fk" FOREIGN KEY ("conversation_id","company_id") REFERENCES "public"."conversations"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_contact_company_fk" FOREIGN KEY ("author_contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_document_company_fk" FOREIGN KEY ("document_id","company_id") REFERENCES "public"."documents"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_suggestions" ADD CONSTRAINT "reply_suggestions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_suggestions" ADD CONSTRAINT "reply_suggestions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_suggestions" ADD CONSTRAINT "reply_suggestions_message_conversation_fk" FOREIGN KEY ("message_id","conversation_id") REFERENCES "public"."messages"("id","conversation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_contact_company_fk" FOREIGN KEY ("contact_id","company_id") REFERENCES "public"."contacts"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_preferences" ADD CONSTRAINT "portal_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_key_automation_rules_key_fk" FOREIGN KEY ("rule_key") REFERENCES "public"."automation_rules"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "activities_company_occurred_idx" ON "activities" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_contact_id_idx" ON "activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "activities_opportunity_id_idx" ON "activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "activities_owner_member_id_idx" ON "activities" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "activities_kind_idx" ON "activities" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "activities_due_at_idx" ON "activities" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_siren_unique" ON "companies" USING btree ("siren") WHERE "companies"."siren" is not null and "companies"."merged_into_id" is null;--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "companies_owner_member_id_idx" ON "companies" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "companies_merged_into_id_idx" ON "companies" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "companies_archived_at_idx" ON "companies" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "companies_source_idx" ON "companies" USING btree ("source");--> statement-breakpoint
CREATE INDEX "companies_domain_lower_idx" ON "companies" USING btree (lower("domain"));--> statement-breakpoint
CREATE INDEX "companies_tags_idx" ON "companies" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "companies_name_search_idx" ON "companies" USING gin (to_tsvector('simple', "name"));--> statement-breakpoint
CREATE INDEX "contacts_company_id_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_email_lower_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "contacts_archived_at_idx" ON "contacts" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "contacts_roles_idx" ON "contacts" USING gin ("roles");--> statement-breakpoint
CREATE INDEX "contacts_name_search_idx" ON "contacts" USING gin (to_tsvector('simple', "first_name" || ' ' || "last_name" || ' ' || coalesce("email", '')));--> statement-breakpoint
CREATE INDEX "opportunities_company_id_idx" ON "opportunities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "opportunities_contact_id_idx" ON "opportunities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "opportunities_owner_member_id_idx" ON "opportunities" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "opportunities_source_idx" ON "opportunities" USING btree ("source");--> statement-breakpoint
CREATE INDEX "opportunities_next_action_on_idx" ON "opportunities" USING btree ("next_action_on");--> statement-breakpoint
CREATE INDEX "opportunities_expected_close_on_idx" ON "opportunities" USING btree ("expected_close_on");--> statement-breakpoint
CREATE INDEX "opportunities_last_activity_at_idx" ON "opportunities" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "opportunities_archived_at_idx" ON "opportunities" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "opportunity_stage_history_opportunity_idx" ON "opportunity_stage_history" USING btree ("opportunity_id","at");--> statement-breakpoint
CREATE INDEX "opportunity_stage_history_actor_id_idx" ON "opportunity_stage_history" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "catalog_items_kind_idx" ON "catalog_items" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "catalog_items_activity_idx" ON "catalog_items" USING btree ("activity");--> statement-breakpoint
CREATE INDEX "catalog_items_active_idx" ON "catalog_items" USING btree ("active");--> statement-breakpoint
CREATE INDEX "quote_lines_version_position_idx" ON "quote_lines" USING btree ("quote_version_id","position");--> statement-breakpoint
CREATE INDEX "quote_lines_catalog_item_id_idx" ON "quote_lines" USING btree ("catalog_item_id");--> statement-breakpoint
CREATE INDEX "quote_versions_created_by_idx" ON "quote_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "quotes_company_id_idx" ON "quotes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "quotes_opportunity_id_idx" ON "quotes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "quotes_parent_quote_id_idx" ON "quotes" USING btree ("parent_quote_id");--> statement-breakpoint
CREATE INDEX "quotes_current_version_id_idx" ON "quotes" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "quotes_accepted_version_id_idx" ON "quotes" USING btree ("accepted_version_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotes_signature_status_idx" ON "quotes" USING btree ("signature_status");--> statement-breakpoint
CREATE INDEX "quotes_sent_at_idx" ON "quotes" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "quotes_docuseal_submission_id_idx" ON "quotes" USING btree ("docuseal_submission_id");--> statement-breakpoint
CREATE INDEX "quotes_archived_at_idx" ON "quotes" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "change_requests_company_id_idx" ON "change_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "change_requests_project_id_idx" ON "change_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "change_requests_ticket_id_idx" ON "change_requests" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "change_requests_quote_id_idx" ON "change_requests" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "change_requests_status_idx" ON "change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_requirements_project_status_idx" ON "client_requirements" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "client_requirements_due_on_idx" ON "client_requirements" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "client_requirements_document_id_idx" ON "client_requirements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "deliverable_reviews_deliverable_idx" ON "deliverable_reviews" USING btree ("deliverable_id","at");--> statement-breakpoint
CREATE INDEX "deliverable_reviews_reviewer_user_id_idx" ON "deliverable_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "deliverables_project_status_idx" ON "deliverables" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "deliverables_phase_id_idx" ON "deliverables" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "deliverables_document_id_idx" ON "deliverables" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "handover_checklist_items_project_idx" ON "handover_checklist_items" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_blockers_project_resolved_idx" ON "project_blockers" USING btree ("project_id","resolved_at");--> statement-breakpoint
CREATE INDEX "project_members_member_id_idx" ON "project_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "project_phases_project_position_idx" ON "project_phases" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_phases_due_on_idx" ON "project_phases" USING btree ("due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_quote_id_unique" ON "projects" USING btree ("quote_id") WHERE "projects"."quote_id" is not null;--> statement-breakpoint
CREATE INDEX "projects_company_id_idx" ON "projects" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "projects_opportunity_id_idx" ON "projects" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "projects_owner_member_id_idx" ON "projects" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_due_on_idx" ON "projects" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "projects_archived_at_idx" ON "projects" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "projects_name_search_idx" ON "projects" USING gin (to_tsvector('simple', "name"));--> statement-breakpoint
CREATE INDEX "task_dependencies_depends_on_task_id_idx" ON "task_dependencies" USING btree ("depends_on_task_id");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_phase_id_idx" ON "tasks" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_member_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_on_idx" ON "tasks" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "tasks_archived_at_idx" ON "tasks" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "member_absences_member_start_idx" ON "member_absences" USING btree ("member_id","start_on");--> statement-breakpoint
CREATE INDEX "missions_member_status_idx" ON "missions" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "missions_company_id_idx" ON "missions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "missions_project_id_idx" ON "missions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "missions_task_id_idx" ON "missions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "missions_ticket_id_idx" ON "missions" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "missions_due_on_idx" ON "missions" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "team_members_kind_idx" ON "team_members" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "team_members_status_idx" ON "team_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_members_archived_at_idx" ON "team_members" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "team_members_skills_idx" ON "team_members" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "time_entries_member_work_on_idx" ON "time_entries" USING btree ("member_id","work_on");--> statement-breakpoint
CREATE INDEX "time_entries_company_work_on_idx" ON "time_entries" USING btree ("company_id","work_on");--> statement-breakpoint
CREATE INDEX "time_entries_project_work_on_idx" ON "time_entries" USING btree ("project_id","work_on");--> statement-breakpoint
CREATE INDEX "time_entries_task_id_idx" ON "time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_ticket_id_idx" ON "time_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "time_entries_contract_work_on_idx" ON "time_entries" USING btree ("contract_id","work_on");--> statement-breakpoint
CREATE INDEX "time_entries_work_on_idx" ON "time_entries" USING btree ("work_on");--> statement-breakpoint
CREATE INDEX "time_entries_category_idx" ON "time_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "time_entries_created_by_idx" ON "time_entries" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "deployments_environment_started_idx" ON "deployments" USING btree ("environment_id","started_at");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_triggered_by_user_id_idx" ON "deployments" USING btree ("triggered_by_user_id");--> statement-breakpoint
CREATE INDEX "domains_company_id_idx" ON "domains" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "domains_site_id_idx" ON "domains" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "domains_expires_on_idx" ON "domains" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "domains_tls_expires_on_idx" ON "domains" USING btree ("tls_expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "site_backups_site_external_unique" ON "site_backups" USING btree ("site_id","external_id") WHERE "site_backups"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "site_backups_site_taken_idx" ON "site_backups" USING btree ("site_id","taken_at");--> statement-breakpoint
CREATE INDEX "site_backups_environment_id_idx" ON "site_backups" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "site_backups_status_idx" ON "site_backups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "site_environments_coolify_app_uuid_idx" ON "site_environments" USING btree ("coolify_app_uuid");--> statement-breakpoint
CREATE INDEX "site_environments_status_idx" ON "site_environments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "site_uptime_samples_day_idx" ON "site_uptime_samples" USING btree ("day");--> statement-breakpoint
CREATE INDEX "sites_company_id_idx" ON "sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sites_project_id_idx" ON "sites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sites_contract_id_idx" ON "sites" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "sites_owner_member_id_idx" ON "sites" USING btree ("owner_member_id");--> statement-breakpoint
CREATE INDEX "sites_status_idx" ON "sites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sites_primary_domain_idx" ON "sites" USING btree ("primary_domain");--> statement-breakpoint
CREATE INDEX "sites_monitor_id_idx" ON "sites" USING btree ("monitor_id");--> statement-breakpoint
CREATE INDEX "sites_archived_at_idx" ON "sites" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "sites_name_search_idx" ON "sites" USING gin (to_tsvector('simple', "name" || ' ' || coalesce("primary_domain", '')));--> statement-breakpoint
CREATE INDEX "contract_events_contract_at_idx" ON "contract_events" USING btree ("contract_id","at");--> statement-breakpoint
CREATE INDEX "contract_events_actor_id_idx" ON "contract_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "contract_sites_site_id_idx" ON "contract_sites" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "contract_sites_company_id_idx" ON "contract_sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contracts_company_id_idx" ON "contracts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contracts_plan_id_idx" ON "contracts" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "contracts_quote_id_idx" ON "contracts" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_kind_idx" ON "contracts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "contracts_renews_on_idx" ON "contracts" USING btree ("renews_on");--> statement-breakpoint
CREATE INDEX "contracts_end_on_idx" ON "contracts" USING btree ("end_on");--> statement-breakpoint
CREATE INDEX "contracts_docuseal_submission_id_idx" ON "contracts" USING btree ("docuseal_submission_id");--> statement-breakpoint
CREATE INDEX "contracts_archived_at_idx" ON "contracts" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_company_id_idx" ON "maintenance_interventions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_contract_id_idx" ON "maintenance_interventions" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_site_id_idx" ON "maintenance_interventions" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_ticket_id_idx" ON "maintenance_interventions" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_member_id_idx" ON "maintenance_interventions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_planned_on_idx" ON "maintenance_interventions" USING btree ("planned_on");--> statement-breakpoint
CREATE INDEX "maintenance_interventions_done_on_idx" ON "maintenance_interventions" USING btree ("done_on");--> statement-breakpoint
CREATE INDEX "maintenance_plans_active_idx" ON "maintenance_plans" USING btree ("active");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_at_idx" ON "ticket_events" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE INDEX "ticket_events_actor_id_idx" ON "ticket_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_at_idx" ON "ticket_messages" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE INDEX "ticket_messages_author_user_id_idx" ON "ticket_messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_open_incident_unique" ON "tickets" USING btree ("site_id") WHERE "tickets"."is_incident" and "tickets"."site_id" is not null and "tickets"."status" not in ('resolved', 'closed') and "tickets"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tickets_company_status_idx" ON "tickets" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "tickets_site_id_idx" ON "tickets" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "tickets_contract_id_idx" ON "tickets" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "tickets_project_id_idx" ON "tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tickets_assignee_status_idx" ON "tickets" USING btree ("assignee_member_id","status");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_severity_idx" ON "tickets" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "tickets_due_at_idx" ON "tickets" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "tickets_change_request_id_idx" ON "tickets" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "tickets_opened_by_user_id_idx" ON "tickets" USING btree ("opened_by_user_id");--> statement-breakpoint
CREATE INDEX "tickets_archived_at_idx" ON "tickets" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "tickets_subject_search_idx" ON "tickets" USING gin (to_tsvector('simple', "subject"));--> statement-breakpoint
CREATE INDEX "direct_costs_company_id_idx" ON "direct_costs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "direct_costs_project_id_idx" ON "direct_costs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "direct_costs_site_id_idx" ON "direct_costs" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "direct_costs_contract_id_idx" ON "direct_costs" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "direct_costs_member_id_idx" ON "direct_costs" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "direct_costs_incurred_on_idx" ON "direct_costs" USING btree ("incurred_on");--> statement-breakpoint
CREATE INDEX "direct_costs_nature_idx" ON "direct_costs" USING btree ("nature");--> statement-breakpoint
CREATE INDEX "finance_imports_at_idx" ON "finance_imports" USING btree ("at");--> statement-breakpoint
CREATE INDEX "finance_imports_actor_id_idx" ON "finance_imports" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "financial_documents_company_id_idx" ON "financial_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "financial_documents_project_id_idx" ON "financial_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "financial_documents_contract_id_idx" ON "financial_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "financial_documents_quote_id_idx" ON "financial_documents" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "financial_documents_schedule_item_id_idx" ON "financial_documents" USING btree ("schedule_item_id");--> statement-breakpoint
CREATE INDEX "financial_documents_issuer_member_id_idx" ON "financial_documents" USING btree ("issuer_member_id");--> statement-breakpoint
CREATE INDEX "financial_documents_document_id_idx" ON "financial_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "financial_documents_status_due_idx" ON "financial_documents" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "financial_documents_issued_on_idx" ON "financial_documents" USING btree ("issued_on");--> statement-breakpoint
CREATE INDEX "financial_documents_paid_on_idx" ON "financial_documents" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_company_id_idx" ON "payment_schedule_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_project_id_idx" ON "payment_schedule_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_quote_id_idx" ON "payment_schedule_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_contract_id_idx" ON "payment_schedule_items" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_document_id_idx" ON "payment_schedule_items" USING btree ("financial_document_id");--> statement-breakpoint
CREATE INDEX "payment_schedule_items_status_due_idx" ON "payment_schedule_items" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "document_versions_uploaded_by_user_id_idx" ON "document_versions" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "document_versions_sha256_idx" ON "document_versions" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "documents_company_visibility_idx" ON "documents" USING btree ("company_id","visibility");--> statement-breakpoint
CREATE INDEX "documents_current_version_id_idx" ON "documents" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX "documents_project_id_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "documents_contract_id_idx" ON "documents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "documents_site_id_idx" ON "documents" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "documents_ticket_id_idx" ON "documents" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "documents_quote_id_idx" ON "documents" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "documents_kind_idx" ON "documents" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "documents_archived_at_idx" ON "documents" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "documents_title_search_idx" ON "documents" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE INDEX "knowledge_article_versions_author_user_id_idx" ON "knowledge_article_versions" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_articles_kind_idx" ON "knowledge_articles" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "knowledge_articles_site_id_idx" ON "knowledge_articles" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "knowledge_articles_project_id_idx" ON "knowledge_articles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "knowledge_articles_author_user_id_idx" ON "knowledge_articles" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "knowledge_articles_archived_at_idx" ON "knowledge_articles" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "knowledge_articles_title_search_idx" ON "knowledge_articles" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE INDEX "templates_kind_activity_idx" ON "templates" USING btree ("kind","activity");--> statement-breakpoint
CREATE INDEX "templates_active_idx" ON "templates" USING btree ("active");--> statement-breakpoint
CREATE INDEX "appointments_company_id_idx" ON "appointments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "appointments_contact_id_idx" ON "appointments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "appointments_project_id_idx" ON "appointments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "appointments_opportunity_id_idx" ON "appointments" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "appointments_starts_at_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "appointments_member_ids_idx" ON "appointments" USING gin ("member_ids");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "comments_company_id_idx" ON "comments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "comments_parent_id_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "comments_author_user_id_idx" ON "comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "comments_document_id_idx" ON "comments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "comments_mentions_idx" ON "comments" USING gin ("mentions");--> statement-breakpoint
CREATE INDEX "conversations_company_last_message_idx" ON "conversations" USING btree ("company_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_project_id_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversations_contact_id_idx" ON "conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_archived_at_idx" ON "conversations" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_at_idx" ON "messages" USING btree ("conversation_id","at");--> statement-breakpoint
CREATE INDEX "messages_company_id_idx" ON "messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "messages_author_user_id_idx" ON "messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "messages_author_contact_id_idx" ON "messages" USING btree ("author_contact_id");--> statement-breakpoint
CREATE INDEX "messages_document_id_idx" ON "messages" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "messages_mentions_idx" ON "messages" USING gin ("mentions");--> statement-breakpoint
CREATE INDEX "reply_suggestions_conversation_status_idx" ON "reply_suggestions" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "reply_suggestions_message_id_idx" ON "reply_suggestions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reply_suggestions_requested_by_idx" ON "reply_suggestions" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_memberships_contact_unique" ON "portal_memberships" USING btree ("contact_id") WHERE "portal_memberships"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "portal_memberships_contact_id_idx" ON "portal_memberships" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "portal_memberships_company_status_idx" ON "portal_memberships" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "portal_memberships_invited_by_idx" ON "portal_memberships" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "app_settings_updated_by_idx" ON "app_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "automation_runs_event_id_idx" ON "automation_runs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_started_at_idx" ON "automation_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("occurred_at") WHERE "domain_events"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_entity_idx" ON "domain_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "domain_events_company_id_idx" ON "domain_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "domain_events_actor_id_idx" ON "domain_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key_unique" ON "email_outbox" USING btree ("dedupe_key") WHERE "email_outbox"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "email_outbox_status_created_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_to_address_idx" ON "email_outbox" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sync_runs_service_started_idx" ON "sync_runs" USING btree ("service","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_receipts_received_at_idx" ON "webhook_receipts" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'member', 'contractor', 'viewer', 'client'));