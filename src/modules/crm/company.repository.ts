import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { companies, contacts, opportunities, teamMembers } from "@/server/db/schema";
import type { Company } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, prefixTsQuery, type PageParams } from "@/server/pagination";
import type { CompanyListFilters } from "./crm.schema";

/** Requêtes Drizzle du CRM, sans règle métier ni contrôle d'accès. */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant d'URL qui n'est pas un UUID désigne une fiche inconnue, pas une erreur SQL. */
export function isUuid(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export async function findCompanyById(db: Database, id: string): Promise<Company | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  return row ?? null;
}

/** Verrouille la ligne jusqu'à la fin de la transaction. */
export async function lockCompanyById(tx: Database, id: string): Promise<Company | null> {
  const [row] = await tx
    .select()
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function findCompanyByTwentyId(
  db: Database,
  twentyId: string,
): Promise<Company | null> {
  const [row] = await db.select().from(companies).where(eq(companies.twentyId, twentyId)).limit(1);
  return row ?? null;
}

export async function insertCompany(
  tx: Database,
  values: typeof companies.$inferInsert,
): Promise<Company | null> {
  const [row] = await tx.insert(companies).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function updateCompanyRow(
  tx: Database,
  id: string,
  values: Partial<typeof companies.$inferInsert>,
): Promise<Company> {
  const [row] = await tx.update(companies).set(values).where(eq(companies.id, id)).returning();
  if (!row) throw new Error("Client introuvable au moment de l'écriture");
  return row;
}

/** Même clé de comparaison que `normalizeName` en TypeScript. */
export function normalizedNameSql(column: SQL | typeof companies.name): SQL<string> {
  return sql<string>`regexp_replace(translate(lower(${column}), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]', '', 'g')`;
}

export async function findCompaniesMatching(
  db: Database,
  match: {
    domain?: string | null;
    siren?: string | null;
    normalizedName?: string | null;
    excludeId?: string;
  },
): Promise<Company[]> {
  const clauses = [
    match.domain ? sql`lower(${companies.domain}) = ${match.domain}` : undefined,
    match.siren ? eq(companies.siren, match.siren) : undefined,
    match.normalizedName
      ? sql`${normalizedNameSql(companies.name)} = ${match.normalizedName}`
      : undefined,
  ].filter((clause): clause is SQL => clause !== undefined);
  if (clauses.length === 0) return [];
  return db
    .select()
    .from(companies)
    .where(
      and(
        or(...clauses),
        isNull(companies.mergedIntoId),
        match.excludeId ? ne(companies.id, match.excludeId) : undefined,
      ),
    )
    .limit(10);
}

function companyWhere(filters: CompanyListFilters): SQL | undefined {
  const query = prefixTsQuery(filters.q);
  const status = filters.statut === "archived" ? undefined : filters.statut;
  return and(
    isNull(companies.mergedIntoId),
    filters.statut === "archived" ? isNotNull(companies.archivedAt) : isNull(companies.archivedAt),
    status ? eq(companies.status, status) : undefined,
    filters.origine ? eq(companies.source, filters.origine) : undefined,
    filters.responsable ? eq(companies.ownerMemberId, filters.responsable) : undefined,
    filters.tag ? sql`${companies.tags} @> array[${filters.tag}]::text[]` : undefined,
    query
      ? or(
          sql`to_tsvector('simple', ${companies.name}) @@ to_tsquery('simple', ${query})`,
          sql`exists (
            select 1 from ${contacts}
            where ${contacts.companyId} = ${companies.id}
              and ${contacts.archivedAt} is null
              and to_tsvector('simple', ${contacts.firstName} || ' ' || ${contacts.lastName} || ' ' || coalesce(${contacts.email}, '')) @@ to_tsquery('simple', ${query})
          )`,
          ilike(companies.domain, `%${filters.q}%`),
        )
      : undefined,
  );
}

/** Affaire de référence d'un client : la dernière ouverte, sinon la dernière close. */
const LEAD_OPPORTUNITY_ORDER = sql`case when o.stage in ('WON','LOST') then 1 else 0 end, o.updated_at desc`;

export async function listCompanyPage(
  db: Database,
  filters: CompanyListFilters,
  params: PageParams,
) {
  const where = companyWhere(filters);
  const direction = filters.sens === "desc" ? desc : asc;
  const amount = sql`(
    select o.amount_cents from opportunities o
    where o.company_id = ${companies.id} and o.archived_at is null
    order by ${LEAD_OPPORTUNITY_ORDER} limit 1
  )`;
  const order =
    filters.tri === "montant"
      ? sql`${amount} ${sql.raw(filters.sens === "desc" ? "desc" : "asc")} nulls last`
      : filters.tri === "origine"
        ? direction(companies.source)
        : direction(companies.name);

  return paginate(params, {
    items: (limit, offset) =>
      db
        .select()
        .from(companies)
        .where(where)
        .orderBy(order, asc(companies.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db.select({ total: count() }).from(companies).where(where);
      return row?.total ?? 0;
    },
  });
}

export async function listPrimaryContacts(db: Database, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .selectDistinctOn([contacts.companyId], {
      companyId: contacts.companyId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(contacts)
    .where(and(inArray(contacts.companyId, companyIds), isNull(contacts.archivedAt)))
    .orderBy(contacts.companyId, desc(contacts.isPrimary), asc(contacts.createdAt));
}

export async function listLeadOpportunities(db: Database, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  return db
    .selectDistinctOn([opportunities.companyId], {
      companyId: opportunities.companyId,
      name: opportunities.name,
      stage: opportunities.stage,
      amountCents: opportunities.amountCents,
    })
    .from(opportunities)
    .where(and(inArray(opportunities.companyId, companyIds), isNull(opportunities.archivedAt)))
    .orderBy(
      opportunities.companyId,
      sql`case when ${opportunities.stage} in ('WON','LOST') then 1 else 0 end`,
      desc(opportunities.updatedAt),
    );
}

export async function countCompaniesByStatus(db: Database) {
  const rows = await db
    .select({ status: companies.status, total: count() })
    .from(companies)
    .where(and(isNull(companies.archivedAt), isNull(companies.mergedIntoId)))
    .groupBy(companies.status);
  const [active] = await db
    .select({ total: sql<number>`count(distinct ${companies.id})::int` })
    .from(companies)
    .innerJoin(opportunities, eq(opportunities.companyId, companies.id))
    .where(
      and(
        isNull(companies.archivedAt),
        isNull(companies.mergedIntoId),
        eq(companies.status, "prospect"),
        isNull(opportunities.archivedAt),
        sql`${opportunities.stage} not in ('WON','LOST')`,
      ),
    );
  return { byStatus: rows, activeProspects: active?.total ?? 0 };
}

export async function listDistinctCompanyFilters(db: Database) {
  const [sources, tags, owners] = await Promise.all([
    db
      .selectDistinct({ value: companies.source })
      .from(companies)
      .where(and(isNotNull(companies.source), isNull(companies.archivedAt)))
      .orderBy(asc(companies.source)),
    db.execute<{ tag: string }>(
      sql`select distinct unnest(${companies.tags}) as tag from ${companies} where ${companies.archivedAt} is null order by tag limit 100`,
    ),
    db
      .selectDistinct({ id: teamMembers.id, fullName: teamMembers.fullName })
      .from(companies)
      .innerJoin(teamMembers, eq(companies.ownerMemberId, teamMembers.id))
      .where(isNull(companies.archivedAt))
      .orderBy(asc(teamMembers.fullName)),
  ]);
  return {
    sources: sources.flatMap((row) => (row.value ? [row.value] : [])),
    tags: rowsOf<{ tag: string }>(tags).map((row) => row.tag),
    owners,
  };
}

/** `db.execute` renvoie `{ rows }` selon le pilote : node-postgres et PGlite ont la même forme. */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

export type CompanyDuplicateCandidate = {
  reason: "domain" | "siren" | "name";
  key: string;
  ids: string[];
};

/** Groupes de fiches actives qui partagent un domaine, un SIREN ou un nom normalisé. */
export async function findCompanyDuplicateGroups(
  db: Database,
  limit: number,
): Promise<CompanyDuplicateCandidate[]> {
  const result = await db.execute<CompanyDuplicateCandidate>(sql`
    with active as (
      select id, name, lower(domain) as domain, siren, ${normalizedNameSql(sql`name`)} as normalized_name
      from companies where archived_at is null and merged_into_id is null
    )
    select 'domain' as reason, domain as key, array_agg(id order by name) as ids
      from active where domain is not null group by domain having count(*) > 1
    union all
    select 'siren', siren, array_agg(id order by name)
      from active where siren is not null group by siren having count(*) > 1
    union all
    select 'name', normalized_name, array_agg(id order by name)
      from active where normalized_name <> '' group by normalized_name having count(*) > 1
    order by key
    limit ${limit}
  `);
  return rowsOf<CompanyDuplicateCandidate>(result);
}

export async function listCompaniesByIds(db: Database, ids: string[]): Promise<Company[]> {
  if (ids.length === 0) return [];
  return db.select().from(companies).where(inArray(companies.id, ids));
}

/**
 * Toute table qui porte `company_id`. Vérifié contre le catalogue PostgreSQL par un test : une table
 * oubliée ferait échouer la fusion sur une clé composite, ou laisserait un objet sur la fiche perdue.
 */
export const COMPANY_CHILD_TABLES = [
  "contacts",
  "opportunities",
  "activities",
  "quotes",
  "change_requests",
  "projects",
  "missions",
  "time_entries",
  "domains",
  "sites",
  "contract_sites",
  "contracts",
  "maintenance_interventions",
  "tickets",
  "direct_costs",
  "financial_documents",
  "payment_schedule_items",
  "documents",
  "appointments",
  "comments",
  "conversations",
  "messages",
  "portal_memberships",
  "domain_events",
] as const;

/**
 * Fusion locale, en UNE instruction : les clés composites `(objet_id, company_id)` sont vérifiées
 * en fin d'instruction, ce qui permet de déplacer ensemble parents et enfants (domain-model §9).
 * La fiche perdante reste, archivée et rattachée à la gagnante, pour l'historique.
 */
export async function moveCompanyChildren(
  tx: Database,
  loserId: string,
  winnerId: string,
): Promise<void> {
  const moves = COMPANY_CHILD_TABLES.filter((table) => table !== "contacts").map(
    (table) =>
      sql`${sql.raw(`moved_${table}`)} as (
        update ${sql.raw(table)} set company_id = ${winnerId}::uuid where company_id = ${loserId}::uuid
      )`,
  );
  // Le contact principal de la gagnante le reste.
  const movedContacts = sql`moved_contacts as (
    update contacts
       set company_id = ${winnerId}::uuid,
           is_primary = is_primary and not exists (
             select 1 from contacts w where w.company_id = ${winnerId}::uuid and w.is_primary and w.archived_at is null
           )
     where company_id = ${loserId}::uuid
  )`;
  await tx.execute(sql`
    with ${sql.join([movedContacts, ...moves], sql`, `)}
    update companies
       set merged_into_id = ${winnerId}::uuid,
           archived_at = coalesce(archived_at, now()),
           updated_at = now()
     where id = ${loserId}::uuid
  `);
}
