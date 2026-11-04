import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { RollingNumber } from "@/components/motion/rolling-number";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { budgetTone, Gauge, loadTone } from "@/components/ui/gauge";
import { Icon } from "@/components/ui/icon";
import { InfoCard, InfoRow } from "@/components/ui/info-card";
import { KpiCard, KpiGrid, type NoteTone } from "@/components/ui/kpi-card";
import { OFFER_ACTIVITY_LABELS, type OfferActivity } from "@/lib/domain-enums";
import {
  formatDateShort,
  formatDays,
  formatMinutes,
  formatNumber,
  MINUTES_PER_DAY,
} from "@/lib/format";
import { formatCents } from "@/lib/money";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { MISSION_STATUS_BADGES } from "@/modules/team/mission.status";
import { listMyMissions } from "@/modules/team/team.service";
import { parisToday, parseWeekKey, weekStart } from "@/modules/time/calendar";
import { CapacityBars } from "@/modules/time/components/capacity-bars";
import { MemberSelect } from "@/modules/time/components/member-select";
import { ProjectSimulator, SimulateButton } from "@/modules/time/components/project-simulator";
import { TimeEntryButton } from "@/modules/time/components/time-entry-dialog";
import { TimesheetProvider, WeekTotalValue } from "@/modules/time/components/timesheet-state";
import { TimesheetTable } from "@/modules/time/components/timesheet-table";
import { firstName } from "@/modules/time/time-format";
import {
  getTimeAccess,
  getTimeEntryOptions,
  getTimeOverview,
  getTimesheet,
  listTimesheetMembers,
  type OverrunRow,
  type ProductivityRow,
  type TimeOverview,
} from "@/modules/time/time.service";
import { canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Temps et capacité" };

const MEMBER_NOTE_LIMIT = 3;

function weekNote(overview: TimeOverview): string | undefined {
  const members = overview.week.byMember;
  if (members.length === 0) return "Aucun temps saisi";
  const shown = members
    .slice(0, MEMBER_NOTE_LIMIT)
    .map((member) => `${firstName(member.fullName)} ${formatMinutes(member.minutes)}`)
    .join(" · ");
  const hidden = members.length - MEMBER_NOTE_LIMIT;
  return hidden > 0 ? `${shown} · +${hidden}` : shown;
}

function toneNote(tone: ReturnType<typeof loadTone>): NoteTone {
  if (tone === "danger") return "danger";
  return tone === "warn" ? "warn" : "muted";
}

/** Alerte si dépassé, succès si sous le vendu, neutre si à peine au-dessus (figma-map, écran 18). */
function productivityTone(row: ProductivityRow): "warn" | "success" | "neutral" {
  if (row.actualMinutes < row.soldMinutes) return "success";
  return row.actualMinutes > row.soldMinutes * 1.05 ? "warn" : "neutral";
}

function ProductivityCard({ rows }: { rows: ProductivityRow[] }) {
  return (
    <InfoCard icon="clock" title="Productivité par prestation">
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="clock"
          title="Pas encore de projet livré"
          description="La comparaison vendu / réel apparaît à la première livraison chiffrée."
        />
      ) : (
        <dl className="flex flex-col gap-3">
          {rows.map((row) => (
            <InfoRow
              key={row.activity}
              label={`${OFFER_ACTIVITY_LABELS[row.activity as OfferActivity] ?? row.activity} · vendu ${formatDays(row.soldMinutes)}`}
              value={
                <Badge tone={productivityTone(row)}>réel {formatDays(row.actualMinutes)}</Badge>
              }
            />
          ))}
        </dl>
      )}
    </InfoCard>
  );
}

function CategoryCard({ overview }: { overview: TimeOverview }) {
  return (
    <InfoCard
      icon="chart"
      title="Temps par catégorie"
      aside={
        <span className="text-xs text-muted">
          {new Intl.DateTimeFormat("fr-FR", {
            month: "long",
            timeZone: "UTC",
          }).format(new Date(`${overview.month.from}T00:00:00Z`))}
        </span>
      }
    >
      {overview.categories.length === 0 ? (
        <EmptyState compact icon="chart" title="Aucun temps saisi ce mois-ci" />
      ) : (
        <ul className="flex flex-col gap-3">
          {overview.categories.map((category, index) => (
            <li key={category.category} className="flex flex-col gap-1.5">
              <span className="text-sm text-text">
                {category.label} · {category.percent} %
              </span>
              <Gauge
                value={category.percent}
                label={category.label}
                valueText={`${category.percent} %, ${formatMinutes(category.minutes)}`}
                index={index}
              />
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}

function OverrunCard({ rows }: { rows: OverrunRow[] }) {
  return (
    <InfoCard
      icon="alert"
      title="Dépassements"
      aside={rows.length > 0 ? <Badge tone="warn">{rows.length}</Badge> : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          icon="check"
          title="Rien à signaler"
          description="Aucun projet n'a consommé 80 % de son enveloppe, aucune tâche ne dépasse son estimation."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link
                  href={row.href}
                  className="min-w-0 text-sm font-medium text-text underline-offset-4 hover:underline"
                >
                  {row.label}
                  <span className="font-normal text-muted"> · {row.detail}</span>
                </Link>
                <span className="tabular text-xs text-muted">
                  {row.estimatedMinutes === null
                    ? formatMinutes(row.minutes)
                    : `${formatMinutes(row.minutes)} / ${formatMinutes(row.estimatedMinutes)}`}
                  {row.kind === "task" ? " · tâche" : ""}
                </span>
              </div>
              <Gauge
                value={Math.min(row.percent, 100)}
                tone={budgetTone(row.percent)}
                label={row.label}
                valueText={`${row.percent} % de l'enveloppe`}
                index={index}
              />
              {row.costCents !== undefined && row.budgetCents ? (
                <span className="tabular text-xs text-muted">
                  Coût du temps {formatCents(row.costCents)} sur {formatCents(row.budgetCents)} de
                  budget
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}

function WeekNav({
  searchParams,
  week,
}: {
  searchParams: SearchParamsLike;
  week: {
    key: string;
    label: string;
    start: string;
    end: string;
    previousKey: string;
    nextKey: string;
    isCurrent: boolean;
  };
}) {
  return (
    <nav aria-label="Semaine" className="flex items-center gap-1">
      <Link
        href={hrefWith("/temps", searchParams, { semaine: week.previousKey })}
        aria-label="Semaine précédente"
        scroll={false}
        className="flex size-9 items-center justify-center rounded-md text-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-text pointer-coarse:size-11"
      >
        <Icon name="chevron" size={14} className="rotate-180" />
      </Link>
      <span className="tabular min-w-[150px] text-center text-sm font-medium text-text">
        {week.label} · {formatDateShort(week.start)}
      </span>
      {week.isCurrent ? (
        <span aria-hidden="true" className="size-9 pointer-coarse:size-11" />
      ) : (
        <Link
          href={hrefWith("/temps", searchParams, { semaine: week.nextKey })}
          aria-label="Semaine suivante"
          scroll={false}
          className="flex size-9 items-center justify-center rounded-md text-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-text pointer-coarse:size-11"
        >
          <Icon name="chevron" size={14} />
        </Link>
      )}
    </nav>
  );
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["time:read", "time:create_own", "time:manage"])) {
    return <ForbiddenState />;
  }

  const params = await searchParams;
  const today = parisToday();
  const monday = parseWeekKey(paramValue(params, "semaine")) ?? weekStart(today);
  const memberParam = paramValue(params, "membre");

  const access = await getTimeAccess(ctx);
  let sheet;
  try {
    sheet = await getTimesheet(ctx, {
      memberId: access.canReadAll ? memberParam : undefined,
      weekOf: monday,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [overview, members, options, missions] = await Promise.all([
    getTimeOverview(ctx, { weekOf: monday }),
    access.canReadAll ? listTimesheetMembers(ctx) : Promise.resolve([]),
    access.canCreateOwn || access.canManage ? getTimeEntryOptions(ctx) : Promise.resolve(null),
    access.canReadAll ? Promise.resolve([]) : listMyMissions(ctx),
  ]);

  const canEnter = options !== null && (access.ownMemberId !== null || access.canManage);
  const firstWeek = overview.sixWeeks?.[0];
  const peopleCount = overview.capacity?.members.filter((m) => m.weeklyCapacityMinutes > 0).length;
  // La capacité affichée est celle de la semaine en cours, quelle que soit la semaine consultée.
  const subtitle =
    firstWeek && peopleCount !== undefined
      ? `Semaine ${firstWeek.label.slice(1)} · ${formatNumber(firstWeek.capacityMinutes / MINUTES_PER_DAY, 1)} journées disponibles par semaine à ${peopleCount}`
      : `${sheet.week.label} · ${formatMinutes(overview.week.totalMinutes)} saisies · vos missions et votre temps`;

  const monthLoad = overview.capacity;
  const pv = overview.plannedVsActualPercent;

  return (
    <TimesheetProvider
      sheet={sheet}
      otherMinutes={Math.max(0, overview.week.totalMinutes - sheet.totalMinutes)}
    >
      <PageHeader
        title="Temps et capacité"
        subtitle={subtitle}
        actions={
          <>
            {canEnter && options ? (
              <TimeEntryButton
                options={options}
                today={today}
                defaultMemberId={sheet.member?.id}
                variant={access.canReadAll ? "default" : "accent"}
              />
            ) : null}
            {access.canReadAll ? <SimulateButton /> : null}
          </>
        }
      />

      <div className="flex flex-col gap-(--grid-gap)">
        <KpiGrid>
          <KpiCard
            label={
              sheet.week.isCurrent
                ? "Temps saisi cette semaine"
                : `Temps saisi en ${sheet.week.label.toLocaleLowerCase("fr-FR")}`
            }
            value={<WeekTotalValue />}
            note={weekNote(overview)}
          />
          {monthLoad ? (
            <KpiCard
              label="Charge du mois"
              value={
                monthLoad.loadPercent === null ? (
                  "—"
                ) : (
                  <RollingNumber value={monthLoad.loadPercent} suffix=" %" />
                )
              }
              note={
                monthLoad.capacityMinutes > 0
                  ? `${formatNumber(monthLoad.plannedMinutes / MINUTES_PER_DAY, 1)} / ${formatNumber(monthLoad.capacityMinutes / MINUTES_PER_DAY, 1)} journées vendues`
                  : "Aucune capacité renseignée"
              }
              noteTone={toneNote(loadTone(monthLoad.loadPercent ?? 0))}
            />
          ) : null}
          {access.canReadAll ? (
            <KpiCard
              label="Prévu / réel"
              value={
                pv === null ? (
                  "—"
                ) : (
                  <RollingNumber value={pv} suffix=" %" format={{ signDisplay: "exceptZero" }} />
                )
              }
              note={
                pv === null
                  ? "Aucun travail terminé à comparer"
                  : pv > 0
                    ? "dépassement moyen"
                    : pv < 0
                      ? "sous le prévu en moyenne"
                      : "conforme au prévu"
              }
            />
          ) : null}
          <KpiCard
            label="Non facturable"
            value={
              overview.nonBillable.percent === null ? (
                "—"
              ) : (
                <RollingNumber value={overview.nonBillable.percent} suffix=" %" />
              )
            }
            note={
              overview.nonBillable.categories.length > 0
                ? overview.nonBillable.categories.join(", ")
                : "Aucun temps non facturable"
            }
          />
        </KpiGrid>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
          <div className="flex min-w-0 flex-col gap-(--grid-gap)">
            <div className="flex flex-col gap-3">
              <div className="anim-content flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <WeekNav searchParams={params} week={sheet.week} />
                <div className="flex flex-wrap items-center gap-3">
                  {!sheet.editable && sheet.member ? (
                    <Badge tone="neutral">Lecture seule</Badge>
                  ) : null}
                  {members.length > 0 ? (
                    <MemberSelect
                      members={members}
                      value={sheet.member?.id}
                      label="Feuille de temps de"
                      allLabel={sheet.member ? undefined : "Choisir un membre"}
                    />
                  ) : null}
                  <Link
                    href="/temps/historique"
                    className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Historique
                  </Link>
                </div>
              </div>
              {sheet.member ? (
                <TimesheetTable />
              ) : (
                <div className="anim-content rounded-lg bg-surface shadow-soft">
                  <EmptyState
                    icon="clients"
                    title="Aucune fiche d'équipe pour ce compte"
                    description={
                      access.canReadAll
                        ? "Votre compte n'est relié à aucun membre : choisissez un membre pour voir sa feuille de temps. Un compte Associé fait ce lien depuis Équipe."
                        : "Votre compte n'est relié à aucun membre. Un compte Associé peut faire ce lien depuis Équipe."
                    }
                  />
                </div>
              )}
            </div>

            {overview.sixWeeks ? (
              <InfoCard
                icon="calendar"
                title="Capacité sur 6 semaines"
                aside={<Badge tone="neutral">prévu / disponible</Badge>}
                className="gap-5"
              >
                <CapacityBars weeks={overview.sixWeeks} />
              </InfoCard>
            ) : null}

            {overview.overruns ? <OverrunCard rows={overview.overruns} /> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-(--grid-gap)">
            {access.canReadAll ? <ProjectSimulator /> : null}
            <CategoryCard overview={overview} />
            {overview.productivity ? <ProductivityCard rows={overview.productivity} /> : null}
            {!access.canReadAll ? (
              <InfoCard icon="flag" title="Mes missions">
                {missions.length === 0 ? (
                  <EmptyState compact icon="flag" title="Aucune mission ouverte" />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {missions.map((mission) => (
                      <li key={mission.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/equipe/missions/${mission.id}`}
                            className="block truncate text-sm font-medium text-text underline-offset-4 hover:underline"
                          >
                            {mission.title}
                          </Link>
                          <p className="truncate text-xs text-muted">
                            {[
                              mission.projectName,
                              mission.dueOn ? `pour le ${formatDateShort(mission.dueOn)}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Sans échéance"}
                          </p>
                        </div>
                        <Badge tone={MISSION_STATUS_BADGES[mission.status].tone}>
                          {MISSION_STATUS_BADGES[mission.status].label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </InfoCard>
            ) : null}
          </div>
        </div>
      </div>
    </TimesheetProvider>
  );
}
