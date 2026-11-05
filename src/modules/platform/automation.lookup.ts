import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  companies,
  contacts,
  projects,
  quotes,
  teamMembers,
  tickets,
  users,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import type { Role } from "@/server/auth/roles";

/**
 * Lectures système du répartiteur : qui prévenir pour un objet donné. Sans contrôle d'accès : aucune
 * donnée ne sort vers une page, seuls des identifiants et adresses servent à composer une alerte.
 */
export interface LookupUser {
  id: string;
  role: Role;
}

export async function findActiveUsersByRoles(
  db: Database,
  roles: readonly Role[],
): Promise<LookupUser[]> {
  return db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(inArray(users.role, [...roles]), eq(users.banned, false)));
}

export async function findActiveUsersByIds(
  db: Database,
  ids: readonly string[],
): Promise<LookupUser[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(inArray(users.id, [...ids]), eq(users.banned, false)));
}

/** Compte relié à une fiche d'équipe active. */
export async function findUserIdOfMember(
  db: Database,
  memberId: string | null,
): Promise<string | null> {
  if (!memberId) return null;
  const [row] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.id, memberId),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.archivedAt),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

export async function findProjectOwnerUserId(
  db: Database,
  projectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerMemberId: projects.ownerMemberId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return findUserIdOfMember(db, row?.ownerMemberId ?? null);
}

export async function findTicketAssigneeUserId(
  db: Database,
  ticketId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ memberId: tickets.assigneeMemberId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return findUserIdOfMember(db, row?.memberId ?? null);
}

export async function findCompanyName(
  db: Database,
  companyId: string | null,
): Promise<string | null> {
  if (!companyId) return null;
  const [row] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.name ?? null;
}

/** Adresse à relancer pour un devis : le contact de l'affaire, sinon le contact principal. */
export async function findQuoteRecipient(
  db: Database,
  quoteId: string,
): Promise<{ email: string; firstName: string | null; title: string | null } | null> {
  const [quote] = await db
    .select({ companyId: quotes.companyId, title: quotes.title })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote) return null;
  const [contact] = await db
    .select({ email: contacts.email, firstName: contacts.firstName })
    .from(contacts)
    .where(and(eq(contacts.companyId, quote.companyId), isNull(contacts.archivedAt)))
    .orderBy(desc(contacts.isPrimary), desc(contacts.createdAt))
    .limit(1);
  if (!contact?.email) return null;
  return { email: contact.email, firstName: contact.firstName, title: quote.title };
}
