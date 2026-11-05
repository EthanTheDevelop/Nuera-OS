import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CellMono, DataTable } from "@/components/ui/data-table";
import { Gauge, loadTone } from "@/components/ui/gauge";
import { InfoCard } from "@/components/ui/info-card";
import { MEMBER_KIND_LABELS, MEMBER_STATUS_LABELS, TIME_CATEGORY_LABELS } from "@/lib/domain-enums";
import {
  formatDateShort,
  formatDays,
  formatMinutes,
  formatNumber,
  MINUTES_PER_DAY,
} from "@/lib/format";
import { formatCents } from "@/lib/money";
import { parisToday } from "@/modules/time/calendar";
import { entryWorkLabel, listTimeEntries } from "@/modules/time/time.service";
import { AbsencePanel } from "@/modules/team/components/absence-panel";
import {
  ArchiveMemberButton,
  LinkUserButton,
} from "@/modules/team/components/member-admin-actions";
import { MemberFormButton } from "@/modules/team/components/member-form";
import { MissionFormButton } from "@/modules/team/components/mission-form";
import { MissionTable } from "@/modules/team/components/mission-table";
import {
  getMissionFormOptions,
  getTeamAccess,
  getTeamMember,
  listLinkableUsers,
  listMissions,
} from "@/modules/team/team.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Fiche d'équipe" };

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) return <ForbiddenState />;

  const { id } = await params;
  const query = await searchParams;
  const access = getTeamAccess(ctx);

  let detail;
  try {
    detail = await getTeamMember(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { member, capacity, absences, linkedUser, missionSummary } = detail;

  const [missions, options, entries, linkable] = await Promise.all([
    listMissions(ctx, { memberId: id }, parsePagination(query, { defaultPageSize: 10 })),
    access.canManage ? getMissionFormOptions(ctx) : Promise.resolve(null),
    access.canReadTime
      ? listTimeEntries(ctx, { memberId: id }, { page: 1, pageSize: 5 })
      : Promise.resolve(null),
    access.canLinkUsers ? listLinkableUsers(ctx, id) : Promise.resolve(null),
  ]);

  const archived = member.archivedAt !== null;
  const percent = capacity?.loadPercent ?? 0;
  const contactRows = [
    { key: "kind", label: "Type", value: MEMBER_KIND_LABELS[member.kind] },
    { key: "title", label: "Fonction", value: member.title ?? "—" },
    { key: "specialty", label: "Spécialité", value: member.specialty ?? "—" },
    {
      key: "email",
      label: "E-mail",
      value: member.email ? (
        <a href={`mailto:${member.email}`} className="underline-offset-4 hover:underline">
          {member.email}
        </a>
      ) : (
        "—"
      ),
    },
    {
      key: "phone",
      label: "Téléphone",
      value: member.phone ? (
        <a href={`tel:${member.phone}`} className="underline-offset-4 hover:underline">
          {member.phone}
        </a>
      ) : (
        "—"
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-4">
            <Avatar name={member.fullName} size={56} />
            {member.fullName}
          </span>
        }
        subtitle={[MEMBER_KIND_LABELS[member.kind], member.title].filter(Boolean).join(" · ")}
        breadcrumbs={[{ label: "Équipe", href: "/equipe" }, { label: member.fullName }]}
        badges={
          <>
            {archived ? (
              <Badge tone="warn">Archivé</Badge>
            ) : (
              <Badge tone={member.status === "active" ? "success" : "neutral"}>
                {MEMBER_STATUS_LABELS[member.status]}
              </Badge>
            )}
            {(member.skills ?? []).map((skill) => (
              <Badge key={skill} tone="accent">
                {skill}
              </Badge>
            ))}
          </>
        }
        actions={
          access.canManage ? (
            <>
              <ArchiveMemberButton memberId={member.id} archived={archived} />
              <MemberFormButton member={member} showCosts={access.canReadCosts} label="Modifier" />
              {options && !archived ? (
                <MissionFormButton
                  options={options}
                  defaultMemberId={member.id}
                  showCosts={access.canReadCosts}
                  label="Affecter une mission"
                />
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-(--cols-main-side)">
        <div className="flex min-w-0 flex-col gap-(--grid-gap)">
          <MissionTable
            missions={missions.items}
            showMember={false}
            showCosts={access.canReadCosts}
            caption={`Missions de ${member.fullName}`}
            query={{ pathname: `/equipe/${id}`, searchParams: query }}
            pagination={missions}
            empty={<EmptyState compact icon="flag" title="Aucune mission" />}
          />

          {entries ? (
            <InfoCard
              icon="clock"
              title="Temps récent"
              aside={
                <Link
                  href={`/temps/historique?membre=${member.id}`}
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  Tout voir
                </Link>
              }
            >
              <DataTable
                columns={[
                  {
                    key: "date",
                    header: "DATE",
                    width: 90,
                    cell: (entry) => <CellMono>{formatDateShort(entry.workOn)}</CellMono>,
                  },
                  {
                    key: "work",
                    header: "TRAVAIL",
                    primary: true,
                    cell: (entry) => (
                      <span className="block truncate text-sm text-text">
                        {entryWorkLabel(entry)}
                      </span>
                    ),
                  },
                  {
                    key: "category",
                    header: "CATÉGORIE",
                    width: 120,
                    cell: (entry) => TIME_CATEGORY_LABELS[entry.category],
                  },
                  {
                    key: "minutes",
                    header: "DURÉE",
                    width: 80,
                    cell: (entry) => (
                      <span className="tabular">{formatMinutes(entry.minutes)}</span>
                    ),
                  },
                ]}
                rows={entries.items}
                rowKey={(entry) => entry.id}
                caption="Temps récent"
                className="shadow-none"
                empty={<EmptyState compact icon="clock" title="Aucun temps saisi" />}
              />
            </InfoCard>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-(--grid-gap)">
          <InfoCard icon="clients" title="Coordonnées" rows={contactRows} />

          <InfoCard
            icon="calendar"
            title="Disponibilité"
            rows={[
              {
                key: "weekly",
                label: "Capacité par semaine",
                value: formatMinutes(member.weeklyCapacityMinutes),
              },
              {
                key: "month",
                label: "Ce mois, absences déduites",
                value: capacity ? formatDays(capacity.capacityMinutes) : "—",
              },
            ]}
          >
            {capacity ? (
              <>
                <Gauge
                  value={Math.min(percent, 100)}
                  height={8}
                  tone={loadTone(percent)}
                  label={`Charge de ${member.fullName} ce mois-ci`}
                  valueText={`${percent} %`}
                />
                <p className="tabular text-xs text-muted">
                  Ce mois : {formatNumber(capacity.plannedMinutes / MINUTES_PER_DAY, 1)} /{" "}
                  {formatNumber(capacity.capacityMinutes / MINUTES_PER_DAY, 1)} j vendues
                </p>
              </>
            ) : null}
            <h3 className="mt-1 text-sm font-semibold text-text">Absences</h3>
            <AbsencePanel
              memberId={member.id}
              absences={absences}
              today={parisToday()}
              canManage={access.canManage}
            />
          </InfoCard>

          {access.canReadCosts ? (
            <InfoCard
              icon="euro"
              title="Coûts et conditions"
              rows={[
                {
                  key: "hourly",
                  label: "Coût horaire",
                  value: formatCents(member.hourlyCostCents),
                },
                { key: "rate", label: "Tarif jour", value: formatCents(member.dayRateCents) },
                {
                  key: "planned",
                  label: "Missions · prévu",
                  value: formatCents(missionSummary.plannedCostCents),
                },
                {
                  key: "committed",
                  label: "Missions · engagé",
                  value: formatCents(missionSummary.committedCostCents),
                },
              ]}
            >
              <p className="text-sm whitespace-pre-line text-muted">
                {member.conditions ?? "Aucune condition particulière."}
              </p>
            </InfoCard>
          ) : null}

          {linkable ? (
            <InfoCard
              icon="link"
              title="Compte relié"
              rows={[
                {
                  key: "account",
                  label: "Compte",
                  value: linkedUser ? `${linkedUser.name} · ${linkedUser.email}` : "Aucun",
                },
              ]}
            >
              <div>
                <LinkUserButton
                  memberId={member.id}
                  users={linkable}
                  currentUserId={member.userId}
                />
              </div>
            </InfoCard>
          ) : null}
        </div>
      </div>
    </>
  );
}
