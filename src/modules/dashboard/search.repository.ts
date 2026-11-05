import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import {
  companies,
  contacts,
  contracts,
  opportunities,
  projects,
  quotes,
  sites,
  tasks,
  tickets,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Lecture légère de la recherche globale : seulement ce qu'une ligne de résultat affiche.
 * Le périmètre d'un prestataire est un paramètre, appliqué dans la requête.
 */

const ACCENTS = "àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ";
const PLAIN = "aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN";

/** `%` et `_` saisis cherchent ces caractères, ils ne servent pas de joker. Sans accents. */
export function likePattern(text: string): string {
  const plain = text.normalize("NFD").replace(/\p{M}/gu, "");
  return `%${plain.replace(/[\\%_]/g, "\\$&")}%`;
}

/** « zephyr » trouve « Zéphyr » : une saisie rapide n'a pas d'accents. */
function ilike(column: SQLWrapper, pattern: string): SQL {
  return sql`translate(${column}, ${ACCENTS}, ${PLAIN}) ilike ${pattern}`;
}

export interface SearchRow {
  id: string;
  label: string;
  detail: string | null;
  /** Identifiant du parent quand le lien de la ligne en dépend. */
  parentId?: string | null;
}

export function searchCompanies(
  db: Database,
  pattern: string,
  limit: number,
): Promise<SearchRow[]> {
  return db
    .select({ id: companies.id, label: companies.name, detail: companies.domain })
    .from(companies)
    .where(
      and(
        isNull(companies.archivedAt),
        isNull(companies.mergedIntoId),
        or(
          ilike(companies.name, pattern),
          ilike(companies.domain, pattern),
          ilike(companies.siren, pattern),
        ),
      ),
    )
    .orderBy(asc(companies.name))
    .limit(limit);
}

export function searchContacts(db: Database, pattern: string, limit: number): Promise<SearchRow[]> {
  const fullName = sql<string>`trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, ''))`;
  return db
    .select({ id: contacts.id, label: fullName, detail: companies.name })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(
      and(
        isNull(contacts.archivedAt),
        or(ilike(fullName, pattern), ilike(contacts.email, pattern)),
      ),
    )
    .orderBy(asc(contacts.lastName), asc(contacts.id))
    .limit(limit);
}

export function searchOpportunities(
  db: Database,
  pattern: string,
  limit: number,
): Promise<SearchRow[]> {
  return db
    .select({ id: opportunities.id, label: opportunities.name, detail: companies.name })
    .from(opportunities)
    .leftJoin(companies, eq(companies.id, opportunities.companyId))
    .where(
      and(
        isNull(opportunities.archivedAt),
        or(ilike(opportunities.name, pattern), ilike(companies.name, pattern)),
      ),
    )
    .orderBy(desc(opportunities.updatedAt))
    .limit(limit);
}

export function searchQuotes(db: Database, pattern: string, limit: number): Promise<SearchRow[]> {
  return db
    .select({
      id: quotes.id,
      label: sql<string>`${quotes.number} || ' · ' || ${quotes.title}`,
      detail: companies.name,
    })
    .from(quotes)
    .innerJoin(companies, eq(companies.id, quotes.companyId))
    .where(
      and(
        isNull(quotes.archivedAt),
        or(
          ilike(quotes.number, pattern),
          ilike(quotes.title, pattern),
          ilike(companies.name, pattern),
        ),
      ),
    )
    .orderBy(desc(quotes.number))
    .limit(limit);
}

/** `projectIds` : NULL pour qui lit tout, la liste de ses projets pour un prestataire. */
export function searchProjects(
  db: Database,
  pattern: string,
  limit: number,
  scope: { projectIds: string[] | null },
): Promise<SearchRow[]> {
  if (scope.projectIds?.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: projects.id,
      label: projects.name,
      detail: sql<string>`${projects.number} || ' · ' || ${companies.name}`,
    })
    .from(projects)
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        isNull(projects.archivedAt),
        scope.projectIds ? inArray(projects.id, scope.projectIds) : undefined,
        or(
          ilike(projects.name, pattern),
          ilike(projects.number, pattern),
          ilike(companies.name, pattern),
        ),
      ),
    )
    .orderBy(desc(projects.number))
    .limit(limit);
}

export function searchTasks(
  db: Database,
  pattern: string,
  limit: number,
  scope: { projectIds: string[] | null; assigneeMemberId: string | null; assignedOnly: boolean },
): Promise<SearchRow[]> {
  if (scope.assignedOnly && (!scope.assigneeMemberId || scope.projectIds?.length === 0)) {
    return Promise.resolve([]);
  }
  return db
    .select({
      id: tasks.id,
      label: tasks.title,
      detail: sql<string>`${tasks.number} || ' · ' || ${projects.name}`,
      parentId: tasks.projectId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        isNull(tasks.archivedAt),
        isNull(projects.archivedAt),
        scope.projectIds ? inArray(tasks.projectId, scope.projectIds) : undefined,
        scope.assignedOnly && scope.assigneeMemberId
          ? eq(tasks.assigneeMemberId, scope.assigneeMemberId)
          : undefined,
        or(ilike(tasks.title, pattern), ilike(tasks.number, pattern)),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(limit);
}

export function searchSites(db: Database, pattern: string, limit: number): Promise<SearchRow[]> {
  return db
    .select({ id: sites.id, label: sites.name, detail: sites.primaryDomain })
    .from(sites)
    .where(
      and(
        isNull(sites.archivedAt),
        or(ilike(sites.name, pattern), ilike(sites.primaryDomain, pattern)),
      ),
    )
    .orderBy(asc(sites.name))
    .limit(limit);
}

export function searchContracts(
  db: Database,
  pattern: string,
  limit: number,
): Promise<SearchRow[]> {
  return db
    .select({
      id: contracts.id,
      label: sql<string>`${contracts.number} || ' · ' || ${contracts.name}`,
      detail: companies.name,
    })
    .from(contracts)
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(
      and(
        isNull(contracts.archivedAt),
        or(
          ilike(contracts.name, pattern),
          ilike(contracts.number, pattern),
          ilike(companies.name, pattern),
        ),
      ),
    )
    .orderBy(desc(contracts.number))
    .limit(limit);
}

/** `assigneeMemberId` : la fiche du prestataire. Sans fiche, il ne voit aucune demande. */
export function searchTickets(
  db: Database,
  pattern: string,
  limit: number,
  scope: { assignedOnly: boolean; assigneeMemberId: string | null },
): Promise<SearchRow[]> {
  if (scope.assignedOnly && !scope.assigneeMemberId) return Promise.resolve([]);
  const conditions: (SQL | undefined)[] = [
    isNull(tickets.archivedAt),
    scope.assignedOnly && scope.assigneeMemberId
      ? eq(tickets.assigneeMemberId, scope.assigneeMemberId)
      : undefined,
    or(
      ilike(tickets.subject, pattern),
      ilike(tickets.number, pattern),
      ilike(companies.name, pattern),
    ),
  ];
  return db
    .select({
      id: tickets.id,
      label: sql<string>`${tickets.number} || ' · ' || ${tickets.subject}`,
      detail: companies.name,
    })
    .from(tickets)
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(and(...conditions))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
}
