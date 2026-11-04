import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  BACKUP_STATUSES,
  CMS_KINDS,
  DEPLOYMENT_SOURCES,
  DEPLOYMENT_STATUSES,
  ENVIRONMENT_KINDS,
  ENVIRONMENT_STATUSES,
  SITE_KINDS,
  SITE_STATUSES,
  TLS_STATUSES,
} from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { contracts } from "./contracts";
import { companies } from "./crm";
import { projects } from "./projects";
import { teamMembers } from "./team";

export const sites = pgTable(
  "sites",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    contractId: uuid("contract_id"),
    name: text("name").notNull(),
    primaryDomain: text("primary_domain"),
    kind: text("kind", { enum: SITE_KINDS }),
    status: text("status", { enum: SITE_STATUSES }).notNull().default("planned"),
    technology: text("technology"),
    cmsKind: text("cms_kind", { enum: CMS_KINDS }),
    cmsAdminUrl: text("cms_admin_url"),
    repoUrl: text("repo_url"),
    /** Branche déployée, affichée avec le dépôt (écran 19). */
    repoBranch: text("repo_branch"),
    hostingLabel: text("hosting_label"),
    /** Filtre « Hébergés par nous » (écran 10), impossible à fiabiliser sur un libellé libre. */
    hostedByNuera: boolean("hosted_by_nuera").notNull().default(true),
    serverLabel: text("server_label"),
    ownerMemberId: uuid("owner_member_id").references((): AnyPgColumn => teamMembers.id, {
      onDelete: "restrict",
    }),
    liveOn: date("live_on"),
    coolifyProjectUuid: text("coolify_project_uuid"),
    monitorId: text("monitor_id"),
    archivedAt: instant("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("sites_id_company_unique").on(t.id, t.companyId),
    companyFk(
      "sites_project_company_fk",
      [t.projectId, t.companyId],
      [projects.id, projects.companyId],
    ),
    companyFk(
      "sites_contract_company_fk",
      [t.contractId, t.companyId],
      [contracts.id, contracts.companyId],
    ),
    enumCheck("sites_kind_check", t.kind, SITE_KINDS),
    enumCheck("sites_status_check", t.status, SITE_STATUSES),
    enumCheck("sites_cms_kind_check", t.cmsKind, CMS_KINDS),
    index("sites_company_id_idx").on(t.companyId),
    index("sites_project_id_idx").on(t.projectId),
    index("sites_contract_id_idx").on(t.contractId),
    index("sites_owner_member_id_idx").on(t.ownerMemberId),
    index("sites_status_idx").on(t.status),
    index("sites_primary_domain_idx").on(t.primaryDomain),
    index("sites_monitor_id_idx").on(t.monitorId),
    index("sites_archived_at_idx").on(t.archivedAt),
    index("sites_name_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.name} || ' ' || coalesce(${t.primaryDomain}, ''))`,
    ),
  ],
);

export const siteEnvironments = pgTable(
  "site_environments",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references((): AnyPgColumn => sites.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ENVIRONMENT_KINDS }).notNull(),
    url: text("url"),
    coolifyAppUuid: text("coolify_app_uuid"),
    status: text("status", { enum: ENVIRONMENT_STATUSES }).notNull().default("unknown"),
    statusCheckedAt: instant("status_checked_at"),
    ...timestamps(),
  },
  (t) => [
    unique("site_environments_site_kind_unique").on(t.siteId, t.kind),
    unique("site_environments_id_site_unique").on(t.id, t.siteId),
    enumCheck("site_environments_kind_check", t.kind, ENVIRONMENT_KINDS),
    enumCheck("site_environments_status_check", t.status, ENVIRONMENT_STATUSES),
    index("site_environments_coolify_app_uuid_idx").on(t.coolifyAppUuid),
    index("site_environments_status_idx").on(t.status),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: id(),
    environmentId: uuid("environment_id")
      .notNull()
      .references((): AnyPgColumn => siteEnvironments.id, { onDelete: "restrict" }),
    externalId: text("external_id").unique(),
    status: text("status", { enum: DEPLOYMENT_STATUSES }).notNull().default("queued"),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    /** NULL = déclenché automatiquement. */
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    durationSeconds: integer("duration_seconds"),
    source: text("source", { enum: DEPLOYMENT_SOURCES }).notNull().default("coolify"),
    ...timestamps(),
  },
  (t) => [
    enumCheck("deployments_status_check", t.status, DEPLOYMENT_STATUSES),
    enumCheck("deployments_source_check", t.source, DEPLOYMENT_SOURCES),
    index("deployments_environment_started_idx").on(t.environmentId, t.startedAt),
    index("deployments_status_idx").on(t.status),
    index("deployments_triggered_by_user_id_idx").on(t.triggeredByUserId),
  ],
);

export const domains = pgTable(
  "domains",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    siteId: uuid("site_id"),
    name: text("name").notNull().unique(),
    registrar: text("registrar"),
    expiresOn: date("expires_on"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    tlsStatus: text("tls_status", { enum: TLS_STATUSES }).notNull().default("unknown"),
    tlsExpiresOn: date("tls_expires_on"),
    checkedAt: instant("checked_at"),
    ...timestamps(),
  },
  (t) => [
    companyFk("domains_site_company_fk", [t.siteId, t.companyId], [sites.id, sites.companyId]),
    enumCheck("domains_tls_status_check", t.tlsStatus, TLS_STATUSES),
    index("domains_company_id_idx").on(t.companyId),
    index("domains_site_id_idx").on(t.siteId),
    index("domains_expires_on_idx").on(t.expiresOn),
    index("domains_tls_expires_on_idx").on(t.tlsExpiresOn),
  ],
);

export const siteUptimeSamples = pgTable(
  "site_uptime_samples",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references((): AnyPgColumn => sites.id, { onDelete: "restrict" }),
    day: date("day").notNull(),
    /** Entre 0 et 1. */
    uptimeRatio: doublePrecision("uptime_ratio"),
    avgResponseMs: integer("avg_response_ms"),
    /** Mesure « Erreurs serveur » de la fenêtre Santé du site (M3). */
    serverErrors: integer("server_errors"),
    checkedAt: instant("checked_at"),
    ...timestamps(),
  },
  (t) => [
    unique("site_uptime_samples_site_day_unique").on(t.siteId, t.day),
    index("site_uptime_samples_day_idx").on(t.day),
  ],
);

export const siteBackups = pgTable(
  "site_backups",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references((): AnyPgColumn => sites.id, { onDelete: "restrict" }),
    environmentId: uuid("environment_id"),
    externalId: text("external_id"),
    status: text("status", { enum: BACKUP_STATUSES }).notNull().default("succeeded"),
    takenAt: instant("taken_at"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    offSite: boolean("off_site").notNull().default(false),
    source: text("source"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "site_backups_environment_site_fk",
      [t.environmentId, t.siteId],
      [siteEnvironments.id, siteEnvironments.siteId],
    ),
    // Une sauvegarde relue depuis Coolify n'est enregistrée qu'une fois.
    uniqueIndex("site_backups_site_external_unique")
      .on(t.siteId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    enumCheck("site_backups_status_check", t.status, BACKUP_STATUSES),
    index("site_backups_site_taken_idx").on(t.siteId, t.takenAt),
    index("site_backups_environment_id_idx").on(t.environmentId),
    index("site_backups_status_idx").on(t.status),
  ],
);

export type Site = typeof sites.$inferSelect;
export type SiteEnvironment = typeof siteEnvironments.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type SiteUptimeSample = typeof siteUptimeSamples.$inferSelect;
export type SiteBackup = typeof siteBackups.$inferSelect;
