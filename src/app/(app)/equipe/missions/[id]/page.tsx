import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { InfoCard } from "@/components/ui/info-card";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { parisToday } from "@/modules/time/calendar";
import { MISSION_STATUS_BADGES } from "@/modules/team/mission.status";
import { MissionActions } from "@/modules/team/components/mission-actions";
import { MissionFormButton } from "@/modules/team/components/mission-form";
import { getMission, getMissionFormOptions, getTeamAccess } from "@/modules/team/team.service";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Mission" };

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["team:read", "time:create_own"])) return <ForbiddenState />;

  const { id } = await params;
  const access = getTeamAccess(ctx);
  let mission;
  try {
    mission = await getMission(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const options = access.canManage ? await getMissionFormOptions(ctx) : null;
  const badge = MISSION_STATUS_BADGES[mission.status];

  const rows = [
    {
      key: "member",
      label: "Intervenant",
      value: can(ctx.actor, "team:read") ? (
        <Link href={`/equipe/${mission.memberId}`} className="underline-offset-4 hover:underline">
          {mission.memberName}
        </Link>
      ) : (
        mission.memberName
      ),
    },
    {
      key: "project",
      label: "Projet",
      value: mission.projectId ? (
        <Link href={`/projets/${mission.projectId}`} className="underline-offset-4 hover:underline">
          {mission.projectName}
        </Link>
      ) : (
        "—"
      ),
    },
    { key: "task", label: "Tâche", value: mission.taskTitle ?? "—" },
    {
      key: "ticket",
      label: "Demande",
      value: mission.ticketId ? (
        <Link href={`/support/${mission.ticketId}`} className="underline-offset-4 hover:underline">
          {mission.ticketNumber} · {mission.ticketSubject}
        </Link>
      ) : (
        "—"
      ),
    },
    { key: "client", label: "Client", value: mission.companyName ?? "—" },
    { key: "due", label: "Échéance", value: mission.dueOn ? formatDate(mission.dueOn) : "—" },
  ];

  return (
    <>
      <PageHeader
        title={mission.title}
        subtitle={[mission.memberName, mission.projectName ?? mission.companyName]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={
          access.canManage || access.canReadTime
            ? [
                { label: "Équipe", href: "/equipe" },
                { label: "Missions", href: "/equipe/missions" },
                { label: mission.title },
              ]
            : [{ label: "Temps et capacité", href: "/temps" }, { label: mission.title }]
        }
        badges={<Badge tone={badge.tone}>{badge.label}</Badge>}
        actions={
          options ? (
            <MissionFormButton
              options={options}
              mission={mission}
              showCosts={access.canReadCosts}
              label="Modifier"
              variant="default"
            />
          ) : undefined
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-(--cols-main-side)">
        <InfoCard icon="flag" title="Affectation" rows={rows} />
        <div className="flex min-w-0 flex-col gap-(--grid-gap)">
          <InfoCard
            icon="check"
            title="Livrable"
            rows={[
              { key: "expected", label: "Attendu", value: mission.deliverableLabel ?? "—" },
              {
                key: "received",
                label: "Reçu le",
                value: mission.deliverableReceivedOn
                  ? formatDate(mission.deliverableReceivedOn)
                  : "Pas encore",
              },
            ]}
          />
          {access.canReadCosts ? (
            <InfoCard
              icon="euro"
              title="Coûts"
              rows={[
                { key: "planned", label: "Prévu", value: formatCents(mission.plannedCostCents) },
                {
                  key: "committed",
                  label: "Engagé",
                  value: formatCents(mission.committedCostCents),
                },
              ]}
            />
          ) : null}
          {access.canManage ? (
            <InfoCard icon="pipeline" title="Avancement">
              <MissionActions missionId={mission.id} status={mission.status} today={parisToday()} />
            </InfoCard>
          ) : null}
        </div>
      </div>
    </>
  );
}
