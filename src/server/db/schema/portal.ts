import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { PORTAL_MEMBERSHIP_STATUSES } from "../../../lib/domain-enums";
import { companyFk, enumCheck, id, instant, timestamps } from "./_columns";
import { users } from "./auth";
import { companies, contacts } from "./crm";

/** Source unique du cloisonnement client : voir `resolvePortalContext`. */
export const portalMemberships = pgTable(
  "portal_memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    status: text("status", { enum: PORTAL_MEMBERSHIP_STATUSES }).notNull().default("invited"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "restrict" }),
    invitedAt: instant("invited_at").notNull().defaultNow(),
    lastSeenAt: instant("last_seen_at"),
    ...timestamps(),
  },
  (t) => [
    companyFk(
      "portal_memberships_contact_company_fk",
      [t.contactId, t.companyId],
      [contacts.id, contacts.companyId],
    ),
    // Un contact n'a qu'un accès actif ou en attente.
    uniqueIndex("portal_memberships_contact_unique")
      .on(t.contactId)
      .where(sql`${t.status} <> 'revoked'`),
    enumCheck("portal_memberships_status_check", t.status, PORTAL_MEMBERSHIP_STATUSES),
    index("portal_memberships_contact_id_idx").on(t.contactId),
    index("portal_memberships_company_status_idx").on(t.companyId, t.status),
    index("portal_memberships_invited_by_idx").on(t.invitedBy),
  ],
);

export const portalPreferences = pgTable("portal_preferences", {
  id: id(),
  // Préférence, sans valeur d'historique : suit le compte.
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  notifyMessage: boolean("notify_message").notNull().default(true),
  notifyValidation: boolean("notify_validation").notNull().default(true),
  notifyInvoice: boolean("notify_invoice").notNull().default(true),
  notifyRequirement: boolean("notify_requirement").notNull().default(true),
  notifyReport: boolean("notify_report").notNull().default(true),
  ...timestamps(),
});

export type PortalMembership = typeof portalMemberships.$inferSelect;
export type PortalPreferences = typeof portalPreferences.$inferSelect;
