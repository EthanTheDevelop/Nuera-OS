import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  portalMemberships,
  portalPreferences,
  users,
  verifications,
  type PortalMembership,
  type PortalPreferences,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/** Tables du portail. Aucune règle ni contrôle d'accès ici : les services en répondent. */

export async function findMembership(db: Database, id: string): Promise<PortalMembership | null> {
  const [row] = await db
    .select()
    .from(portalMemberships)
    .where(eq(portalMemberships.id, id))
    .limit(1);
  return row ?? null;
}

export async function findMembershipOfUser(
  db: Database,
  userId: string,
): Promise<PortalMembership | null> {
  const [row] = await db
    .select()
    .from(portalMemberships)
    .where(eq(portalMemberships.userId, userId))
    .limit(1);
  return row ?? null;
}

/** L'accès actif ou en attente d'un contact : il n'y en a qu'un, l'index unique y veille. */
export async function findLiveMembershipOfContact(
  db: Database,
  contactId: string,
): Promise<PortalMembership | null> {
  const [row] = await db
    .select()
    .from(portalMemberships)
    .where(and(eq(portalMemberships.contactId, contactId), ne(portalMemberships.status, "revoked")))
    .limit(1);
  return row ?? null;
}

export async function listMembershipsOfCompany(
  db: Database,
  companyId: string,
): Promise<PortalMembership[]> {
  return db
    .select()
    .from(portalMemberships)
    .where(eq(portalMemberships.companyId, companyId))
    .orderBy(desc(portalMemberships.invitedAt));
}

export async function insertMembership(
  tx: Database,
  values: typeof portalMemberships.$inferInsert,
): Promise<PortalMembership> {
  const [row] = await tx.insert(portalMemberships).values(values).returning();
  if (!row) throw new Error("Adhésion non créée");
  return row;
}

export async function updateMembership(
  tx: Database,
  id: string,
  values: Partial<typeof portalMemberships.$inferInsert>,
): Promise<PortalMembership> {
  const [row] = await tx
    .update(portalMemberships)
    .set(values)
    .where(eq(portalMemberships.id, id))
    .returning();
  if (!row) throw new Error("Adhésion introuvable");
  return row;
}

export async function revokeMembership(tx: Database, id: string): Promise<boolean> {
  const rows = await tx
    .update(portalMemberships)
    .set({ status: "revoked" })
    .where(and(eq(portalMemberships.id, id), ne(portalMemberships.status, "revoked")))
    .returning({ id: portalMemberships.id });
  return rows.length > 0;
}

/** Adresse du compte d'une adhésion : celle qu'un lien de connexion ouvre vraiment. */
export async function findAccountEmail(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

/**
 * Efface les liens de connexion encore valables d'une adresse. Le jeton est haché : seule la valeur
 * JSON porte l'adresse, sous la forme écrite par better-auth.
 */
export async function deleteLoginLinks(tx: Database, email: string): Promise<void> {
  const needle = `"email":${JSON.stringify(email)}`;
  await tx.delete(verifications).where(sql`position(${needle} in ${verifications.value}) > 0`);
}

export async function findPreferences(
  db: Database,
  userId: string,
): Promise<PortalPreferences | null> {
  const [row] = await db
    .select()
    .from(portalPreferences)
    .where(eq(portalPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

export type PreferenceValues = Pick<
  PortalPreferences,
  "notifyMessage" | "notifyValidation" | "notifyInvoice" | "notifyRequirement" | "notifyReport"
>;

export async function upsertPreferences(
  tx: Database,
  userId: string,
  values: PreferenceValues,
): Promise<void> {
  await tx
    .insert(portalPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: portalPreferences.userId, set: values });
}

/** Clients à prévenir pour une entreprise, avec leurs préférences. Révoqués et bannis exclus. */
export async function listRecipients(db: Database, companyId: string) {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      notifyMessage: portalPreferences.notifyMessage,
      notifyValidation: portalPreferences.notifyValidation,
      notifyInvoice: portalPreferences.notifyInvoice,
      notifyRequirement: portalPreferences.notifyRequirement,
      notifyReport: portalPreferences.notifyReport,
    })
    .from(portalMemberships)
    .innerJoin(users, eq(users.id, portalMemberships.userId))
    .leftJoin(portalPreferences, eq(portalPreferences.userId, users.id))
    .where(
      and(
        eq(portalMemberships.companyId, companyId),
        inArray(portalMemberships.status, ["invited", "active"]),
        eq(users.role, "client"),
        eq(users.banned, false),
      ),
    );
}
