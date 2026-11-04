import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import { companies, contacts } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Listes de choix partagées (client d'un projet, d'un site, d'un contrat, d'un ticket…).
 * Sans contrôle d'accès : l'appelant est un service qui a déjà vérifié ses droits.
 */
export interface CompanyOption {
  id: string;
  name: string;
  status: string;
}

export interface ContactOption {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
}

export async function listCompanyOptions(
  db: Database,
  options: { search?: string; limit?: number } = {},
): Promise<CompanyOption[]> {
  const search = options.search?.trim();
  return db
    .select({ id: companies.id, name: companies.name, status: companies.status })
    .from(companies)
    .where(
      and(isNull(companies.archivedAt), search ? ilike(companies.name, `%${search}%`) : undefined),
    )
    .orderBy(asc(companies.name))
    .limit(options.limit ?? 200);
}

export async function getCompanyOption(
  db: Database,
  companyId: string,
): Promise<CompanyOption | null> {
  const [row] = await db
    .select({ id: companies.id, name: companies.name, status: companies.status })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row ?? null;
}

export async function listContactOptions(
  db: Database,
  companyId: string,
): Promise<ContactOption[]> {
  const rows = await db
    .select({
      id: contacts.id,
      companyId: contacts.companyId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), isNull(contacts.archivedAt)))
    .orderBy(asc(contacts.lastName));
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    fullName: [row.firstName, row.lastName].filter(Boolean).join(" "),
    email: row.email,
  }));
}

/** Référence d'une fiche pour un lien entre objets : identifiant Twenty compris. */
export interface CompanyRef {
  id: string;
  twentyId: string;
  name: string;
  status: string;
  archivedAt: Date | null;
  mergedIntoId: string | null;
}

export async function getCompanyRef(db: Database, companyId: string): Promise<CompanyRef | null> {
  const [row] = await db
    .select({
      id: companies.id,
      twentyId: companies.twentyId,
      name: companies.name,
      status: companies.status,
      archivedAt: companies.archivedAt,
      mergedIntoId: companies.mergedIntoId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row ?? null;
}

export async function getCompanyRefByTwentyId(
  db: Database,
  twentyId: string,
): Promise<CompanyRef | null> {
  const [row] = await db
    .select({
      id: companies.id,
      twentyId: companies.twentyId,
      name: companies.name,
      status: companies.status,
      archivedAt: companies.archivedAt,
      mergedIntoId: companies.mergedIntoId,
    })
    .from(companies)
    .where(eq(companies.twentyId, twentyId))
    .limit(1);
  return row ?? null;
}

export interface ContactRef {
  id: string;
  twentyId: string;
  companyId: string | null;
  archivedAt: Date | null;
}

export async function getContactRef(db: Database, contactId: string): Promise<ContactRef | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      twentyId: contacts.twentyId,
      companyId: contacts.companyId,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  return row ?? null;
}

export async function getContactRefByTwentyId(
  db: Database,
  twentyId: string,
): Promise<ContactRef | null> {
  const [row] = await db
    .select({
      id: contacts.id,
      twentyId: contacts.twentyId,
      companyId: contacts.companyId,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(eq(contacts.twentyId, twentyId))
    .limit(1);
  return row ?? null;
}
