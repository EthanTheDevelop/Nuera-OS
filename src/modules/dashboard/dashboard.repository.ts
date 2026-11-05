import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  clientRequirements,
  companies,
  contracts,
  deliverables,
  directCosts,
  financialDocuments,
  maintenanceInterventions,
  opportunities,
  projects,
  quotes,
  quoteVersions,
  teamMembers,
  timeEntries,
  userPreferences,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Agrégats du pilotage que les autres modules n'exposent pas. Lecture seule, hors préférences. La
 * marge, le MRR et les synthèses passent par les services de leur module, jamais par ici.
 */
export interface DayRange {
  from: string;
  to: string;
}

const between = (column: unknown, range: DayRange) =>
  sql`${column} between ${range.from}::date and ${range.to}::date`;

/** Un instant lu au calendrier de Paris : une fin de journée reste dans son mois. */
const parisDate = (column: unknown) => sql`(${column} at time zone 'Europe/Paris')::date`;

// --- Préférences ------------------------------------------------------------------------------

export async function findPreferences(db: Database, userId: string) {
  const [row] = await db
    .select({
      dashboardLayout: userPreferences.dashboardLayout,
      homePath: userPreferences.homePath,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertDashboardLayout(db: Database, userId: string, layout: unknown) {
  await db
    .insert(userPreferences)
    .values({ userId, dashboardLayout: layout })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { dashboardLayout: layout, updatedAt: new Date() },
    });
}

// --- Chiffre d'affaires ------------------------------------------------------------------------

export interface RevenueRow {
  month: string;
  stream: "project" | "recurring";
  activity: string | null;
  contractKind: string | null;
  cents: number;
}

/**
 * Factures émises par mois (date d'émission), avoirs déduits, annulées exclues : la même base que
 * le « facturé » du module Finances. Récurrent : facture d'un contrat, sans projet.
 */
export async function listRevenueRows(db: Database, range: DayRange): Promise<RevenueRow[]> {
  const month = sql<string>`to_char(${financialDocuments.issuedOn}, 'YYYY-MM')`;
  const stream = sql<
    RevenueRow["stream"]
  >`case when ${financialDocuments.projectId} is null and ${financialDocuments.contractId} is not null then 'recurring' else 'project' end`;
  const rows = await db
    .select({
      month,
      stream,
      activity: projects.activity,
      contractKind: contracts.kind,
      cents: sql<number>`coalesce(sum(${financialDocuments.amountCents}), 0)::int`,
    })
    .from(financialDocuments)
    .leftJoin(projects, eq(projects.id, financialDocuments.projectId))
    .leftJoin(contracts, eq(contracts.id, financialDocuments.contractId))
    .where(
      and(ne(financialDocuments.status, "cancelled"), between(financialDocuments.issuedOn, range)),
    )
    .groupBy(month, stream, projects.activity, contracts.kind);
  return rows.map((row) => ({ ...row, cents: Number(row.cents) }));
}

// --- Marge : ce qui a bougé sur la période ------------------------------------------------------

export interface MarginSubjects {
  companyIds: string[];
  projects: { id: string; activity: string | null }[];
  contracts: { id: string; kind: string }[];
}

/**
 * Objets qui ont une facture, du temps ou un coût réalisé sur la période. Le calcul lui-même reste
 * celui de `getMargins` : ici, seulement la liste de ce qu'il faut lui demander.
 */
export async function listMarginSubjects(db: Database, range: DayRange): Promise<MarginSubjects> {
  const documentsInRange = and(
    ne(financialDocuments.status, "cancelled"),
    between(financialDocuments.issuedOn, range),
  );
  const timeInRange = between(timeEntries.workOn, range);
  // Un coût récurrent tombe encore sur la période sans y avoir été saisi.
  const costsInRange = and(
    isNull(directCosts.archivedAt),
    eq(directCosts.nature, "actual"),
    or(
      between(directCosts.incurredOn, range),
      and(
        isNotNull(directCosts.recurringPeriod),
        sql`${directCosts.incurredOn} <= ${range.to}::date`,
      ),
    ),
  );

  const [documentRows, timeRows, costRows] = await Promise.all([
    db
      .selectDistinct({
        companyId: financialDocuments.companyId,
        projectId: financialDocuments.projectId,
        contractId: financialDocuments.contractId,
      })
      .from(financialDocuments)
      .where(documentsInRange),
    db
      .selectDistinct({
        companyId: timeEntries.companyId,
        projectId: timeEntries.projectId,
        contractId: timeEntries.contractId,
      })
      .from(timeEntries)
      .where(timeInRange),
    db
      .selectDistinct({
        companyId: directCosts.companyId,
        projectId: directCosts.projectId,
        contractId: directCosts.contractId,
      })
      .from(directCosts)
      .where(costsInRange),
  ]);

  const rows = [...documentRows, ...timeRows, ...costRows];
  const unique = (values: (string | null)[]) => [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];
  const projectIds = unique(rows.map((row) => row.projectId));
  const contractIds = unique(rows.map((row) => row.contractId));
  const [projectRows, contractRows] = await Promise.all([
    projectIds.length
      ? db
          .select({ id: projects.id, activity: projects.activity })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([]),
    contractIds.length
      ? db
          .select({ id: contracts.id, kind: contracts.kind })
          .from(contracts)
          .where(inArray(contracts.id, contractIds))
      : Promise.resolve([]),
  ]);
  return {
    companyIds: unique(rows.map((row) => row.companyId)),
    projects: projectRows,
    contracts: contractRows,
  };
}

// --- Ventes ------------------------------------------------------------------------------------

export interface WonLostRow {
  month: string;
  won: number;
  lost: number;
}

export async function listWonLostByMonth(db: Database, range: DayRange): Promise<WonLostRow[]> {
  const closedAt = sql`coalesce(${opportunities.wonAt}, ${opportunities.lostAt})`;
  const month = sql<string>`to_char(${parisDate(closedAt)}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      won: sql<number>`count(*) filter (where ${opportunities.stage} = 'WON')::int`,
      lost: sql<number>`count(*) filter (where ${opportunities.stage} = 'LOST')::int`,
    })
    .from(opportunities)
    .where(
      and(
        isNull(opportunities.archivedAt),
        inArray(opportunities.stage, ["WON", "LOST"]),
        sql`${parisDate(closedAt)} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(month);
  return rows.map((row) => ({ month: row.month, won: Number(row.won), lost: Number(row.lost) }));
}

export async function listLostReasons(db: Database, range: DayRange, limit: number) {
  const reason = sql<string>`trim(${opportunities.lostReason})`;
  const rows = await db
    .select({ reason, total: count() })
    .from(opportunities)
    .where(
      and(
        isNull(opportunities.archivedAt),
        eq(opportunities.stage, "LOST"),
        isNotNull(opportunities.lostReason),
        sql`${parisDate(opportunities.lostAt)} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .groupBy(reason)
    .orderBy(desc(count()), asc(reason))
    .limit(limit);
  return rows.map((row) => ({ reason: row.reason, total: Number(row.total) }));
}

/** Délai moyen entre l'envoi et la signature, des devis signés sur la période. NULL sans signature. */
export async function averageSignatureDays(db: Database, range: DayRange): Promise<number | null> {
  const signedAt = sql`coalesce(${quotes.signedAt}, ${quotes.acceptedAt})`;
  const [row] = await db
    .select({
      days: sql<string | null>`avg(extract(epoch from (${signedAt} - ${quotes.sentAt})) / 86400)`,
    })
    .from(quotes)
    .where(
      and(
        isNull(quotes.archivedAt),
        isNotNull(quotes.sentAt),
        sql`${parisDate(signedAt)} between ${range.from}::date and ${range.to}::date`,
      ),
    );
  // Une signature datée avant l'envoi (saisie, import) ne fait pas un délai négatif.
  return row?.days === null || row?.days === undefined ? null : Math.max(0, Number(row.days));
}

/** Devis envoyés pondérés par la probabilité de leur affaire. Sans probabilité : à part, jamais 0 %. */
export async function sumProbableQuotes(db: Database) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(round(sum(${quoteVersions.totalCents} * ${opportunities.probability} / 100.0) filter (where ${opportunities.probability} is not null)), 0)::int`,
      withProbability: sql<number>`count(*) filter (where ${opportunities.probability} is not null)::int`,
      withoutProbability: sql<number>`count(*) filter (where ${opportunities.probability} is null)::int`,
    })
    .from(quotes)
    .innerJoin(quoteVersions, eq(quoteVersions.id, quotes.currentVersionId))
    .leftJoin(opportunities, eq(opportunities.id, quotes.opportunityId))
    .where(and(isNull(quotes.archivedAt), inArray(quotes.status, ["sent", "negotiation"])));
  return {
    cents: Number(row?.cents ?? 0),
    withProbability: Number(row?.withProbability ?? 0),
    withoutProbability: Number(row?.withoutProbability ?? 0),
  };
}

/** Affaires ouvertes sans devis en cours : ce qui n'est encore compté nulle part ailleurs. */
export async function sumHypotheticalPipeline(db: Database) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(${opportunities.amountCents}), 0)::int`,
      total: count(),
    })
    .from(opportunities)
    .where(
      and(
        isNull(opportunities.archivedAt),
        inArray(opportunities.stage, ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"]),
        sql`not exists (select 1 from ${quotes} where ${quotes.opportunityId} = ${opportunities.id} and ${quotes.status} in ('sent', 'negotiation') and ${quotes.archivedAt} is null)`,
      ),
    );
  return { cents: Number(row?.cents ?? 0), total: Number(row?.total ?? 0) };
}

export async function listDueNextActions(db: Database, today: string, limit: number) {
  return db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      nextAction: opportunities.nextAction,
      nextActionOn: opportunities.nextActionOn,
      companyName: companies.name,
    })
    .from(opportunities)
    .leftJoin(companies, eq(companies.id, opportunities.companyId))
    .where(
      and(
        isNull(opportunities.archivedAt),
        inArray(opportunities.stage, ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"]),
        sql`${opportunities.nextActionOn} <= ${today}::date`,
      ),
    )
    .orderBy(asc(opportunities.nextActionOn))
    .limit(limit);
}

// --- Production --------------------------------------------------------------------------------

export async function listDeliverablesToValidate(db: Database, limit: number) {
  return db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      projectId: deliverables.projectId,
      projectName: projects.name,
    })
    .from(deliverables)
    .innerJoin(projects, eq(projects.id, deliverables.projectId))
    .where(
      and(
        isNull(deliverables.archivedAt),
        isNull(projects.archivedAt),
        eq(deliverables.status, "to_validate"),
      ),
    )
    .orderBy(asc(deliverables.updatedAt))
    .limit(limit);
}

export async function listExpectedRequirements(db: Database, today: string, limit: number) {
  const where = and(
    isNull(clientRequirements.archivedAt),
    isNull(projects.archivedAt),
    eq(clientRequirements.status, "expected"),
    inArray(projects.status, ["preparation", "active", "blocked", "in_validation"]),
  );
  const [items, totals] = await Promise.all([
    db
      .select({
        id: clientRequirements.id,
        label: clientRequirements.label,
        dueOn: clientRequirements.dueOn,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(clientRequirements)
      .innerJoin(projects, eq(projects.id, clientRequirements.projectId))
      .where(where)
      .orderBy(sql`${clientRequirements.dueOn} asc nulls last`, asc(clientRequirements.createdAt))
      .limit(limit),
    db
      .select({
        total: count(),
        late: sql<number>`count(*) filter (where ${clientRequirements.dueOn} < ${today}::date)::int`,
      })
      .from(clientRequirements)
      .innerJoin(projects, eq(projects.id, clientRequirements.projectId))
      .where(where),
  ]);
  return { items, total: Number(totals[0]?.total ?? 0), late: Number(totals[0]?.late ?? 0) };
}

/** Temps saisi face au temps vendu, projets ouverts ayant une estimation. Minutes, aucun coût. */
export async function listTimeAgainstEstimate(db: Database, limit: number) {
  const spent = sql<number>`coalesce((select sum(${timeEntries.minutes}) from ${timeEntries} where ${timeEntries.projectId} = ${projects.id}), 0)::int`;
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      estimatedMinutes: projects.estimatedMinutes,
      spentMinutes: spent,
    })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        inArray(projects.status, ["preparation", "active", "blocked", "in_validation"]),
        sql`${projects.estimatedMinutes} > 0`,
      ),
    )
    .orderBy(desc(sql`${spent}::float / ${projects.estimatedMinutes}`), asc(projects.name));
  const typed = rows.map((row) => ({
    id: row.id,
    name: row.name,
    estimatedMinutes: Number(row.estimatedMinutes ?? 0),
    spentMinutes: Number(row.spentMinutes),
  }));
  return {
    items: typed.slice(0, limit),
    estimatedMinutes: typed.reduce((total, row) => total + row.estimatedMinutes, 0),
    spentMinutes: typed.reduce((total, row) => total + row.spentMinutes, 0),
    projects: typed.length,
  };
}

export async function listUpcomingInterventions(db: Database, range: DayRange, limit: number) {
  return db
    .select({
      id: maintenanceInterventions.id,
      title: maintenanceInterventions.title,
      plannedOn: maintenanceInterventions.plannedOn,
      contractId: maintenanceInterventions.contractId,
      companyName: companies.name,
    })
    .from(maintenanceInterventions)
    .innerJoin(contracts, eq(contracts.id, maintenanceInterventions.contractId))
    .innerJoin(companies, eq(companies.id, contracts.companyId))
    .where(
      and(
        isNull(maintenanceInterventions.doneOn),
        // Un contrat résilié, expiré, suspendu ou archivé n'appelle plus d'intervention.
        isNull(contracts.archivedAt),
        inArray(contracts.status, ["to_start", "active", "to_review"]),
        sql`${maintenanceInterventions.plannedOn} between ${range.from}::date and ${range.to}::date`,
      ),
    )
    .orderBy(asc(maintenanceInterventions.plannedOn))
    .limit(limit);
}

// --- Compteurs ---------------------------------------------------------------------------------

export async function countCompaniesByStatus(db: Database) {
  const rows = await db
    .select({ status: companies.status, total: count() })
    .from(companies)
    .where(and(isNull(companies.archivedAt), isNull(companies.mergedIntoId)))
    .groupBy(companies.status);
  return new Map(rows.map((row) => [row.status, Number(row.total)]));
}

/** Associés actifs : le partage des frais suit la réalité, rien n'est figé à deux (A6). */
export async function countActivePartners(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.kind, "partner"),
        eq(teamMembers.status, "active"),
        isNull(teamMembers.archivedAt),
      ),
    );
  return Number(row?.total ?? 0);
}
