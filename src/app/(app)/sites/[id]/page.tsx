import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { UptimeBars, type UptimeDay } from "@/components/charts/uptime-bars";
import { PageHeader } from "@/components/layout/page-header";
import {
  ConnectionRequired,
  EmptyState,
  ForbiddenState,
  StaleData,
} from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonExternalLink, ButtonLink } from "@/components/ui/button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { InfoCard, InfoRow } from "@/components/ui/info-card";
import { KpiCard, KpiGrid, type NoteTone } from "@/components/ui/kpi-card";
import {
  CMS_KIND_LABELS,
  DEPLOYMENT_STATUS_LABELS,
  ENVIRONMENT_KIND_LABELS,
  ENVIRONMENT_KINDS,
  SITE_KIND_LABELS,
} from "@/lib/domain-enums";
import {
  daysFromNow,
  formatDate,
  formatDateNumeric,
  formatDateShort,
  formatDateTime,
  formatPercent,
  formatRelativeDate,
  formatRelativeTime,
  formatTime,
} from "@/lib/format";
import { paramValue } from "@/lib/url-state";
import { listKnowledgeArticles } from "@/modules/documents/knowledge.service";
import { BackupFormButton } from "@/modules/sites/components/backup-form";
import { DeployButton } from "@/modules/sites/components/deploy-button";
import { DeploymentWatcher } from "@/modules/sites/components/deployment-watcher";
import {
  DeleteDomainButton,
  DomainFormButton,
  TlsCheckButton,
} from "@/modules/sites/components/domain-controls";
import { EnvironmentFormButton } from "@/modules/sites/components/environment-form";
import { HealthWindow } from "@/modules/sites/components/health-window";
import { SiteFormButton } from "@/modules/sites/components/site-form";
import { SiteLifecycle } from "@/modules/sites/components/site-lifecycle";
import { SyncLine } from "@/modules/sites/components/sync-strip";
import {
  listBusyEnvironmentIds,
  listSiteDeployments,
  type DeploymentRow,
} from "@/modules/sites/deployment.service";
import {
  environmentBadge,
  EXPIRY_WARNING_DAYS,
  formatBytes,
  formatDurationSeconds,
  isStale,
  SAMPLE_STALE_AFTER_MS,
  siteHealthBadge,
  tlsBadge,
} from "@/modules/sites/site.health";
import {
  getSite,
  getSiteFormOptions,
  getSiteHealth,
  listRecentBackups,
  listSiteIncidents,
  type UptimeDayRow,
} from "@/modules/sites/site.service";
import { getConsoleLinks, getSitesIntegrationState } from "@/modules/sites/sync.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination } from "@/server/pagination";

export const metadata = { title: "Site" };

const DEPLOYMENTS_PER_PAGE = 10;

async function loadSite(ctx: ServiceContext, id: string) {
  try {
    return await getSite(ctx, id);
  } catch (error) {
    // Identifiant illisible ou objet inconnu : même réponse, rien n'est révélé.
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  }
}

function toUptimeDay(day: UptimeDayRow): UptimeDay {
  return {
    label: formatDateShort(day.day),
    tooltipLabel: formatDate(day.day),
    state: day.state,
    ...(day.ratio === null ? {} : { ratio: day.ratio * 100 }),
  };
}

/** La ligne sous les barres : le dernier jour qui mérite un mot, ou ce qui manque. */
function uptimeNote(days: UptimeDayRow[], measured: number, now: Date): string {
  if (measured === 0) return "Aucune mesure sur 30 jours.";
  const last = [...days].reverse().find((day) => day.state === "down" || day.state === "slow");
  const coverage = measured < days.length ? `${measured} jours mesurés sur 30. ` : "";
  if (!last) return `${coverage}Aucune coupure ni lenteur mesurée.`;
  const when = formatRelativeDate(last.day, now);
  const what =
    last.state === "down"
      ? `coupure, ${formatPercent((last.ratio ?? 0) * 100, 2)} de disponibilité`
      : `temps de réponse lent, ${last.avgResponseMs ?? "—"} ms en moyenne (pas de coupure)`;
  return `${coverage}${when.charAt(0).toUpperCase()}${when.slice(1)} : ${what}.`;
}

function backupMoment(date: Date | null, now: Date): string {
  if (!date) return "—";
  const days = daysFromNow(date, now);
  if (days === 0) return `aujourd'hui ${formatTime(date)}`;
  if (days === -1) return `hier ${formatTime(date)}`;
  return `${formatDateShort(date)} ${formatTime(date)}`;
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

function RelationLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="hit-44 text-text hover:text-accent hover:underline">
      {children}
    </Link>
  );
}

function ExternalRelation({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="hit-44 text-accent hover:underline hover:underline-offset-4"
    >
      {children}
    </a>
  );
}

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "sites:read")) {
    return (
      <>
        <PageHeader title="Site" />
        <ForbiddenState />
      </>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  const detail = await loadSite(ctx, id);
  const { site, relations, environments, primaryDomain, domains } = detail;
  const now = new Date();

  const [health, backups, incidents, deployments, options, integrations, busyEnvironmentIds] =
    await Promise.all([
      getSiteHealth(ctx, id, now),
      listRecentBackups(ctx, id, 3),
      listSiteIncidents(ctx, id),
      listSiteDeployments(
        ctx,
        id,
        parsePagination(
          { page: paramValue(query, "page") },
          { defaultPageSize: DEPLOYMENTS_PER_PAGE },
        ),
      ),
      getSiteFormOptions(ctx),
      getSitesIntegrationState(ctx),
      listBusyEnvironmentIds(ctx, id, now),
    ]);

  // Procédure de restauration (07.05.03) : les articles de ce site s'il en a, sinon la recherche
  // générale. Sans accès à la base de connaissances, le lien n'est pas proposé.
  const canReadKnowledge = can(ctx.actor, "knowledge:read");
  const siteArticles = canReadKnowledge
    ? await listKnowledgeArticles(ctx, { siteId: id }, { page: 1, pageSize: 1 })
    : null;
  const procedureHref = siteArticles?.total
    ? `/documents/connaissances?site=${id}`
    : `/documents/connaissances?q=${encodeURIComponent("restauration")}`;

  const links = getConsoleLinks(site);
  const canUpdate = can(ctx.actor, "sites:update");
  const canOpenConnections = can(ctx.actor, "integrations:read");
  const canTrigger = can(ctx.actor, "deployments:trigger") && !site.archivedAt;
  const label = site.primaryDomain ?? site.name;

  const lastDeployment = deployments.page === 1 ? deployments.items[0] : undefined;
  const lastBackup = backups[0] ?? null;
  const production = environments.find((environment) => environment.kind === "production");
  const staging = environments.find((environment) => environment.kind === "staging");
  const deployable = environments.filter((environment) => environment.coolifyAppUuid);
  const repositoryHost = site.repoUrl ? new URL(site.repoUrl).hostname.replace(/^www\./, "") : null;

  const subtitle = [
    relations.companyName,
    site.kind ? SITE_KIND_LABELS[site.kind].toLocaleLowerCase("fr-FR") : null,
    site.cmsKind && site.cmsKind !== "none" ? CMS_KIND_LABELS[site.cmsKind] : null,
    site.hostedByNuera
      ? `hébergé par Nuera${site.serverLabel ? ` (${site.serverLabel})` : ""}`
      : (site.hostingLabel ?? "hébergement externe"),
  ]
    .filter(Boolean)
    .join(" · ");

  const productionBadge = production ? environmentBadge(production, now) : null;
  const siteBadge = siteHealthBadge(
    {
      status: site.status,
      isDown: detail.isDown,
      productionStatus: production?.status ?? null,
      productionCheckedAt: production?.statusCheckedAt ?? null,
      lastSampleAt: detail.lastSampleAt,
    },
    now,
  );

  // KPI
  const uptimeValue =
    health.uptimeRatio === null ? "indisponible" : formatPercent(health.uptimeRatio * 100, 2);
  const incidentsNote =
    health.incidents === 0
      ? "0 incident"
      : `${health.incidents} incident${health.incidents > 1 ? "s" : ""}`;
  const domainDays = daysFromNow(primaryDomain?.expiresOn, now);
  const domainNoteTone: NoteTone =
    domainDays !== null && domainDays <= EXPIRY_WARNING_DAYS ? "warn" : "muted";

  const stalePing =
    health.lastSampleAt && isStale(health.lastSampleAt, now, SAMPLE_STALE_AFTER_MS)
      ? health.lastSampleAt
      : null;

  const deploymentColumns: DataTableColumn<DeploymentRow>[] = [
    {
      key: "deployment",
      header: "Déploiement",
      primary: true,
      cell: (deployment) => {
        const sha = deployment.commitSha?.slice(0, 7);
        const message = deployment.commitMessage ?? "Déploiement sans message";
        return (
          <CellIdentity
            title={sha ? `${message} (${sha})` : message}
            subtitle={`${ENVIRONMENT_KIND_LABELS[deployment.environmentKind]} · ${formatRelativeTime(deployment.startedAt ?? deployment.createdAt, now)}`}
          />
        );
      },
    },
    {
      key: "by",
      header: "Déclenché par",
      width: 140,
      cell: (deployment) =>
        deployment.triggeredByName ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={deployment.triggeredByName} size={26} />
            <span className="truncate">{firstName(deployment.triggeredByName)}</span>
          </span>
        ) : (
          "automatique"
        ),
    },
    {
      key: "duration",
      header: "Durée",
      width: 110,
      cell: (deployment) => formatDurationSeconds(deployment.durationSeconds),
    },
    {
      key: "result",
      header: "Résultat",
      width: 120,
      cell: (deployment) => (
        <StatusBadge
          kind="deployment"
          status={deployment.status}
          className={
            deployment.status === "queued" || deployment.status === "running"
              ? "anim-pulse"
              : undefined
          }
        >
          {DEPLOYMENT_STATUS_LABELS[deployment.status]}
        </StatusBadge>
      ),
    },
  ];

  const offSiteConfirmed = backups.some(
    (backup) => backup.status === "succeeded" && backup.offSite,
  );

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <DeploymentWatcher siteId={id} active={busyEnvironmentIds.length > 0} />
      <PageHeader
        className="mb-0 lg:mb-0"
        title={label}
        subtitle={subtitle}
        breadcrumbs={[{ label: "Sites et CMS", href: "/sites" }, { label }]}
        actions={
          <>
            {links.coolifyProject ? (
              <ButtonExternalLink href={links.coolifyProject}>
                Ouvrir dans Coolify
              </ButtonExternalLink>
            ) : null}
            {canTrigger && deployable.length > 0 && integrations.coolify.configured ? (
              <DeployButton
                siteId={id}
                siteLabel={label}
                busyEnvironmentIds={busyEnvironmentIds}
                environments={deployable.map(({ id: environmentId, kind, url }) => ({
                  id: environmentId,
                  kind,
                  url,
                }))}
              />
            ) : null}
          </>
        }
        badges={
          <>
            <Badge tone={siteBadge.tone}>{siteBadge.label}</Badge>
            {productionBadge ? (
              <Badge tone={productionBadge.tone}>{productionBadge.label}</Badge>
            ) : null}
            {staging?.url ? (
              <Badge>{`Staging · ${staging.url.replace(/^https?:\/\//, "")}`}</Badge>
            ) : null}
            {site.repoUrl ? (
              <Badge>
                {`Dépôt ${repositoryHost}${site.repoBranch ? ` · ${site.repoBranch}` : ""}`}
              </Badge>
            ) : null}
          </>
        }
      />

      <KpiGrid>
        <KpiCard
          label="Disponibilité 30 jours"
          value={uptimeValue}
          note={health.uptimeRatio === null ? "Aucune mesure" : incidentsNote}
          noteTone={
            health.incidents > 0 ? "warn" : health.uptimeRatio === null ? "muted" : "success"
          }
        />
        <KpiCard
          label="Dernier déploiement"
          value={
            lastDeployment
              ? formatRelativeTime(lastDeployment.startedAt ?? lastDeployment.createdAt, now)
              : "—"
          }
          note={
            lastDeployment
              ? `${DEPLOYMENT_STATUS_LABELS[lastDeployment.status].toLocaleLowerCase("fr-FR")} · ${formatDurationSeconds(lastDeployment.durationSeconds)}`
              : "Aucun déploiement connu"
          }
          noteTone={
            lastDeployment?.status === "succeeded"
              ? "success"
              : lastDeployment?.status === "failed" || lastDeployment?.status === "cancelled"
                ? "danger"
                : "muted"
          }
        />
        <KpiCard
          label="Dernière sauvegarde"
          value={backupMoment(lastBackup?.takenAt ?? null, now)}
          note={
            lastBackup
              ? `${lastBackup.status === "succeeded" ? "réussie" : lastBackup.status === "failed" ? "échec" : "en cours"}${lastBackup.sizeBytes ? ` · ${formatBytes(lastBackup.sizeBytes)}` : ""}`
              : "Aucune sauvegarde enregistrée"
          }
          noteTone={
            lastBackup?.status === "failed"
              ? "danger"
              : lastBackup?.status === "succeeded"
                ? "success"
                : "muted"
          }
        />
        <KpiCard
          label="Domaine · expiration"
          value={primaryDomain?.expiresOn ? formatDateNumeric(primaryDomain.expiresOn) : "—"}
          note={
            !primaryDomain
              ? "Aucun domaine enregistré"
              : !primaryDomain.expiresOn
                ? "Échéance à saisir"
                : domainDays !== null && domainDays <= EXPIRY_WARNING_DAYS
                  ? `${formatRelativeDate(primaryDomain.expiresOn, now)}${primaryDomain.autoRenew ? " · renouvellement auto" : " · à renouveler"}`
                  : primaryDomain.autoRenew
                    ? "renouvellement auto"
                    : "renouvellement manuel"
          }
          noteTone={domainNoteTone}
        />
      </KpiGrid>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard
            icon="server"
            title="Disponibilité · 30 jours"
            aside={
              <div className="flex items-center gap-3">
                <HealthWindow
                  data={{
                    label,
                    measuredDays: health.measuredDays,
                    uptimeRatio: health.uptimeRatio,
                    avgResponseMs: health.avgResponseMs,
                    serverErrors: health.serverErrors,
                    daysWithServerErrors: health.daysWithServerErrors,
                    backups: health.backups,
                    incidents: health.incidents,
                    monitorUrl: links.uptimeKumaMonitor,
                  }}
                />
                <Badge
                  tone={
                    integrations.uptimeKuma.configured &&
                    !isStale(integrations.uptimeKuma.lastSuccessAt, now, SAMPLE_STALE_AFTER_MS)
                      ? "success"
                      : "neutral"
                  }
                >
                  Uptime Kuma
                </Badge>
              </div>
            }
          >
            {stalePing ? (
              <StaleData
                service="Uptime Kuma"
                date={formatDateTime(stalePing)}
                staleness={formatRelativeTime(stalePing, now)}
              />
            ) : null}
            {!integrations.uptimeKuma.configured && health.measuredDays === 0 ? (
              <ConnectionRequired
                compact
                service="Uptime Kuma"
                missing="L'URL et la page de statut ne sont pas renseignées : aucune mesure n'est disponible."
                showSettingsLink={canOpenConnections}
              />
            ) : !site.monitorId && health.measuredDays === 0 ? (
              <EmptyState
                compact
                icon="server"
                title="Aucune sonde reliée"
                description="Renseignez la sonde Uptime Kuma de ce site pour suivre sa disponibilité."
              />
            ) : (
              <>
                <UptimeBars
                  title="Disponibilité sur 30 jours"
                  summary={uptimeNote(health.days, health.measuredDays, now)}
                  days={health.days.map(toUptimeDay)}
                  height={32}
                />
                <p className="text-row-secondary text-muted">
                  {uptimeNote(health.days, health.measuredDays, now)}
                </p>
              </>
            )}
          </InfoCard>

          <section aria-label="Déploiements" className="flex flex-col gap-3">
            {!integrations.coolify.configured && deployments.total === 0 ? (
              <div className="rounded-lg bg-surface shadow-soft">
                <ConnectionRequired
                  compact
                  service="Coolify"
                  missing="L'URL et le jeton d'API ne sont pas renseignés : les déploiements ne peuvent être ni lus ni lancés."
                  showSettingsLink={canOpenConnections}
                />
              </div>
            ) : (
              <DataTable
                caption="Déploiements"
                columns={deploymentColumns}
                rows={deployments.items}
                rowKey={(deployment) => deployment.id}
                rowHeight="md"
                query={{ pathname: `/sites/${id}`, searchParams: query }}
                pagination={
                  deployments.total > deployments.pageSize
                    ? {
                        page: deployments.page,
                        pageSize: deployments.pageSize,
                        total: deployments.total,
                      }
                    : undefined
                }
                empty={
                  <EmptyState
                    compact
                    icon="rocket"
                    title="Aucun déploiement connu"
                    description={
                      deployable.length === 0
                        ? "Reliez un environnement à une application Coolify."
                        : "Synchronisez Coolify ou lancez un premier déploiement."
                    }
                  />
                }
              />
            )}
            {integrations.coolify.configured || deployments.total > 0 ? (
              <SyncLine
                label="Coolify"
                service="coolify"
                state={integrations.coolify}
                canSync={canUpdate}
                canOpenConnections={canOpenConnections}
                now={now}
              />
            ) : null}
          </section>

          <InfoCard icon="server" title="Environnements">
            <ul className="flex flex-col divide-y divide-border">
              {ENVIRONMENT_KINDS.map((kind) => {
                const environment = environments.find((candidate) => candidate.kind === kind);
                const badge = environment ? environmentBadge(environment, now) : null;
                return (
                  <li
                    key={kind}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {ENVIRONMENT_KIND_LABELS[kind]}
                      </p>
                      <p className="truncate font-mono text-xs text-muted">
                        {environment
                          ? (environment.url ?? "Adresse non renseignée")
                          : "Non déclaré"}
                        {environment?.coolifyAppUuid ? ` · ${environment.coolifyAppUuid}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {badge && environment?.coolifyAppUuid ? (
                        <Badge tone={badge.tone}>
                          {badge.label.split(" · ").slice(1).join(" · ")}
                        </Badge>
                      ) : null}
                      {environment?.url ? (
                        <ExternalRelation href={environment.url}>Ouvrir</ExternalRelation>
                      ) : null}
                      {canUpdate && !site.archivedAt ? (
                        <EnvironmentFormButton
                          siteId={id}
                          kind={kind}
                          url={environment?.url ?? null}
                          coolifyAppUuid={environment?.coolifyAppUuid ?? null}
                          declared={Boolean(environment)}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </InfoCard>

          <InfoCard icon="alert" title="Incidents">
            {incidents.length === 0 ? (
              <p className="text-sm text-muted">Aucun incident enregistré pour ce site.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {incidents.map((incident) => (
                  <li
                    key={incident.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                  >
                    <Link
                      href={`/support/${incident.id}`}
                      className="min-w-0 flex-1 text-text hover:text-accent hover:underline"
                    >
                      <span className="font-mono text-xs text-muted">{incident.number}</span>{" "}
                      {incident.subject}
                    </Link>
                    <span className="text-xs text-muted">
                      {formatDateShort(incident.createdAt)}
                    </span>
                    <StatusBadge kind="ticket" status={incident.status} />
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard
            icon="link"
            title="Relations techniques"
            aside={
              canUpdate && !site.archivedAt ? (
                <SiteFormButton
                  compact
                  label="Modifier"
                  choices={options}
                  site={{
                    id: site.id,
                    companyId: site.companyId,
                    companyName: relations.companyName,
                    projectId: site.projectId,
                    projectLabel: relations.projectNumber,
                    contractId: site.contractId,
                    contractLabel: relations.contractName,
                    name: site.name,
                    primaryDomain: site.primaryDomain,
                    kind: site.kind,
                    technology: site.technology,
                    cmsKind: site.cmsKind,
                    cmsAdminUrl: site.cmsAdminUrl,
                    repoUrl: site.repoUrl,
                    repoBranch: site.repoBranch,
                    hostingLabel: site.hostingLabel,
                    hostedByNuera: site.hostedByNuera,
                    serverLabel: site.serverLabel,
                    ownerMemberId: site.ownerMemberId,
                    ownerName: relations.ownerName,
                    liveOn: site.liveOn,
                    coolifyProjectUuid: site.coolifyProjectUuid,
                    monitorId: site.monitorId,
                  }}
                />
              ) : undefined
            }
            rows={[
              {
                label: "Client",
                value: (
                  <RelationLink href={`/clients/${site.companyId}`}>
                    {relations.companyName}
                  </RelationLink>
                ),
              },
              {
                label: "Projet",
                value:
                  site.projectId && relations.projectNumber ? (
                    <RelationLink href={`/projets/${site.projectId}`}>
                      {relations.projectNumber}
                    </RelationLink>
                  ) : (
                    "—"
                  ),
              },
              { label: "Serveur", value: site.serverLabel ?? "—" },
              {
                label: "CMS",
                value: site.cmsAdminUrl ? (
                  <ExternalRelation href={site.cmsAdminUrl}>
                    {site.cmsKind ? CMS_KIND_LABELS[site.cmsKind] : "Administration"}
                  </ExternalRelation>
                ) : site.cmsKind ? (
                  CMS_KIND_LABELS[site.cmsKind]
                ) : (
                  "—"
                ),
              },
              {
                label: "Contrat",
                value: relations.contractId ? (
                  <RelationLink href={`/contrats/${relations.contractId}`}>
                    {relations.contractName}
                  </RelationLink>
                ) : (
                  "—"
                ),
              },
              { label: "Responsable", value: relations.ownerName ?? "—" },
              { label: "Technologie", value: site.technology ?? "—" },
              {
                label: "Dépôt",
                value: site.repoUrl ? (
                  <ExternalRelation href={site.repoUrl}>{repositoryHost}</ExternalRelation>
                ) : (
                  "—"
                ),
              },
              { label: "Mise en ligne", value: site.liveOn ? formatDate(site.liveOn) : "—" },
            ]}
          >
            <SiteLifecycle
              siteId={id}
              status={site.status}
              canUpdate={canUpdate}
              canArchive={can(ctx.actor, "sites:archive")}
            />
          </InfoCard>

          <InfoCard
            icon="globe2"
            title="Domaine et HTTPS"
            aside={
              canUpdate && !site.archivedAt ? (
                <DomainFormButton label="Ajouter" siteId={id} companyId={site.companyId} />
              ) : undefined
            }
          >
            {domains.length === 0 ? (
              <p className="text-sm text-muted">Aucun domaine enregistré pour ce site.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {domains.map((domain) => {
                  const badge = tlsBadge(domain, now);
                  return (
                    <dl key={domain.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                      {domains.length > 1 ? (
                        <p className="font-mono text-xs text-muted">{domain.name}</p>
                      ) : null}
                      <InfoRow label="Registrar" value={domain.registrar ?? "—"} />
                      <InfoRow
                        label="Renouvellement"
                        value={domain.expiresOn ? formatDateNumeric(domain.expiresOn) : "à saisir"}
                      />
                      <InfoRow
                        label="Certificat HTTPS"
                        value={<Badge tone={badge.tone}>{badge.label}</Badge>}
                      />
                      {domain.checkedAt ? (
                        <p className="text-xs text-muted">
                          Contrôlé {formatRelativeTime(domain.checkedAt, now)}
                        </p>
                      ) : null}
                      {canUpdate ? (
                        <div className="flex flex-wrap items-center gap-x-4">
                          <TlsCheckButton domainId={domain.id} />
                          <DomainFormButton
                            label="Modifier"
                            domain={{
                              id: domain.id,
                              name: domain.name,
                              companyId: domain.companyId,
                              siteId: domain.siteId,
                              siteName: site.name,
                              registrar: domain.registrar,
                              expiresOn: domain.expiresOn,
                              autoRenew: domain.autoRenew,
                            }}
                          />
                          {can(ctx.actor, "sites:archive") ? (
                            <DeleteDomainButton
                              domainId={domain.id}
                              domainName={domain.name}
                              siteId={domain.siteId}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </dl>
                  );
                })}
              </div>
            )}
          </InfoCard>

          <InfoCard
            icon="database"
            title="Sauvegardes"
            aside={
              canUpdate && !site.archivedAt ? (
                <BackupFormButton
                  siteId={id}
                  environments={environments.map(({ id: environmentId, kind }) => ({
                    id: environmentId,
                    kind,
                  }))}
                />
              ) : undefined
            }
          >
            <dl className="flex flex-col gap-2">
              {backups.length === 0 ? (
                <p className="text-sm text-muted">Aucune sauvegarde enregistrée.</p>
              ) : (
                backups.map((backup) => (
                  <InfoRow
                    key={backup.id}
                    label={
                      <>
                        {backupMoment(backup.takenAt, now)}
                        {backup.source === "manual" ? (
                          <span className="ml-1 text-xs text-muted">· déclarée</span>
                        ) : null}
                      </>
                    }
                    value={
                      <Badge
                        tone={
                          backup.status === "succeeded"
                            ? "success"
                            : backup.status === "failed"
                              ? "danger"
                              : "accent"
                        }
                      >
                        {backup.status === "succeeded"
                          ? "réussie"
                          : backup.status === "failed"
                            ? "échec"
                            : "en cours"}
                      </Badge>
                    }
                  />
                ))
              )}
              <InfoRow
                label="Stockage hors serveur"
                value={
                  backups.length === 0 ? (
                    <Badge>indisponible</Badge>
                  ) : offSiteConfirmed ? (
                    <Badge tone="success">copie constatée</Badge>
                  ) : (
                    <Badge tone="warn">non constaté</Badge>
                  )
                }
              />
            </dl>
            {canReadKnowledge ? (
              <ButtonLink href={procedureHref} className="w-fit">
                Procédure de restauration
              </ButtonLink>
            ) : null}
          </InfoCard>
        </div>
      </div>
    </div>
  );
}
