import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  CmsKind,
  EnvironmentKind,
  EnvironmentStatus,
  IntegrationService,
  IntegrationStatus,
  SiteStatus,
  WebhookReceiptStatus,
} from "@/lib/domain-enums";
import {
  companies,
  contracts,
  contractSites,
  deployments,
  domainEvents,
  domains,
  integrationConnections,
  projects,
  siteBackups,
  siteEnvironments,
  sites,
  siteUptimeSamples,
  syncRuns,
  teamMembers,
  tickets,
  users,
  webhookReceipts,
  type Deployment,
  type Domain,
  type Site,
  type SiteBackup,
  type SiteEnvironment,
  type SiteUptimeSample,
  type SyncRun,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { paginate, type PageParams, type Paginated } from "@/server/pagination";
import type { SiteSort } from "./site.schema";

/** Requêtes du domaine Sites : aucune règle métier ni contrôle d'accès ici. */

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// --- Registre ----------------------------------------------------------------------------------

export interface SiteListWhere {
  search?: string;
  status?: SiteStatus;
  hostedByNuera?: boolean;
  archived: boolean;
  companyId?: string;
  cmsKind?: CmsKind;
  environmentStatus?: EnvironmentStatus;
}

export interface SiteListRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: SiteStatus;
  kind: Site["kind"];
  technology: string | null;
  cmsKind: CmsKind | null;
  cmsAdminUrl: string | null;
  hostingLabel: string | null;
  hostedByNuera: boolean;
  serverLabel: string | null;
  liveOn: string | null;
  companyId: string;
  companyName: string;
  projectNumber: string | null;
  ownerName: string | null;
  domainExpiresOn: string | null;
  tlsStatus: Domain["tlsStatus"] | null;
}

function siteListConditions(where: SiteListWhere): SQL | undefined {
  const search = where.search?.trim();
  const pattern = search ? likePattern(search) : null;
  return and(
    where.archived ? isNotNull(sites.archivedAt) : isNull(sites.archivedAt),
    where.status ? eq(sites.status, where.status) : undefined,
    where.hostedByNuera === undefined ? undefined : eq(sites.hostedByNuera, where.hostedByNuera),
    where.companyId ? eq(sites.companyId, where.companyId) : undefined,
    where.cmsKind ? eq(sites.cmsKind, where.cmsKind) : undefined,
    where.environmentStatus
      ? sql`exists (select 1 from ${siteEnvironments} where ${siteEnvironments.siteId} = ${sites.id} and ${siteEnvironments.kind} = 'production' and ${siteEnvironments.status} = ${where.environmentStatus})`
      : undefined,
    pattern
      ? or(
          ilike(sites.name, pattern),
          ilike(sites.primaryDomain, pattern),
          ilike(companies.name, pattern),
        )
      : undefined,
  );
}

const SORT_COLUMNS: Record<SiteSort, SQL> = {
  name: sql`${sites.name}`,
  client: sql`${companies.name}`,
  status: sql`${sites.status}`,
  live: sql`${sites.liveOn}`,
  expiry: sql`${domains.expiresOn}`,
};

export async function listSites(
  db: Database,
  where: SiteListWhere,
  params: PageParams,
  sort: { key: SiteSort; direction: "asc" | "desc" },
): Promise<Paginated<SiteListRow>> {
  const conditions = siteListConditions(where);
  const direction = sort.direction === "desc" ? sql`desc` : sql`asc`;
  return paginate(params, {
    items: (limit, offset) =>
      db
        .select({
          id: sites.id,
          name: sites.name,
          primaryDomain: sites.primaryDomain,
          status: sites.status,
          kind: sites.kind,
          technology: sites.technology,
          cmsKind: sites.cmsKind,
          cmsAdminUrl: sites.cmsAdminUrl,
          hostingLabel: sites.hostingLabel,
          hostedByNuera: sites.hostedByNuera,
          serverLabel: sites.serverLabel,
          liveOn: sites.liveOn,
          companyId: sites.companyId,
          companyName: companies.name,
          projectNumber: projects.number,
          ownerName: teamMembers.fullName,
          domainExpiresOn: domains.expiresOn,
          tlsStatus: domains.tlsStatus,
        })
        .from(sites)
        .innerJoin(companies, eq(companies.id, sites.companyId))
        .leftJoin(projects, eq(projects.id, sites.projectId))
        .leftJoin(teamMembers, eq(teamMembers.id, sites.ownerMemberId))
        // Le nom seul ne suffit pas : après un retrait, un autre client peut enregistrer ce nom.
        .leftJoin(
          domains,
          and(eq(domains.name, sites.primaryDomain), eq(domains.companyId, sites.companyId)),
        )
        .where(conditions)
        .orderBy(sql`${SORT_COLUMNS[sort.key]} ${direction} nulls last`, asc(sites.id))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(sites)
        .innerJoin(companies, eq(companies.id, sites.companyId))
        .where(conditions);
      return row?.total ?? 0;
    },
  });
}

export async function countSitesByStatus(
  db: Database,
): Promise<{ status: SiteStatus; total: number }[]> {
  return db
    .select({ status: sites.status, total: count() })
    .from(sites)
    .where(isNull(sites.archivedAt))
    .groupBy(sites.status);
}

export async function findSiteById(db: Database, id: string): Promise<Site | null> {
  const [row] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return row ?? null;
}

/** Verrouille la ligne : une transition concurrente attend la fin de la transaction. */
export async function findSiteByIdForUpdate(db: Database, id: string): Promise<Site | null> {
  const [row] = await db.select().from(sites).where(eq(sites.id, id)).for("update").limit(1);
  return row ?? null;
}

export async function insertSite(db: Database, values: typeof sites.$inferInsert): Promise<Site> {
  const [row] = await db.insert(sites).values(values).returning();
  if (!row) throw new Error("Insertion du site sans résultat.");
  return row;
}

export async function updateSite(
  db: Database,
  id: string,
  values: Partial<typeof sites.$inferInsert>,
): Promise<Site> {
  const [row] = await db.update(sites).set(values).where(eq(sites.id, id)).returning();
  if (!row) throw new Error("Mise à jour du site sans résultat.");
  return row;
}

export interface SiteRelations {
  companyName: string | null;
  projectNumber: string | null;
  projectName: string | null;
  contractName: string | null;
  contractNumber: string | null;
  contractId: string | null;
  ownerName: string | null;
}

/** Le contrat vient de `sites.contract_id`, sinon du lien `contract_sites` posé par les contrats. */
export async function findSiteRelations(db: Database, site: Site): Promise<SiteRelations> {
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, site.companyId))
    .limit(1);
  const [project] = site.projectId
    ? await db
        .select({ number: projects.number, name: projects.name })
        .from(projects)
        .where(eq(projects.id, site.projectId))
        .limit(1)
    : [];
  const [owner] = site.ownerMemberId
    ? await db
        .select({ name: teamMembers.fullName })
        .from(teamMembers)
        .where(eq(teamMembers.id, site.ownerMemberId))
        .limit(1)
    : [];

  const contractSelection = { id: contracts.id, number: contracts.number, name: contracts.name };
  const [contract] = site.contractId
    ? await db
        .select(contractSelection)
        .from(contracts)
        .where(eq(contracts.id, site.contractId))
        .limit(1)
    : await db
        .select(contractSelection)
        .from(contractSites)
        .innerJoin(contracts, eq(contracts.id, contractSites.contractId))
        .where(eq(contractSites.siteId, site.id))
        .orderBy(desc(contractSites.createdAt))
        .limit(1);

  return {
    companyName: company?.name ?? null,
    projectNumber: project?.number ?? null,
    projectName: project?.name ?? null,
    contractName: contract?.name ?? null,
    contractNumber: contract?.number ?? null,
    contractId: contract?.id ?? null,
    ownerName: owner?.name ?? null,
  };
}

export interface LinkOption {
  id: string;
  label: string;
}

export async function listCompanyProjectOptions(
  db: Database,
  companyId: string,
): Promise<LinkOption[]> {
  const rows = await db
    .select({ id: projects.id, number: projects.number, name: projects.name })
    .from(projects)
    .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.createdAt))
    .limit(200);
  return rows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` }));
}

export async function listCompanyContractOptions(
  db: Database,
  companyId: string,
): Promise<LinkOption[]> {
  const rows = await db
    .select({ id: contracts.id, number: contracts.number, name: contracts.name })
    .from(contracts)
    .where(eq(contracts.companyId, companyId))
    .orderBy(desc(contracts.createdAt))
    .limit(200);
  return rows.map((row) => ({ id: row.id, label: `${row.number} · ${row.name}` }));
}

export async function listCompanySiteOptions(
  db: Database,
  companyId: string,
): Promise<LinkOption[]> {
  const rows = await db
    .select({ id: sites.id, name: sites.name, primaryDomain: sites.primaryDomain })
    .from(sites)
    .where(and(eq(sites.companyId, companyId), isNull(sites.archivedAt)))
    .orderBy(asc(sites.name))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    label: row.primaryDomain ? `${row.name} · ${row.primaryDomain}` : row.name,
  }));
}

export async function projectBelongsToCompany(
  db: Database,
  projectId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

export async function contractBelongsToCompany(
  db: Database,
  contractId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), eq(contracts.companyId, companyId)))
    .limit(1);
  return Boolean(row);
}

// --- Environnements ----------------------------------------------------------------------------

export async function listEnvironments(
  db: Database,
  siteIds: string[],
): Promise<SiteEnvironment[]> {
  if (siteIds.length === 0) return [];
  return db
    .select()
    .from(siteEnvironments)
    .where(inArray(siteEnvironments.siteId, siteIds))
    .orderBy(asc(siteEnvironments.kind));
}

export async function findEnvironmentByKind(
  db: Database,
  siteId: string,
  kind: EnvironmentKind,
): Promise<SiteEnvironment | null> {
  const [row] = await db
    .select()
    .from(siteEnvironments)
    .where(and(eq(siteEnvironments.siteId, siteId), eq(siteEnvironments.kind, kind)))
    .limit(1);
  return row ?? null;
}

/** Environnement d'un site actif déjà relié à cette application Coolify, s'il y en a un. */
export async function findEnvironmentByCoolifyApp(
  db: Database,
  coolifyAppUuid: string,
): Promise<{ id: string; siteId: string; kind: EnvironmentKind } | null> {
  const [row] = await db
    .select({
      id: siteEnvironments.id,
      siteId: siteEnvironments.siteId,
      kind: siteEnvironments.kind,
    })
    .from(siteEnvironments)
    .innerJoin(sites, eq(sites.id, siteEnvironments.siteId))
    .where(and(eq(siteEnvironments.coolifyAppUuid, coolifyAppUuid), isNull(sites.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function upsertEnvironment(
  db: Database,
  values: typeof siteEnvironments.$inferInsert,
): Promise<SiteEnvironment> {
  const [row] = await db
    .insert(siteEnvironments)
    .values(values)
    .onConflictDoUpdate({
      target: [siteEnvironments.siteId, siteEnvironments.kind],
      set: {
        url: values.url ?? null,
        coolifyAppUuid: values.coolifyAppUuid ?? null,
        status: values.status ?? "unknown",
        statusCheckedAt: values.statusCheckedAt ?? null,
      },
    })
    .returning();
  if (!row) throw new Error("Écriture de l'environnement sans résultat.");
  return row;
}

export interface LinkedEnvironment {
  id: string;
  siteId: string;
  kind: EnvironmentKind;
  coolifyAppUuid: string;
  status: EnvironmentStatus;
  companyId: string;
}

/** Environnements reliés à une application Coolify, hors sites archivés. */
export async function listCoolifyLinkedEnvironments(db: Database): Promise<LinkedEnvironment[]> {
  const rows = await db
    .select({
      id: siteEnvironments.id,
      siteId: siteEnvironments.siteId,
      kind: siteEnvironments.kind,
      coolifyAppUuid: siteEnvironments.coolifyAppUuid,
      status: siteEnvironments.status,
      companyId: sites.companyId,
    })
    .from(siteEnvironments)
    .innerJoin(sites, eq(sites.id, siteEnvironments.siteId))
    .where(and(isNotNull(siteEnvironments.coolifyAppUuid), isNull(sites.archivedAt)));
  return rows.flatMap((row) =>
    row.coolifyAppUuid ? [{ ...row, coolifyAppUuid: row.coolifyAppUuid }] : [],
  );
}

export async function updateEnvironmentStatus(
  db: Database,
  id: string,
  status: EnvironmentStatus,
  checkedAt: Date,
): Promise<void> {
  await db
    .update(siteEnvironments)
    .set({ status, statusCheckedAt: checkedAt })
    .where(eq(siteEnvironments.id, id));
}

// --- Déploiements ------------------------------------------------------------------------------

export interface DeploymentRow extends Deployment {
  environmentKind: EnvironmentKind;
  triggeredByName: string | null;
}

export async function listSiteDeployments(
  db: Database,
  siteId: string,
  params: PageParams,
): Promise<Paginated<DeploymentRow>> {
  const where = eq(siteEnvironments.siteId, siteId);
  return paginate(params, {
    items: async (limit, offset) => {
      const rows = await db
        .select({
          deployment: deployments,
          environmentKind: siteEnvironments.kind,
          triggeredByName: users.name,
        })
        .from(deployments)
        .innerJoin(siteEnvironments, eq(siteEnvironments.id, deployments.environmentId))
        .leftJoin(users, eq(users.id, deployments.triggeredByUserId))
        .where(where)
        .orderBy(sql`coalesce(${deployments.startedAt}, ${deployments.createdAt}) desc`)
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        ...row.deployment,
        environmentKind: row.environmentKind,
        triggeredByName: row.triggeredByName,
      }));
    },
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(deployments)
        .innerJoin(siteEnvironments, eq(siteEnvironments.id, deployments.environmentId))
        .where(where);
      return row?.total ?? 0;
    },
  });
}

export async function findDeploymentByExternalId(
  db: Database,
  externalId: string,
): Promise<Deployment | null> {
  const [row] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.externalId, externalId))
    .limit(1);
  return row ?? null;
}

export async function insertDeployment(
  db: Database,
  values: typeof deployments.$inferInsert,
): Promise<Deployment> {
  const [row] = await db.insert(deployments).values(values).returning();
  if (!row) throw new Error("Insertion du déploiement sans résultat.");
  return row;
}

export async function updateDeployment(
  db: Database,
  id: string,
  values: Partial<typeof deployments.$inferInsert>,
): Promise<Deployment> {
  const [row] = await db.update(deployments).set(values).where(eq(deployments.id, id)).returning();
  if (!row) throw new Error("Mise à jour du déploiement sans résultat.");
  return row;
}

export async function deleteDeployment(db: Database, id: string): Promise<void> {
  await db.delete(deployments).where(eq(deployments.id, id));
}

/** Déploiement en cours d'un environnement, s'il date d'après `since`. */
export async function findActiveDeployment(
  db: Database,
  environmentId: string,
  since: Date,
): Promise<Deployment | null> {
  const [row] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, environmentId),
        inArray(deployments.status, ["queued", "running"]),
        gte(sql`coalesce(${deployments.startedAt}, ${deployments.createdAt})`, since),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ActiveDeployment extends Deployment {
  siteId: string;
  companyId: string;
}

/** Déploiements en cours connus de Coolify, pour le suivi de la fiche. */
export async function listActiveSiteDeployments(
  db: Database,
  siteId: string,
): Promise<ActiveDeployment[]> {
  const rows = await db
    .select({
      deployment: deployments,
      siteId: siteEnvironments.siteId,
      companyId: sites.companyId,
    })
    .from(deployments)
    .innerJoin(siteEnvironments, eq(siteEnvironments.id, deployments.environmentId))
    .innerJoin(sites, eq(sites.id, siteEnvironments.siteId))
    .where(
      and(
        eq(siteEnvironments.siteId, siteId),
        inArray(deployments.status, ["queued", "running"]),
        isNotNull(deployments.externalId),
      ),
    );
  return rows.map((row) => ({
    ...row.deployment,
    siteId: row.siteId,
    companyId: row.companyId,
  }));
}

/** Réservations jamais parvenues à Coolify (processus interrompu entre les deux écritures). */
export async function failOrphanReservations(db: Database, olderThan: Date): Promise<number> {
  const rows = await db
    .update(deployments)
    .set({ status: "failed", finishedAt: new Date() })
    .where(
      and(
        eq(deployments.source, "nuera"),
        isNull(deployments.externalId),
        eq(deployments.status, "queued"),
        lt(deployments.createdAt, olderThan),
      ),
    )
    .returning({ id: deployments.id });
  return rows.length;
}

export async function findLastDeployment(
  db: Database,
  siteId: string,
): Promise<DeploymentRow | null> {
  const { items } = await listSiteDeployments(db, siteId, { page: 1, pageSize: 1 });
  return items[0] ?? null;
}

export async function findEnvironmentContext(
  db: Database,
  environmentId: string,
): Promise<{
  environment: SiteEnvironment;
  site: Pick<Site, "id" | "name" | "primaryDomain" | "companyId" | "archivedAt">;
} | null> {
  const [row] = await db
    .select({
      environment: siteEnvironments,
      site: {
        id: sites.id,
        name: sites.name,
        primaryDomain: sites.primaryDomain,
        companyId: sites.companyId,
        archivedAt: sites.archivedAt,
      },
    })
    .from(siteEnvironments)
    .innerJoin(sites, eq(sites.id, siteEnvironments.siteId))
    .where(eq(siteEnvironments.id, environmentId))
    .limit(1);
  return row ?? null;
}

// --- Domaines ----------------------------------------------------------------------------------

export interface DomainRow extends Domain {
  companyName: string;
  siteName: string | null;
  siteArchived: boolean;
}

export async function listSiteDomains(db: Database, siteId: string): Promise<Domain[]> {
  return db.select().from(domains).where(eq(domains.siteId, siteId)).orderBy(asc(domains.name));
}

export async function listDomains(
  db: Database,
  where: { search?: string; expiringBefore?: string; tlsProblems?: boolean },
  params: PageParams,
): Promise<Paginated<DomainRow>> {
  const search = where.search?.trim();
  const pattern = search ? likePattern(search) : null;
  // Un domaine de site archivé reste au registre, mais n'appelle plus aucune action.
  const onlyActive =
    where.expiringBefore || where.tlsProblems ? isNull(sites.archivedAt) : undefined;
  const conditions = and(
    pattern
      ? or(
          ilike(domains.name, pattern),
          ilike(companies.name, pattern),
          ilike(domains.registrar, pattern),
        )
      : undefined,
    where.expiringBefore
      ? or(
          lte(domains.expiresOn, where.expiringBefore),
          lte(domains.tlsExpiresOn, where.expiringBefore),
        )
      : undefined,
    where.tlsProblems ? inArray(domains.tlsStatus, ["expiring", "expired", "error"]) : undefined,
    onlyActive,
  );
  return paginate(params, {
    items: async (limit, offset) => {
      const rows = await db
        .select({
          domain: domains,
          companyName: companies.name,
          siteName: sites.name,
          siteArchivedAt: sites.archivedAt,
        })
        .from(domains)
        .innerJoin(companies, eq(companies.id, domains.companyId))
        .leftJoin(sites, eq(sites.id, domains.siteId))
        .where(conditions)
        .orderBy(sql`${domains.expiresOn} asc nulls last`, asc(domains.name))
        .limit(limit)
        .offset(offset);
      return rows.map((row) => ({
        ...row.domain,
        companyName: row.companyName,
        siteName: row.siteName,
        siteArchived: row.siteArchivedAt !== null,
      }));
    },
    count: async () => {
      const [row] = await db
        .select({ total: count() })
        .from(domains)
        .innerJoin(companies, eq(companies.id, domains.companyId))
        .leftJoin(sites, eq(sites.id, domains.siteId))
        .where(conditions);
      return row?.total ?? 0;
    },
  });
}

export async function findDomainById(db: Database, id: string): Promise<Domain | null> {
  const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
  return row ?? null;
}

export async function findDomainByName(db: Database, name: string): Promise<Domain | null> {
  const [row] = await db.select().from(domains).where(eq(domains.name, name)).limit(1);
  return row ?? null;
}

export async function insertDomain(
  db: Database,
  values: typeof domains.$inferInsert,
): Promise<Domain> {
  const [row] = await db.insert(domains).values(values).returning();
  if (!row) throw new Error("Insertion du domaine sans résultat.");
  return row;
}

export async function updateDomain(
  db: Database,
  id: string,
  values: Partial<typeof domains.$inferInsert>,
): Promise<Domain> {
  const [row] = await db.update(domains).set(values).where(eq(domains.id, id)).returning();
  if (!row) throw new Error("Mise à jour du domaine sans résultat.");
  return row;
}

export async function deleteDomain(db: Database, id: string): Promise<void> {
  await db.delete(domains).where(eq(domains.id, id));
}

/** Hors sites archivés : un site sorti du registre n'alerte plus. */
export async function listExpiringDomains(db: Database, untilDay: string): Promise<Domain[]> {
  const rows = await db
    .select({ domain: domains })
    .from(domains)
    .leftJoin(sites, eq(sites.id, domains.siteId))
    .where(
      and(
        or(lte(domains.expiresOn, untilDay), lte(domains.tlsExpiresOn, untilDay)),
        isNull(sites.archivedAt),
      ),
    )
    .orderBy(asc(domains.expiresOn));
  return rows.map((row) => row.domain);
}

/** Domaines jamais contrôlés ou contrôlés avant `before`, hors sites archivés. */
export async function listDomainsToCheck(
  db: Database,
  before: Date,
  limit: number,
): Promise<Domain[]> {
  const rows = await db
    .select({ domain: domains })
    .from(domains)
    .leftJoin(sites, eq(sites.id, domains.siteId))
    .where(
      and(or(isNull(domains.checkedAt), lt(domains.checkedAt, before)), isNull(sites.archivedAt)),
    )
    .orderBy(sql`${domains.checkedAt} asc nulls first`)
    .limit(limit);
  return rows.map((row) => row.domain);
}

// --- Disponibilité -----------------------------------------------------------------------------

export async function listSiteSamples(
  db: Database,
  siteId: string,
  sinceDay: string,
): Promise<SiteUptimeSample[]> {
  return db
    .select()
    .from(siteUptimeSamples)
    .where(and(eq(siteUptimeSamples.siteId, siteId), gte(siteUptimeSamples.day, sinceDay)))
    .orderBy(asc(siteUptimeSamples.day));
}

export interface UptimeAggregate {
  siteId: string;
  ratio: number | null;
  days: number;
  lastSampleAt: Date | null;
}

export async function aggregateUptime(
  db: Database,
  siteIds: string[],
  sinceDay: string,
): Promise<UptimeAggregate[]> {
  if (siteIds.length === 0) return [];
  const rows = await db
    .select({
      siteId: siteUptimeSamples.siteId,
      ratio: sql<number | null>`avg(${siteUptimeSamples.uptimeRatio})`,
      days: sql<number>`count(${siteUptimeSamples.uptimeRatio})::int`,
      lastSampleAt: sql<Date | string | null>`max(${siteUptimeSamples.checkedAt})`,
    })
    .from(siteUptimeSamples)
    .where(and(inArray(siteUptimeSamples.siteId, siteIds), gte(siteUptimeSamples.day, sinceDay)))
    .groupBy(siteUptimeSamples.siteId);
  return rows.map((row) => ({
    siteId: row.siteId,
    ratio: row.ratio === null ? null : Number(row.ratio),
    days: Number(row.days),
    lastSampleAt: row.lastSampleAt ? new Date(row.lastSampleAt) : null,
  }));
}

export async function upsertUptimeSample(
  db: Database,
  values: {
    siteId: string;
    day: string;
    uptimeRatio: number | null;
    avgResponseMs: number | null;
    checkedAt: Date;
  },
): Promise<void> {
  await db
    .insert(siteUptimeSamples)
    .values(values)
    .onConflictDoUpdate({
      target: [siteUptimeSamples.siteId, siteUptimeSamples.day],
      set: {
        uptimeRatio: values.uptimeRatio,
        avgResponseMs: values.avgResponseMs,
        checkedAt: values.checkedAt,
      },
    });
}

export interface MonitoredSite {
  id: string;
  name: string;
  primaryDomain: string | null;
  companyId: string;
  monitorId: string;
}

const MONITORED_SITE = {
  id: sites.id,
  name: sites.name,
  primaryDomain: sites.primaryDomain,
  companyId: sites.companyId,
  monitorId: sites.monitorId,
};

export async function listMonitoredSites(db: Database): Promise<MonitoredSite[]> {
  const rows = await db
    .select(MONITORED_SITE)
    .from(sites)
    .where(and(isNotNull(sites.monitorId), isNull(sites.archivedAt)));
  return rows.flatMap((row) => (row.monitorId ? [{ ...row, monitorId: row.monitorId }] : []));
}

export async function findMonitoredSiteByMonitorId(
  db: Database,
  monitorId: string,
): Promise<MonitoredSite | null> {
  const [row] = await db
    .select(MONITORED_SITE)
    .from(sites)
    .where(and(eq(sites.monitorId, monitorId), isNull(sites.archivedAt)))
    .limit(1);
  return row?.monitorId ? { ...row, monitorId: row.monitorId } : null;
}

export async function findLastMonitorEvent(
  db: Database,
  siteId: string,
): Promise<{ type: "site.down" | "site.up"; occurredAt: Date } | null> {
  const [row] = await db
    .select({ type: domainEvents.type, occurredAt: domainEvents.occurredAt })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.entityType, "site"),
        inArray(domainEvents.type, ["site.down", "site.up"]),
        eq(domainEvents.entityId, siteId),
      ),
    )
    .orderBy(desc(domainEvents.occurredAt), desc(domainEvents.createdAt))
    .limit(1);
  return row ? { type: row.type as "site.down" | "site.up", occurredAt: row.occurredAt } : null;
}

/** Dernier événement de surveillance par site : `site.down` sans `site.up` depuis = hors ligne. */
export async function listLastMonitorEvents(
  db: Database,
  siteIds: string[],
): Promise<Map<string, "site.down" | "site.up">> {
  if (siteIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([domainEvents.entityId], {
      entityId: domainEvents.entityId,
      type: domainEvents.type,
    })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.entityType, "site"),
        inArray(domainEvents.type, ["site.down", "site.up"]),
        inArray(domainEvents.entityId, siteIds),
      ),
    )
    .orderBy(domainEvents.entityId, desc(domainEvents.occurredAt), desc(domainEvents.createdAt));
  return new Map(rows.map((row) => [row.entityId, row.type as "site.down" | "site.up"]));
}

// --- Sauvegardes -------------------------------------------------------------------------------

export async function listSiteBackups(
  db: Database,
  siteId: string,
  limit: number,
): Promise<SiteBackup[]> {
  return db
    .select()
    .from(siteBackups)
    .where(eq(siteBackups.siteId, siteId))
    .orderBy(sql`${siteBackups.takenAt} desc nulls last`)
    .limit(limit);
}

export async function findManualBackup(
  db: Database,
  values: { siteId: string; takenAt: Date; status: SiteBackup["status"] },
): Promise<SiteBackup | null> {
  const [row] = await db
    .select()
    .from(siteBackups)
    .where(
      and(
        eq(siteBackups.siteId, values.siteId),
        eq(siteBackups.source, "manual"),
        eq(siteBackups.takenAt, values.takenAt),
        eq(siteBackups.status, values.status),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function aggregateBackups(
  db: Database,
  siteId: string,
  since: Date,
): Promise<{ total: number; succeeded: number; offSite: number }> {
  const [row] = await db
    .select({
      total: count(),
      succeeded: sql<number>`count(*) filter (where ${siteBackups.status} = 'succeeded')::int`,
      offSite: sql<number>`count(*) filter (where ${siteBackups.status} = 'succeeded' and ${siteBackups.offSite})::int`,
    })
    .from(siteBackups)
    .where(and(eq(siteBackups.siteId, siteId), gte(siteBackups.takenAt, since)));
  return {
    total: Number(row?.total ?? 0),
    succeeded: Number(row?.succeeded ?? 0),
    offSite: Number(row?.offSite ?? 0),
  };
}

export async function insertBackup(
  db: Database,
  values: typeof siteBackups.$inferInsert,
): Promise<SiteBackup> {
  const [row] = await db.insert(siteBackups).values(values).returning();
  if (!row) throw new Error("Insertion de la sauvegarde sans résultat.");
  return row;
}

export async function findBackupByExternalId(
  db: Database,
  siteId: string,
  externalId: string,
): Promise<SiteBackup | null> {
  const [row] = await db
    .select()
    .from(siteBackups)
    .where(and(eq(siteBackups.siteId, siteId), eq(siteBackups.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

export async function updateBackup(
  db: Database,
  id: string,
  values: Partial<typeof siteBackups.$inferInsert>,
): Promise<SiteBackup> {
  const [row] = await db.update(siteBackups).set(values).where(eq(siteBackups.id, id)).returning();
  if (!row) throw new Error("Mise à jour de la sauvegarde sans résultat.");
  return row;
}

export interface FailedBackupRow {
  id: string;
  siteId: string;
  siteName: string;
  companyId: string;
  environmentId: string | null;
  takenAt: Date | null;
}

export async function listFailedBackups(db: Database, since: Date): Promise<FailedBackupRow[]> {
  return db
    .select({
      id: siteBackups.id,
      siteId: siteBackups.siteId,
      siteName: sites.name,
      companyId: sites.companyId,
      environmentId: siteBackups.environmentId,
      takenAt: siteBackups.takenAt,
    })
    .from(siteBackups)
    .innerJoin(sites, eq(sites.id, siteBackups.siteId))
    .where(
      and(
        eq(siteBackups.status, "failed"),
        gte(siteBackups.takenAt, since),
        isNull(sites.archivedAt),
      ),
    )
    .orderBy(desc(siteBackups.takenAt));
}

// --- Incidents ---------------------------------------------------------------------------------

export interface SiteIncidentRow {
  id: string;
  number: string;
  subject: string;
  status: string;
  severity: string;
  createdAt: Date;
}

/** Lecture seule des tickets d'incident d'un site, pour la fiche. */
export async function listSiteIncidents(
  db: Database,
  siteId: string,
  limit: number,
): Promise<SiteIncidentRow[]> {
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      severity: tickets.severity,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(
      and(eq(tickets.siteId, siteId), eq(tickets.isIncident, true), isNull(tickets.archivedAt)),
    )
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
}

export async function countSiteIncidents(
  db: Database,
  siteId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(tickets)
    .where(
      and(
        eq(tickets.siteId, siteId),
        eq(tickets.isIncident, true),
        gte(tickets.createdAt, since),
        isNull(tickets.archivedAt),
      ),
    );
  return Number(row?.total ?? 0);
}

// --- Santé (tableau de bord) -------------------------------------------------------------------

export interface HealthRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: SiteStatus;
  productionStatus: EnvironmentStatus | null;
  productionCheckedAt: Date | null;
}

export async function listLiveSitesForHealth(db: Database): Promise<HealthRow[]> {
  return db
    .select({
      id: sites.id,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      status: sites.status,
      productionStatus: siteEnvironments.status,
      productionCheckedAt: siteEnvironments.statusCheckedAt,
    })
    .from(sites)
    .leftJoin(
      siteEnvironments,
      and(eq(siteEnvironments.siteId, sites.id), eq(siteEnvironments.kind, "production")),
    )
    .where(and(eq(sites.status, "live"), isNull(sites.archivedAt)))
    .orderBy(asc(sites.name));
}

// --- Traces de synchronisation et état des connexions ------------------------------------------

export async function startSyncRun(
  db: Database,
  service: IntegrationService,
  scope: string,
): Promise<SyncRun> {
  const [row] = await db.insert(syncRuns).values({ service, scope }).returning();
  if (!row) throw new Error("Trace de synchronisation sans résultat.");
  return row;
}

export async function finishSyncRun(
  db: Database,
  id: string,
  values: { status: "succeeded" | "failed"; items: number; error: string | null },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ ...values, finishedAt: new Date() })
    .where(eq(syncRuns.id, id));
}

export async function findLastSyncRuns(
  db: Database,
  service: IntegrationService,
): Promise<{ last: SyncRun | null; lastSuccess: SyncRun | null }> {
  const [last] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.service, service), ne(syncRuns.status, "running")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  const [lastSuccess] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.service, service), eq(syncRuns.status, "succeeded")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return { last: last ?? null, lastSuccess: lastSuccess ?? null };
}

/** Met à jour l'état lu par l'écran des connexions, sans toucher à `details`. */
export async function recordIntegrationCheck(
  db: Database,
  service: IntegrationService,
  values: { status: IntegrationStatus; checkedAt: Date; error: string | null },
): Promise<void> {
  const success = values.status === "connected" ? { lastSuccessAt: values.checkedAt } : {};
  await db
    .insert(integrationConnections)
    .values({
      service,
      status: values.status,
      lastCheckAt: values.checkedAt,
      lastError: values.error,
      ...success,
    })
    .onConflictDoUpdate({
      target: integrationConnections.service,
      set: {
        status: values.status,
        lastCheckAt: values.checkedAt,
        lastError: values.error,
        ...success,
      },
    });
}

/**
 * Vrai si la notification est à traiter : reçu nouveau, ou reçu en échec que l'expéditeur renvoie.
 * Une notification déjà traitée ne l'est pas deux fois.
 */
export async function claimWebhookReceipt(
  db: Database,
  service: IntegrationService,
  externalId: string,
): Promise<boolean> {
  const rows = await db
    .insert(webhookReceipts)
    .values({ service, externalId })
    .onConflictDoUpdate({
      target: [webhookReceipts.service, webhookReceipts.externalId],
      set: { status: "received" },
      where: eq(webhookReceipts.status, "failed"),
    })
    .returning({ id: webhookReceipts.id });
  return rows.length > 0;
}

export async function setWebhookReceiptStatus(
  db: Database,
  service: IntegrationService,
  externalId: string,
  status: WebhookReceiptStatus,
): Promise<void> {
  await db
    .update(webhookReceipts)
    .set({ status })
    .where(and(eq(webhookReceipts.service, service), eq(webhookReceipts.externalId, externalId)));
}
