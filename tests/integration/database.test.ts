import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "@/modules/audit/audit.service";
import { ROLES } from "@/server/auth/roles";
import { isUniqueViolation } from "@/server/db/errors";
import { auditLog, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestActor, createTestDatabase } from "../helpers/db";

let db: Database;
let client: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, client, close } = await createTestDatabase());
});
afterAll(async () => close());

/** Les tables de `docs/domain-model.md` §3, plus l'infrastructure. */
const EXPECTED_TABLES = [
  // Infrastructure
  "accounts",
  "audit_log",
  "sessions",
  "two_factors",
  "users",
  "verifications",
  // CRM
  "activities",
  "companies",
  "contacts",
  "crm_sync_state",
  "opportunities",
  "opportunity_stage_history",
  // Offres
  "catalog_items",
  "quote_lines",
  "quote_versions",
  "quotes",
  // Production
  "change_requests",
  "client_requirements",
  "deliverable_reviews",
  "deliverables",
  "handover_checklist_items",
  "project_blockers",
  "project_members",
  "project_phases",
  "projects",
  "task_dependencies",
  "tasks",
  // Temps et équipe
  "member_absences",
  "missions",
  "team_members",
  "time_entries",
  // Sites
  "deployments",
  "domains",
  "site_backups",
  "site_environments",
  "site_uptime_samples",
  "sites",
  // Contrats
  "contract_events",
  "contract_sites",
  "contracts",
  "maintenance_interventions",
  "maintenance_plans",
  // Support
  "ticket_events",
  "ticket_messages",
  "tickets",
  // Finances
  "direct_costs",
  "finance_imports",
  "financial_documents",
  "payment_schedule_items",
  // Documents
  "document_versions",
  "documents",
  "knowledge_article_versions",
  "knowledge_articles",
  "templates",
  // Échanges
  "appointments",
  "comments",
  "conversations",
  "messages",
  "reply_suggestions",
  // Portail
  "portal_memberships",
  "portal_preferences",
  // Automatisations et administration
  "app_settings",
  "automation_rules",
  "automation_runs",
  "domain_events",
  "email_outbox",
  "integration_connections",
  "notification_preferences",
  "notifications",
  "sequences",
  "sync_runs",
  "user_preferences",
  "webhook_receipts",
];

describe("migrations", () => {
  it("créent le schéma attendu", async () => {
    const result = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([...EXPECTED_TABLES].sort());
  });

  it("n'utilisent CASCADE que pour les préférences et les données du compte", async () => {
    const result = await client.query<{ table_name: string }>(
      `select conrelid::regclass::text as table_name
         from pg_constraint
        where contype = 'f' and confdeltype = 'c' and connamespace = 'public'::regnamespace
        order by 1`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "notification_preferences",
      "portal_preferences",
      "sessions",
      "two_factors",
      "user_preferences",
    ]);
  });

  it("protègent toute clé étrangère métier par RESTRICT", async () => {
    const result = await client.query<{ conname: string }>(
      `select conname
         from pg_constraint
        where contype = 'f' and confdeltype not in ('r', 'c')
          and connamespace = 'public'::regnamespace`,
    );
    // Seul le journal d'audit garde l'action après la disparition de son auteur.
    expect(result.rows.map((row) => row.conname)).toEqual(["audit_log_actor_id_users_id_fk"]);
  });

  it("indexent toutes les colonnes de clé étrangère", async () => {
    const result = await client.query<{ fk: string }>(
      `select c.conname as fk
         from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indpred is null
          )
        order by 1`,
    );
    // `projects_quote_id_unique` (partiel, `quote_id is not null`) sert aussi ce contrôle.
    expect(result.rows.map((row) => row.fk)).toEqual(["projects_quote_company_fk"]);
  });

  it("refusent un rôle inconnu (contrainte CHECK) et acceptent les cinq rôles", async () => {
    await expect(
      client.query(
        "insert into users (name, email, role) values ('X', 'x@test.local', 'superadmin')",
      ),
    ).rejects.toThrow(/users_role_check/);
    for (const role of ROLES) {
      await client.query("insert into users (name, email, role) values ('X', $1, $2)", [
        `role-${role}@test.local`,
        role,
      ]);
    }
  });

  it("donnent par défaut le rôle de lecture à un nouveau compte", async () => {
    const result = await client.query<{ role: string }>(
      "insert into users (name, email) values ('X', 'default@test.local') returning role",
    );
    expect(result.rows[0]?.role).toBe("viewer");
  });
});

describe("isUniqueViolation", () => {
  it("reconnaît une violation d'unicité remontée par Drizzle", async () => {
    await db.insert(users).values({ name: "A", email: "dup@test.local" });
    const error = await db
      .insert(users)
      .values({ name: "B", email: "dup@test.local" })
      .catch((caught: unknown) => caught);
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(error, "autre_contrainte")).toBe(false);
  });
});

describe("recordAudit", () => {
  it("journalise en masquant les données sensibles", async () => {
    const actor = await createTestActor(db, "admin");
    await recordAudit(db, {
      actorId: actor.userId,
      action: "user.created",
      entityType: "user",
      entityId: actor.userId,
      metadata: { role: "member", password: "ne-doit-pas-apparaitre" },
    });
    const [entry] = await db.select().from(auditLog);
    expect(entry?.action).toBe("user.created");
    expect(entry?.metadata).toEqual({ role: "member", password: "[REDACTED]" });
  });

  it("n'écrit rien si la transaction de l'opération est annulée", async () => {
    const before = (await db.select().from(auditLog)).length;
    await db
      .transaction(async (tx) => {
        await recordAudit(tx, { actorId: null, action: "user.created", entityType: "user" });
        throw new Error("échec de l'opération");
      })
      .catch(() => undefined);
    expect((await db.select().from(auditLog)).length).toBe(before);
  });
});
