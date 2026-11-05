import type { CmsKind, EnvironmentStatus, SiteKind, SiteStatus } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { activateContractsForSite } from "@/modules/contracts/contract.service";
import {
  getCompanyRef,
  listCompanyOptions,
  type CompanyOption,
} from "@/modules/crm/company.lookup";
import { emitEvent } from "@/modules/platform/events";
import { listAssignableMembers, type MemberOption } from "@/modules/team/team.lookup";
import { assertCan, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type {
  Domain,
  Site,
  SiteBackup,
  SiteEnvironment,
  SiteUptimeSample,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import {
  addDays,
  liveCheck,
  parisDay,
  uptimeDayState,
  type SiteHealthSignal,
  type UptimeDayState,
} from "./site.health";
import * as repository from "./site.repository";
import {
  changeSiteStatusSchema,
  createSiteSchema,
  environmentSchema,
  siteIdSchema,
  siteListQuerySchema,
  updateSiteSchema,
  type SiteListQuery,
} from "./site.schema";
import { assertSiteTransition } from "./site.status";

export { listFailedBackups } from "./backup.service";
export { listExpiringDomains } from "./domain.service";

const HISTORY_DAYS = 30;

export interface SiteSummary extends repository.SiteListRow, SiteHealthSignal {
  uptimeRatio: number | null;
  uptimeDays: number;
  productionUrl: string | null;
  stagingUrl: string | null;
}

async function enrichRows(
  db: Database,
  rows: repository.SiteListRow[],
  now: Date,
): Promise<SiteSummary[]> {
  const ids = rows.map((row) => row.id);
  const sinceDay = addDays(parisDay(now), -(HISTORY_DAYS - 1));
  const [environments, uptime, events] = await Promise.all([
    repository.listEnvironments(db, ids),
    repository.aggregateUptime(db, ids, sinceDay),
    repository.listLastMonitorEvents(db, ids),
  ]);
  const uptimeBySite = new Map(uptime.map((entry) => [entry.siteId, entry]));

  return rows.map((row) => {
    const own = environments.filter((environment) => environment.siteId === row.id);
    const production = own.find((environment) => environment.kind === "production");
    const staging = own.find((environment) => environment.kind === "staging");
    const sample = uptimeBySite.get(row.id);
    return {
      ...row,
      isDown: events.get(row.id) === "site.down",
      productionStatus: production?.status ?? null,
      productionCheckedAt: production?.statusCheckedAt ?? null,
      productionUrl: production?.url ?? null,
      stagingUrl: staging?.url ?? null,
      lastSampleAt: sample?.lastSampleAt ?? null,
      uptimeRatio: sample?.ratio ?? null,
      uptimeDays: sample?.days ?? 0,
    };
  });
}

const FILTER_TO_WHERE = {
  live: { status: "live" },
  staging: { status: "staging" },
  hosted: { hostedByNuera: true },
} as const satisfies Record<string, Partial<repository.SiteListWhere>>;

export async function listSites(
  ctx: ServiceContext,
  rawQuery: unknown,
  params: PageParams,
  now: Date = new Date(),
): Promise<Paginated<SiteSummary>> {
  assertCan(ctx.actor, "sites:read");
  const query: SiteListQuery = parseInput(siteListQuerySchema, rawQuery);
  const { filter } = query;
  const result = await repository.listSites(
    ctx.db,
    {
      search: query.search,
      companyId: query.companyId,
      cmsKind: query.cmsKind,
      environmentStatus: query.environmentStatus,
      archived: filter === "archived",
      ...(filter && filter !== "archived" ? FILTER_TO_WHERE[filter] : {}),
    },
    params,
    { key: query.sort ?? "name", direction: query.direction ?? "asc" },
  );
  return { ...result, items: await enrichRows(ctx.db, result.items, now) };
}

export async function getSitesOverview(ctx: ServiceContext): Promise<{
  total: number;
  byStatus: Partial<Record<SiteStatus, number>>;
}> {
  assertCan(ctx.actor, "sites:read");
  const rows = await repository.countSitesByStatus(ctx.db);
  return {
    total: rows.reduce((total, row) => total + Number(row.total), 0),
    byStatus: Object.fromEntries(rows.map((row) => [row.status, Number(row.total)])),
  };
}

/** Résumé en une ligne de l'en-tête (écran 10), calculé en base. */
export function summarizeSites(overview: {
  total: number;
  byStatus: Partial<Record<SiteStatus, number>>;
}): string {
  const { total, byStatus } = overview;
  if (total === 0) return "Aucun site enregistré";
  const parts = [`${total} site${total > 1 ? "s" : ""}`];
  if (byStatus.live) parts.push(`${byStatus.live} en ligne`);
  if (byStatus.staging) parts.push(`${byStatus.staging} en préproduction`);
  if (byStatus.planned) parts.push(`${byStatus.planned} prévu${byStatus.planned > 1 ? "s" : ""}`);
  if (byStatus.paused) parts.push(`${byStatus.paused} en pause`);
  return parts.join(" · ");
}

export interface SiteDetail {
  site: Site;
  relations: repository.SiteRelations;
  environments: SiteEnvironment[];
  domains: Domain[];
  primaryDomain: Domain | null;
  isDown: boolean;
  lastSampleAt: Date | null;
}

/** Contrôle léger, au-dessus du squelette de chargement. `NotFoundError` si le site n'existe pas. */
export async function assertSiteExists(ctx: ServiceContext, rawId: unknown): Promise<void> {
  assertCan(ctx.actor, "sites:read");
  const { id } = parseInput(siteIdSchema, { id: rawId });
  if (!(await repository.findSiteById(ctx.db, id))) throw new NotFoundError("Site introuvable.");
}

/** Fiche d'un site : 404 si le site n'existe pas. */
export async function getSite(ctx: ServiceContext, rawId: unknown): Promise<SiteDetail> {
  assertCan(ctx.actor, "sites:read");
  const { id } = parseInput(siteIdSchema, { id: rawId });
  const site = await repository.findSiteById(ctx.db, id);
  if (!site) throw new NotFoundError("Site introuvable.");

  const [relations, environments, domains, events, uptime] = await Promise.all([
    repository.findSiteRelations(ctx.db, site),
    repository.listEnvironments(ctx.db, [id]),
    repository.listSiteDomains(ctx.db, id),
    repository.listLastMonitorEvents(ctx.db, [id]),
    repository.aggregateUptime(ctx.db, [id], addDays(parisDay(new Date()), -(HISTORY_DAYS - 1))),
  ]);

  return {
    site,
    relations,
    environments,
    domains,
    primaryDomain:
      domains.find((domain) => domain.name === site.primaryDomain) ?? domains[0] ?? null,
    isDown: events.get(id) === "site.down",
    lastSampleAt: uptime[0]?.lastSampleAt ?? null,
  };
}

// --- Formulaire --------------------------------------------------------------------------------

export interface SiteFormOptions {
  companies: CompanyOption[];
  members: MemberOption[];
}

export async function getSiteFormOptions(ctx: ServiceContext): Promise<SiteFormOptions> {
  assertCan(ctx.actor, "sites:read");
  const [companies, members] = await Promise.all([
    listCompanyOptions(ctx.db),
    listAssignableMembers(ctx.db),
  ]);
  return { companies, members };
}

export interface CompanyLinkOptions {
  projects: repository.LinkOption[];
  contracts: repository.LinkOption[];
  sites: repository.LinkOption[];
}

export async function getCompanyLinkOptions(
  ctx: ServiceContext,
  rawCompanyId: unknown,
): Promise<CompanyLinkOptions> {
  assertCan(ctx.actor, "sites:read");
  const companyId = parseInput(z.uuid(), rawCompanyId);
  const [projects, contracts, sites] = await Promise.all([
    repository.listCompanyProjectOptions(ctx.db, companyId),
    repository.listCompanyContractOptions(ctx.db, companyId),
    repository.listCompanySiteOptions(ctx.db, companyId),
  ]);
  return { projects, contracts, sites };
}

// --- Création et modification ------------------------------------------------------------------

async function assertLinksBelongToCompany(
  db: Database,
  companyId: string,
  links: { projectId: string | null; contractId: string | null },
): Promise<void> {
  if (
    links.projectId &&
    !(await repository.projectBelongsToCompany(db, links.projectId, companyId))
  ) {
    throw new ValidationError("Certaines informations sont invalides.", {
      projectId: ["Ce projet n'appartient pas à ce client."],
    });
  }
  if (
    links.contractId &&
    !(await repository.contractBelongsToCompany(db, links.contractId, companyId))
  ) {
    throw new ValidationError("Certaines informations sont invalides.", {
      contractId: ["Ce contrat n'appartient pas à ce client."],
    });
  }
}

/** Un responsable se choisit parmi l'équipe active. Celui déjà en place reste accepté s'il part. */
async function assertOwnerAssignable(
  db: Database,
  ownerMemberId: string | null,
  currentOwnerId: string | null,
): Promise<void> {
  if (!ownerMemberId || ownerMemberId === currentOwnerId) return;
  const members = await listAssignableMembers(db);
  if (!members.some((member) => member.id === ownerMemberId)) {
    throw new ValidationError("Certaines informations sont invalides.", {
      ownerMemberId: ["Cette personne ne fait pas partie de l'équipe active."],
    });
  }
}

/** Une sonde mesure un seul site : deux sites liés, et la panne de l'un s'écrirait sur l'autre. */
async function assertMonitorFree(
  db: Database,
  monitorId: string | null,
  siteId: string | null,
): Promise<void> {
  if (!monitorId) return;
  const holder = await repository.findMonitoredSiteByMonitorId(db, monitorId);
  if (holder && holder.id !== siteId) {
    throw new ConflictError("Cette sonde est déjà reliée à un autre site.", {
      monitorId: [`Déjà reliée à ${holder.name}.`],
    });
  }
}

/**
 * Le domaine principal a sa fiche (registrar, échéances, HTTPS). S'il existe déjà sans site et chez
 * le même client, il est rattaché ; chez un autre client, il est refusé.
 */
async function ensurePrimaryDomain(tx: Database, site: Site, actorId: string): Promise<void> {
  if (!site.primaryDomain) return;
  const existing = await repository.findDomainByName(tx, site.primaryDomain);
  if (!existing) {
    const domain = await repository.insertDomain(tx, {
      companyId: site.companyId,
      siteId: site.id,
      name: site.primaryDomain,
    });
    await recordAudit(tx, {
      actorId,
      action: "domain.created",
      entityType: "domain",
      entityId: domain.id,
      metadata: { name: domain.name, siteId: site.id },
    });
    return;
  }
  if (existing.companyId !== site.companyId) {
    throw new ConflictError("Ce domaine appartient déjà à un autre client.", {
      primaryDomain: ["Ce domaine appartient déjà à un autre client."],
    });
  }
  if (existing.siteId && existing.siteId !== site.id) {
    throw new ConflictError("Ce domaine est déjà rattaché à un autre site.", {
      primaryDomain: ["Ce domaine est déjà rattaché à un autre site."],
    });
  }
  if (!existing.siteId) await repository.updateDomain(tx, existing.id, { siteId: site.id });
}

export async function createSite(ctx: ServiceContext, input: unknown): Promise<Site> {
  assertCan(ctx.actor, "sites:create");
  const values = parseInput(createSiteSchema, input);

  const company = await getCompanyRef(ctx.db, values.companyId);
  if (!company || company.archivedAt || company.mergedIntoId) {
    throw new ValidationError("Certaines informations sont invalides.", {
      companyId: ["Ce client n'existe pas ou n'est plus actif."],
    });
  }
  await assertLinksBelongToCompany(ctx.db, values.companyId, values);
  await assertOwnerAssignable(ctx.db, values.ownerMemberId, null);
  await assertMonitorFree(ctx.db, values.monitorId, null);

  return ctx.db.transaction(async (tx) => {
    const site = await repository.insertSite(tx, values);
    await ensurePrimaryDomain(tx, site, ctx.actor.userId);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "site.created",
      entityType: "site",
      entityId: site.id,
      metadata: { name: site.name, companyId: site.companyId },
    });
    return site;
  });
}

export async function updateSite(ctx: ServiceContext, input: unknown): Promise<Site> {
  assertCan(ctx.actor, "sites:update");
  const { id, ...values } = parseInput(updateSiteSchema, input);

  const current = await repository.findSiteById(ctx.db, id);
  if (!current) throw new NotFoundError("Site introuvable.");
  if (current.archivedAt) throw new ConflictError("Ce site est archivé : restaurez-le d'abord.");
  await assertLinksBelongToCompany(ctx.db, current.companyId, values);
  await assertOwnerAssignable(ctx.db, values.ownerMemberId, current.ownerMemberId);
  await assertMonitorFree(ctx.db, values.monitorId, id);

  return ctx.db.transaction(async (tx) => {
    const site = await repository.updateSite(tx, id, values);
    if (site.primaryDomain !== current.primaryDomain) {
      await ensurePrimaryDomain(tx, site, ctx.actor.userId);
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "site.updated",
      entityType: "site",
      entityId: id,
      metadata: { name: site.name },
    });
    return site;
  });
}

async function emitSiteLive(tx: Database, site: Site, actorId: string): Promise<void> {
  await emitEvent(tx, {
    type: "site.live",
    entityType: "site",
    entityId: site.id,
    companyId: site.companyId,
    payload: { name: site.name, primaryDomain: site.primaryDomain },
    actorId,
    dedupeKey: `site.live:${site.id}`,
  });
}

/**
 * Change le statut par la machine à états. `live` pose la date de mise en ligne à la première fois ;
 * `archived` pose `archived_at` : un site n'est jamais supprimé.
 */
export async function changeSiteStatus(ctx: ServiceContext, input: unknown): Promise<Site> {
  assertCan(ctx.actor, "sites:update");
  const { id, status } = parseInput(changeSiteStatusSchema, input);
  if (status === "archived") assertCan(ctx.actor, "sites:archive");

  return ctx.db.transaction(async (tx) => {
    const current = await repository.findSiteByIdForUpdate(tx, id);
    if (!current) throw new NotFoundError("Site introuvable.");
    if (current.status === status) return current;
    assertSiteTransition(current.status, status);

    const now = new Date();
    const site = await repository.updateSite(tx, id, {
      status,
      archivedAt: status === "archived" ? now : null,
      ...(status === "live" && !current.liveOn ? { liveOn: parisDay(now) } : {}),
    });

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: status === "archived" ? "site.archived" : "site.status_changed",
      entityType: "site",
      entityId: id,
      metadata: { from: current.status, to: status },
    });
    if (status === "live") {
      await emitSiteLive(tx, site, ctx.actor.userId);
      await activateContractsForSite(tx, { siteId: id, actorId: ctx.actor.userId, now });
    }
    return site;
  });
}

export interface ActivateSiteAfterGoLiveInput {
  projectId: string;
  siteId: string;
}

const activateSchema = z.object({ projectId: z.uuid(), siteId: z.uuid() });

/**
 * Passe le site en ligne à la fin d'un projet (parcours 2), dans la transaction de l'appelant.
 * Idempotent : un site déjà en ligne n'émet rien de plus. Un site rattaché à un autre projet est
 * refusé ; sans projet, il est rattaché s'il appartient au même client, y compris s'il est déjà en
 * ligne : c'est le lien entre le projet livré et son site.
 */
export async function activateSiteAfterGoLive(
  ctx: ServiceContext,
  tx: Database,
  input: ActivateSiteAfterGoLiveInput,
): Promise<void> {
  assertCan(ctx.actor, "sites:update");
  const { projectId, siteId } = parseInput(activateSchema, input);

  const current = await repository.findSiteByIdForUpdate(tx, siteId);
  if (!current) throw new NotFoundError("Site introuvable.");
  if (current.projectId && current.projectId !== projectId) {
    throw new ConflictError("Ce site est rattaché à un autre projet.");
  }
  if (
    !current.projectId &&
    !(await repository.projectBelongsToCompany(tx, projectId, current.companyId))
  ) {
    throw new ConflictError("Ce projet n'appartient pas au client de ce site.");
  }
  if (current.status === "live") {
    // Un contrat lié après la mise en ligne démarre avec la livraison du projet.
    await activateContractsForSite(tx, { siteId, actorId: ctx.actor.userId });
    if (current.projectId) return;
    await repository.updateSite(tx, siteId, { projectId });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "site.activated",
      entityType: "site",
      entityId: siteId,
      metadata: { projectId, from: current.status },
    });
    return;
  }
  assertSiteTransition(current.status, "live");

  const site = await repository.updateSite(tx, siteId, {
    status: "live",
    projectId,
    archivedAt: null,
    liveOn: current.liveOn ?? parisDay(new Date()),
  });
  await recordAudit(tx, {
    actorId: ctx.actor.userId,
    action: "site.activated",
    entityType: "site",
    entityId: siteId,
    metadata: { projectId, from: current.status },
  });
  await emitSiteLive(tx, site, ctx.actor.userId);
  await activateContractsForSite(tx, { siteId, actorId: ctx.actor.userId });
}

// --- Environnements ----------------------------------------------------------------------------

/** Déclare ou modifie un environnement. Changer d'application efface l'état relu de l'ancienne. */
export async function saveEnvironment(
  ctx: ServiceContext,
  input: unknown,
): Promise<SiteEnvironment> {
  assertCan(ctx.actor, "sites:update");
  const values = parseInput(environmentSchema, input);

  const site = await repository.findSiteById(ctx.db, values.siteId);
  if (!site) throw new NotFoundError("Site introuvable.");
  if (site.archivedAt) throw new ConflictError("Ce site est archivé.");
  if (values.coolifyAppUuid) {
    // Deux environnements sur une même application : le déploiement de l'un partirait sur l'autre.
    const holder = await repository.findEnvironmentByCoolifyApp(ctx.db, values.coolifyAppUuid);
    if (holder && (holder.siteId !== values.siteId || holder.kind !== values.kind)) {
      throw new ConflictError("Cette application est déjà reliée à un autre environnement.", {
        coolifyAppUuid: ["Cette application est déjà reliée à un autre environnement."],
      });
    }
  }

  return ctx.db.transaction(async (tx) => {
    const current = await repository.findEnvironmentByKind(tx, values.siteId, values.kind);
    const sameApplication = current?.coolifyAppUuid === values.coolifyAppUuid;
    const environment = await repository.upsertEnvironment(tx, {
      ...values,
      status: sameApplication && current ? current.status : "unknown",
      statusCheckedAt: sameApplication && current ? current.statusCheckedAt : null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "site_environment.updated",
      entityType: "site_environment",
      entityId: environment.id,
      metadata: {
        siteId: values.siteId,
        kind: values.kind,
        coolifyAppUuid: values.coolifyAppUuid,
      },
    });
    return environment;
  });
}

// --- Santé -------------------------------------------------------------------------------------

export interface UptimeDayRow {
  day: string;
  state: UptimeDayState;
  ratio: number | null;
  avgResponseMs: number | null;
}

export interface SiteHealth {
  days: UptimeDayRow[];
  measuredDays: number;
  /** Moyenne des jours mesurés, entre 0 et 1. `null` : aucune mesure. */
  uptimeRatio: number | null;
  avgResponseMs: number | null;
  /** `null` : aucune mesure. Uptime Kuma n'expose pas cette donnée sur ses routes publiques. */
  serverErrors: number | null;
  daysWithServerErrors: number;
  backups: { total: number; succeeded: number; offSite: number };
  incidents: number;
  lastSampleAt: Date | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildHealth(
  samples: SiteUptimeSample[],
  firstDay: string,
): Omit<SiteHealth, "backups" | "incidents"> {
  const byDay = new Map(samples.map((sample) => [sample.day, sample]));
  const days: UptimeDayRow[] = Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const day = addDays(firstDay, index);
    const sample = byDay.get(day);
    return {
      day,
      state: uptimeDayState(sample),
      ratio: sample?.uptimeRatio ?? null,
      avgResponseMs: sample?.avgResponseMs ?? null,
    };
  });

  const ratios = samples.flatMap((s) => (s.uptimeRatio === null ? [] : [s.uptimeRatio]));
  const responses = samples.flatMap((s) => (s.avgResponseMs === null ? [] : [s.avgResponseMs]));
  const errors = samples.flatMap((s) => (s.serverErrors === null ? [] : [s.serverErrors]));
  const checkedAt = samples.flatMap((s) => (s.checkedAt ? [s.checkedAt.getTime()] : []));
  const avgResponse = mean(responses);

  return {
    days,
    measuredDays: ratios.length,
    uptimeRatio: mean(ratios),
    avgResponseMs: avgResponse === null ? null : Math.round(avgResponse),
    serverErrors: errors.length > 0 ? errors.reduce((total, value) => total + value, 0) : null,
    daysWithServerErrors: errors.filter((value) => value > 0).length,
    lastSampleAt: checkedAt.length > 0 ? new Date(Math.max(...checkedAt)) : null,
  };
}

/** Fenêtre « Santé du site » (M3) : uniquement des échantillons réels, jour par jour. */
export async function getSiteHealth(
  ctx: ServiceContext,
  rawId: unknown,
  now: Date = new Date(),
): Promise<SiteHealth> {
  assertCan(ctx.actor, "sites:read");
  const { id } = parseInput(siteIdSchema, { id: rawId });
  const site = await repository.findSiteById(ctx.db, id);
  if (!site) throw new NotFoundError("Site introuvable.");

  const today = parisDay(now);
  const firstDay = addDays(today, -(HISTORY_DAYS - 1));
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const [samples, backups, incidents] = await Promise.all([
    repository.listSiteSamples(ctx.db, id, firstDay),
    repository.aggregateBackups(ctx.db, id, since),
    repository.countSiteIncidents(ctx.db, id, since),
  ]);
  return { ...buildHealth(samples, firstDay), backups, incidents };
}

export async function listRecentBackups(
  ctx: ServiceContext,
  rawId: unknown,
  limit = 5,
): Promise<SiteBackup[]> {
  assertCan(ctx.actor, "sites:read");
  const { id } = parseInput(siteIdSchema, { id: rawId });
  return repository.listSiteBackups(ctx.db, id, limit);
}

/** Incidents liés au site. Vide sans `support:read` : la fiche reste lisible sans ce droit. */
export async function listSiteIncidents(
  ctx: ServiceContext,
  rawId: unknown,
  limit = 5,
): Promise<repository.SiteIncidentRow[]> {
  assertCan(ctx.actor, "sites:read");
  if (!can(ctx.actor, "support:read")) return [];
  const { id } = parseInput(siteIdSchema, { id: rawId });
  return repository.listSiteIncidents(ctx.db, id, limit);
}

// --- Lectures pour les autres lots -------------------------------------------------------------

export interface CompanySiteRow {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: SiteStatus;
  kind: SiteKind | null;
  cmsKind: CmsKind | null;
  hostingLabel: string | null;
  liveOn: string | null;
  productionStatus: EnvironmentStatus | null;
  productionCheckedAt: Date | null;
  uptimeRatio: number | null;
  domainExpiresOn: string | null;
  check: "up" | "down" | "unverified" | null;
}

/** Fiche client 360° : sites du client, en lignes compactes, avec l'état réel. */
export async function listSitesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanySiteRow[]> {
  assertCan(ctx.actor, "sites:read");
  const now = new Date();
  const { items } = await repository.listSites(
    ctx.db,
    { companyId: parseInput(z.uuid(), companyId), archived: false },
    { page: 1, pageSize: Math.min(options.limit ?? 20, 100) },
    { key: "name", direction: "asc" },
  );
  const rows = await enrichRows(ctx.db, items, now);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    primaryDomain: row.primaryDomain,
    status: row.status,
    kind: row.kind,
    cmsKind: row.cmsKind,
    hostingLabel: row.hostingLabel,
    liveOn: row.liveOn,
    productionStatus: row.productionStatus,
    productionCheckedAt: row.productionCheckedAt ? new Date(row.productionCheckedAt) : null,
    uptimeRatio: row.uptimeRatio,
    domainExpiresOn: row.domainExpiresOn,
    check: row.status === "live" ? liveCheck(row, now) : null,
  }));
}

export interface SitesHealthSummary {
  total: number;
  live: number;
  up: number;
  down: number;
  /** Sites en ligne sans mesure récente : jamais comptés comme « up ». */
  unverified: number;
  /** Date de la mesure la plus récente, tous sites confondus. */
  lastCheckedAt: Date | null;
  /** Hors ligne d'abord, puis disponibilité croissante : la tuile « État des sites ». */
  rows: {
    id: string;
    name: string;
    primaryDomain: string | null;
    check: "up" | "down" | "unverified";
    uptimeRatio: number | null;
    checkedAt: Date | null;
  }[];
}

const CHECK_ORDER = { down: 0, unverified: 1, up: 2 } as const;

/** Pour le tableau de bord. Sans contrôle d'accès : l'appelant a déjà vérifié ses droits. */
export async function getSitesHealthSummary(
  db: Database,
  now: Date = new Date(),
): Promise<SitesHealthSummary> {
  const [liveSites, byStatus] = await Promise.all([
    repository.listLiveSitesForHealth(db),
    repository.countSitesByStatus(db),
  ]);
  const ids = liveSites.map((site) => site.id);
  const [uptime, events] = await Promise.all([
    repository.aggregateUptime(db, ids, addDays(parisDay(now), -(HISTORY_DAYS - 1))),
    repository.listLastMonitorEvents(db, ids),
  ]);
  const uptimeBySite = new Map(uptime.map((entry) => [entry.siteId, entry]));

  const rows = liveSites.map((site) => {
    const sample = uptimeBySite.get(site.id);
    const check = liveCheck(
      {
        status: site.status,
        isDown: events.get(site.id) === "site.down",
        productionStatus: site.productionStatus,
        productionCheckedAt: site.productionCheckedAt,
        lastSampleAt: sample?.lastSampleAt ?? null,
      },
      now,
    );
    const moments = [sample?.lastSampleAt, site.productionCheckedAt].flatMap((date) =>
      date ? [new Date(date).getTime()] : [],
    );
    return {
      id: site.id,
      name: site.name,
      primaryDomain: site.primaryDomain,
      check,
      uptimeRatio: sample?.ratio ?? null,
      checkedAt: moments.length > 0 ? new Date(Math.max(...moments)) : null,
    };
  });
  rows.sort(
    (a, b) =>
      CHECK_ORDER[a.check] - CHECK_ORDER[b.check] || (a.uptimeRatio ?? 2) - (b.uptimeRatio ?? 2),
  );

  const times = rows.flatMap((row) => (row.checkedAt ? [row.checkedAt.getTime()] : []));
  return {
    total: byStatus.reduce((total, row) => total + Number(row.total), 0),
    live: rows.length,
    up: rows.filter((row) => row.check === "up").length,
    down: rows.filter((row) => row.check === "down").length,
    unverified: rows.filter((row) => row.check === "unverified").length,
    lastCheckedAt: times.length > 0 ? new Date(Math.max(...times)) : null,
    rows,
  };
}
