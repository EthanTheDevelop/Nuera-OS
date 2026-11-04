import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  companies,
  contacts,
  opportunities,
  opportunityStageHistory,
  projects,
  quotes,
  quoteVersions,
  teamMembers,
  users,
} from "@/server/db/schema";
import type { Opportunity } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, prefixTsQuery, type PageParams } from "@/server/pagination";
import type { OpportunityFilters } from "./opportunity.schema";

/** `db.execute` renvoie `{ rows }` : node-postgres et PGlite ont la même forme. */
function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findOpportunityById(db: Database, id: string): Promise<Opportunity | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  return row ?? null;
}

export async function lockOpportunityById(tx: Database, id: string): Promise<Opportunity | null> {
  const [row] = await tx
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1)
    .for("update");
  return row ?? null;
}

export async function findOpportunityByTwentyId(
  db: Database,
  twentyId: string,
): Promise<Opportunity | null> {
  const [row] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.twentyId, twentyId))
    .limit(1);
  return row ?? null;
}

export async function insertOpportunity(
  tx: Database,
  values: typeof opportunities.$inferInsert,
): Promise<Opportunity | null> {
  const [row] = await tx.insert(opportunities).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function updateOpportunityRow(
  tx: Database,
  id: string,
  values: Partial<typeof opportunities.$inferInsert>,
): Promise<Opportunity> {
  const [row] = await tx
    .update(opportunities)
    .set(values)
    .where(eq(opportunities.id, id))
    .returning();
  if (!row) throw new Error("Affaire introuvable au moment de l'écriture");
  return row;
}

export async function insertStageHistory(
  tx: Database,
  values: typeof opportunityStageHistory.$inferInsert,
): Promise<string> {
  const [row] = await tx
    .insert(opportunityStageHistory)
    .values(values)
    .returning({ id: opportunityStageHistory.id });
  if (!row) throw new Error("Historique d'étape non créé");
  return row.id;
}

export async function listStageHistory(db: Database, opportunityId: string) {
  return db
    .select({
      id: opportunityStageHistory.id,
      fromStage: opportunityStageHistory.fromStage,
      toStage: opportunityStageHistory.toStage,
      at: opportunityStageHistory.at,
      actorName: users.name,
    })
    .from(opportunityStageHistory)
    .leftJoin(users, eq(opportunityStageHistory.actorId, users.id))
    .where(eq(opportunityStageHistory.opportunityId, opportunityId))
    .orderBy(desc(opportunityStageHistory.at));
}

function filterWhere(filters: OpportunityFilters, now: Date): SQL | undefined {
  const query = prefixTsQuery(filters.q);
  const threshold = filters.inactives
    ? new Date(now.getTime() - filters.inactives * 86_400_000)
    : null;
  return and(
    filters.archivees ? isNotNull(opportunities.archivedAt) : isNull(opportunities.archivedAt),
    filters.responsable ? eq(opportunities.ownerMemberId, filters.responsable) : undefined,
    filters.origine ? eq(opportunities.source, filters.origine) : undefined,
    filters.etape ? eq(opportunities.stage, filters.etape) : undefined,
    threshold
      ? and(
          sql`${opportunities.stage} not in ('WON','LOST')`,
          or(
            lt(opportunities.lastActivityAt, threshold),
            and(isNull(opportunities.lastActivityAt), lt(opportunities.createdAt, threshold)),
          ),
        )
      : undefined,
    query
      ? or(
          ilike(opportunities.name, `%${filters.q}%`),
          sql`to_tsvector('simple', ${companies.name}) @@ to_tsquery('simple', ${query})`,
        )
      : undefined,
  );
}

const rowFields = {
  opportunity: opportunities,
  companyName: companies.name,
  contactFirstName: contacts.firstName,
  contactLastName: contacts.lastName,
  ownerName: teamMembers.fullName,
};

export interface OpportunityRowData {
  opportunity: Opportunity;
  companyName: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  ownerName: string | null;
}

export async function getOpportunityRow(
  db: Database,
  id: string,
): Promise<OpportunityRowData | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const [row] = await db
    .select(rowFields)
    .from(opportunities)
    .leftJoin(companies, eq(opportunities.companyId, companies.id))
    .leftJoin(contacts, eq(opportunities.contactId, contacts.id))
    .leftJoin(teamMembers, eq(opportunities.ownerMemberId, teamMembers.id))
    .where(eq(opportunities.id, id))
    .limit(1);
  return row ?? null;
}

export async function listOpportunityPage(
  db: Database,
  filters: OpportunityFilters,
  params: PageParams,
  now: Date,
) {
  const where = filterWhere(filters, now);
  const direction = filters.sens === "desc" ? "desc" : "asc";
  const order =
    filters.tri === "montant"
      ? sql`${opportunities.amountCents} ${sql.raw(direction)} nulls last`
      : filters.tri === "echeance"
        ? sql`${opportunities.expectedCloseOn} ${sql.raw(direction)} nulls last`
        : filters.tri === "action"
          ? sql`${opportunities.nextActionOn} ${sql.raw(direction)} nulls last`
          : filters.tri === "affaire"
            ? (filters.sens === "desc" ? desc : asc)(opportunities.name)
            : desc(opportunities.updatedAt);

  return paginate<OpportunityRowData>(params, {
    items: (limit, offset) =>
      db
        .select(rowFields)
        .from(opportunities)
        .leftJoin(companies, eq(opportunities.companyId, companies.id))
        .leftJoin(contacts, eq(opportunities.contactId, contacts.id))
        .leftJoin(teamMembers, eq(opportunities.ownerMemberId, teamMembers.id))
        .where(where)
        .orderBy(order, asc(opportunities.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(opportunities)
        .leftJoin(companies, eq(opportunities.companyId, companies.id))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

/**
 * Colonnes du Kanban : au plus `perColumn` cartes par étape, les plus récemment touchées d'abord.
 * Le total réel de chaque colonne vient du résumé : un tableau de plusieurs centaines d'affaires
 * reste léger, la vue liste paginée donne le reste.
 */
export async function listBoardRows(
  db: Database,
  filters: OpportunityFilters,
  perColumn: number,
  now: Date,
): Promise<OpportunityRowData[]> {
  const where = filterWhere(filters, now);
  const ranked = db
    .select({
      id: opportunities.id,
      rank: sql<number>`row_number() over (
        partition by ${opportunities.stage}
        order by ${opportunities.nextActionOn} asc nulls last, ${opportunities.updatedAt} desc
      )`.as("rank"),
    })
    .from(opportunities)
    .leftJoin(companies, eq(opportunities.companyId, companies.id))
    .where(where)
    .as("ranked");
  return db
    .select(rowFields)
    .from(opportunities)
    .innerJoin(ranked, eq(ranked.id, opportunities.id))
    .leftJoin(companies, eq(opportunities.companyId, companies.id))
    .leftJoin(contacts, eq(opportunities.contactId, contacts.id))
    .leftJoin(teamMembers, eq(opportunities.ownerMemberId, teamMembers.id))
    .where(sql`${ranked.rank} <= ${perColumn}`)
    .orderBy(asc(ranked.rank));
}

export async function summarizeByStage(db: Database, filters: OpportunityFilters, now: Date) {
  return db
    .select({
      stage: opportunities.stage,
      total: count(),
      amountCents: sql<number>`coalesce(sum(${opportunities.amountCents}), 0)::bigint`,
    })
    .from(opportunities)
    .leftJoin(companies, eq(opportunities.companyId, companies.id))
    .where(filterWhere(filters, now))
    .groupBy(opportunities.stage);
}

export async function listOpportunitiesOfCompany(
  db: Database,
  companyId: string,
  options: { limit?: number } = {},
): Promise<OpportunityRowData[]> {
  return db
    .select(rowFields)
    .from(opportunities)
    .leftJoin(companies, eq(opportunities.companyId, companies.id))
    .leftJoin(contacts, eq(opportunities.contactId, contacts.id))
    .leftJoin(teamMembers, eq(opportunities.ownerMemberId, teamMembers.id))
    .where(and(eq(opportunities.companyId, companyId), isNull(opportunities.archivedAt)))
    .orderBy(
      sql`case when ${opportunities.stage} in ('WON','LOST') then 1 else 0 end`,
      desc(opportunities.updatedAt),
    )
    .limit(options.limit ?? 20);
}

export async function listDistinctOpportunityFilters(db: Database) {
  const [sources, owners] = await Promise.all([
    db
      .selectDistinct({ value: opportunities.source })
      .from(opportunities)
      .where(and(isNotNull(opportunities.source), isNull(opportunities.archivedAt)))
      .orderBy(asc(opportunities.source)),
    db
      .selectDistinct({ id: teamMembers.id, fullName: teamMembers.fullName })
      .from(opportunities)
      .innerJoin(teamMembers, eq(opportunities.ownerMemberId, teamMembers.id))
      .where(isNull(opportunities.archivedAt))
      .orderBy(asc(teamMembers.fullName)),
  ]);
  return { sources: sources.flatMap((row) => (row.value ? [row.value] : [])), owners };
}

/** Total de la version acceptée (ou courante) d'un devis, s'il appartient bien à cette affaire. */
export async function findQuoteOfOpportunity(
  tx: Database,
  quoteId: string,
  opportunityId: string,
): Promise<{ id: string; totalCents: number | null } | null> {
  const [row] = await tx
    .select({ id: quotes.id, totalCents: quoteVersions.totalCents })
    .from(quotes)
    .leftJoin(
      quoteVersions,
      sql`${quoteVersions.id} = coalesce(${quotes.acceptedVersionId}, ${quotes.currentVersionId})`,
    )
    .where(and(eq(quotes.id, quoteId), eq(quotes.opportunityId, opportunityId)))
    .limit(1);
  return row ?? null;
}

/** Devis d'une affaire, du plus récent au plus ancien, avec le total de leur version courante. */
export async function listQuotesOfOpportunity(db: Database, opportunityId: string) {
  return db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      totalCents: quoteVersions.totalCents,
    })
    .from(quotes)
    .leftJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .where(and(eq(quotes.opportunityId, opportunityId), isNull(quotes.archivedAt)))
    .orderBy(desc(quotes.createdAt));
}

/** Projets nés d'une affaire (03.04.02). */
export async function listProjectsOfOpportunity(db: Database, opportunityId: string) {
  return db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      status: projects.status,
    })
    .from(projects)
    .where(and(eq(projects.opportunityId, opportunityId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt));
}

/** Un devis ou un projet rattaché fige le client de l'affaire : clés composites sans valeur NULL. */
export async function hasCommercialChildren(tx: Database, opportunityId: string): Promise<boolean> {
  const result = await tx.execute<{ found: boolean }>(sql`
    select exists (select 1 from ${quotes} where ${quotes.opportunityId} = ${opportunityId}::uuid)
        or exists (select 1 from ${projects} where ${projects.opportunityId} = ${opportunityId}::uuid)
        as found
  `);
  return rowsOf<{ found: boolean }>(result)[0]?.found ?? false;
}

/** Change le client d'une affaire : les liens de l'ancien client sont vidés dans la même instruction. */
export async function moveOpportunityToCompany(
  tx: Database,
  opportunityId: string,
  companyId: string | null,
  contactId: string | null,
): Promise<void> {
  await tx.execute(sql`
    with cleared_activities as (
      update activities set opportunity_id = null
       where opportunity_id = ${opportunityId}::uuid and company_id is distinct from ${companyId}::uuid
    ), cleared_appointments as (
      update appointments set opportunity_id = null
       where opportunity_id = ${opportunityId}::uuid and company_id is distinct from ${companyId}::uuid
    )
    update opportunities
       set company_id = ${companyId}::uuid, contact_id = ${contactId}::uuid, updated_at = now()
     where id = ${opportunityId}::uuid
  `);
}

export async function listProjectedOpportunityIds(db: Database) {
  return db
    .select({ id: opportunities.id, twentyId: opportunities.twentyId })
    .from(opportunities)
    .where(isNull(opportunities.archivedAt));
}
