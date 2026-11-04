import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { MISSION_STATUS_LABELS, MISSION_STATUSES, type MissionStatus } from "@/lib/domain-enums";
import { paramValue } from "@/lib/url-state";
import { MissionFormButton } from "@/modules/team/components/mission-form";
import { MissionTable } from "@/modules/team/components/mission-table";
import { getMissionFormOptions, getTeamAccess, listMissions } from "@/modules/team/team.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Missions" };

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) return <ForbiddenState />;

  const params = await searchParams;
  const access = getTeamAccess(ctx);
  const statusParam = paramValue(params, "statut");
  const status = MISSION_STATUSES.includes(statusParam as MissionStatus)
    ? (statusParam as MissionStatus)
    : undefined;
  const open = statusParam === undefined;

  const [missions, options] = await Promise.all([
    listMissions(
      ctx,
      { status, open: open || undefined, search: paramValue(params, "q") },
      parsePagination(params),
    ),
    access.canManage ? getMissionFormOptions(ctx) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Missions"
        subtitle={`${missions.total} mission${missions.total > 1 ? "s" : ""}${open ? " ouverte" + (missions.total > 1 ? "s" : "") : ""} · affectations, échéances et livrables`}
        breadcrumbs={[{ label: "Équipe", href: "/equipe" }, { label: "Missions" }]}
        actions={
          options ? (
            <MissionFormButton
              options={options}
              showCosts={access.canReadCosts}
              label="Affecter une mission"
            />
          ) : undefined
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Mission, intervenant, projet…" label="Statut">
          <FilterChip param="statut">Ouvertes</FilterChip>
          {MISSION_STATUSES.map((item) => (
            <FilterChip key={item} param="statut" value={item}>
              {MISSION_STATUS_LABELS[item]}
            </FilterChip>
          ))}
        </FilterBar>
      </PageHeader>

      <MissionTable
        missions={missions.items}
        showCosts={access.canReadCosts}
        query={{ pathname: "/equipe/missions", searchParams: params }}
        pagination={missions}
        empty={
          <EmptyState
            icon="flag"
            title="Aucune mission"
            description="Aucune mission ne correspond à ces filtres."
          />
        }
      />
    </>
  );
}
