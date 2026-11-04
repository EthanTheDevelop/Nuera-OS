import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  AUTOMATION_RUN_STATUSES,
  DENSITIES,
  EMAIL_STATUSES,
  INTEGRATION_SERVICES,
  INTEGRATION_STATUSES,
  NOTIFICATION_SEVERITIES,
  SYNC_RUN_STATUSES,
  THEMES,
  WEBHOOK_RECEIPT_STATUSES,
} from "../../../lib/domain-enums";
import { enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { companies } from "./crm";

/** Compteurs des numéros lisibles (`D-2026-014`) : voir `src/modules/platform/sequences.ts`. */
export const sequences = pgTable(
  "sequences",
  {
    scope: text("scope").notNull(),
    year: integer("year").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ name: "sequences_pkey", columns: [t.scope, t.year] })],
);

/** Boîte d'envoi transactionnelle : voir `src/modules/platform/events.ts`. */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: id(),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id, {
      onDelete: "restrict",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    dedupeKey: text("dedupe_key").unique(),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    dispatchedAt: instant("dispatched_at"),
    ...timestamps(),
  },
  (t) => [
    index("domain_events_pending_idx")
      .on(t.occurredAt)
      .where(sql`${t.dispatchedAt} is null`),
    index("domain_events_type_idx").on(t.type, t.occurredAt),
    index("domain_events_entity_idx").on(t.entityType, t.entityId),
    index("domain_events_company_id_idx").on(t.companyId),
    index("domain_events_actor_id_idx").on(t.actorId),
  ],
);

/** Règles définies en code, activées en base. */
export const automationRules = pgTable("automation_rules", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  triggerLabel: text("trigger_label"),
  actionLabel: text("action_label"),
  toolLabel: text("tool_label"),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
});

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    ruleKey: text("rule_key")
      .notNull()
      .references((): AnyPgColumn => automationRules.key, { onDelete: "restrict" }),
    eventId: uuid("event_id").references((): AnyPgColumn => domainEvents.id, {
      onDelete: "restrict",
    }),
    status: text("status", { enum: AUTOMATION_RUN_STATUSES }).notNull().default("running"),
    attempts: integer("attempts").notNull().default(1),
    error: text("error"),
    startedAt: instant("started_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    // Idempotence : une règle ne traite un événement qu'une fois.
    unique("automation_runs_rule_event_unique").on(t.ruleKey, t.eventId),
    enumCheck("automation_runs_status_check", t.status, AUTOMATION_RUN_STATUSES),
    index("automation_runs_event_id_idx").on(t.eventId),
    index("automation_runs_status_idx").on(t.status),
    index("automation_runs_started_at_idx").on(t.startedAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: NOTIFICATION_SEVERITIES }).notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    href: text("href"),
    dedupeKey: text("dedupe_key"),
    readAt: instant("read_at"),
    emailedAt: instant("emailed_at"),
    ...timestamps(),
  },
  (t) => [
    unique("notifications_user_dedupe_unique").on(t.userId, t.dedupeKey),
    enumCheck("notifications_severity_check", t.severity, NOTIFICATION_SEVERITIES),
    index("notifications_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    // Préférence, sans valeur d'historique : suit le compte.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("notification_preferences_user_kind_unique").on(t.userId, t.kind)],
);

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: id(),
    // Préférence, sans valeur d'historique : suit le compte.
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    theme: text("theme", { enum: THEMES }).notNull().default("light"),
    accent: text("accent"),
    locale: text("locale").notNull().default("fr"),
    homePath: text("home_path"),
    density: text("density", { enum: DENSITIES }).notNull().default("comfortable"),
    dashboardLayout: jsonb("dashboard_layout").$type<unknown>(),
    dailyDigest: boolean("daily_digest").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    enumCheck("user_preferences_theme_check", t.theme, THEMES),
    enumCheck("user_preferences_density_check", t.density, DENSITIES),
  ],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    service: text("service", { enum: INTEGRATION_SERVICES }).notNull().unique(),
    status: text("status", { enum: INTEGRATION_STATUSES }).notNull().default("not_configured"),
    lastCheckAt: instant("last_check_at"),
    lastSuccessAt: instant("last_success_at"),
    lastError: text("last_error"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    enumCheck("integration_connections_service_check", t.service, INTEGRATION_SERVICES),
    enumCheck("integration_connections_status_check", t.status, INTEGRATION_STATUSES),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    service: text("service", { enum: INTEGRATION_SERVICES }).notNull(),
    scope: text("scope"),
    status: text("status", { enum: SYNC_RUN_STATUSES }).notNull().default("running"),
    startedAt: instant("started_at").notNull().defaultNow(),
    finishedAt: instant("finished_at"),
    items: integer("items").notNull().default(0),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    enumCheck("sync_runs_service_check", t.service, INTEGRATION_SERVICES),
    enumCheck("sync_runs_status_check", t.status, SYNC_RUN_STATUSES),
    index("sync_runs_service_started_idx").on(t.service, t.startedAt),
    index("sync_runs_status_idx").on(t.status),
  ],
);

export const webhookReceipts = pgTable(
  "webhook_receipts",
  {
    id: id(),
    service: text("service", { enum: INTEGRATION_SERVICES }).notNull(),
    externalId: text("external_id").notNull(),
    receivedAt: instant("received_at").notNull().defaultNow(),
    status: text("status", { enum: WEBHOOK_RECEIPT_STATUSES }).notNull().default("received"),
    ...timestamps(),
  },
  (t) => [
    unique("webhook_receipts_service_external_unique").on(t.service, t.externalId),
    enumCheck("webhook_receipts_service_check", t.service, INTEGRATION_SERVICES),
    enumCheck("webhook_receipts_status_check", t.status, WEBHOOK_RECEIPT_STATUSES),
    index("webhook_receipts_received_at_idx").on(t.receivedAt),
  ],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text"),
    template: text("template"),
    status: text("status", { enum: EMAIL_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: instant("sent_at"),
    dedupeKey: text("dedupe_key"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("email_outbox_dedupe_key_unique")
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    enumCheck("email_outbox_status_check", t.status, EMAIL_STATUSES),
    index("email_outbox_status_created_idx").on(t.status, t.createdAt),
    index("email_outbox_to_address_idx").on(t.toAddress),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: id(),
    key: text("key").notNull().unique(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [index("app_settings_updated_by_idx").on(t.updatedBy)],
);

export type Sequence = typeof sequences.$inferSelect;
export type DomainEventRow = typeof domainEvents.$inferSelect;
export type AutomationRule = typeof automationRules.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type WebhookReceipt = typeof webhookReceipts.$inferSelect;
export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
