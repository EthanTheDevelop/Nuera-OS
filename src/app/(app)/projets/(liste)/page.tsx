import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Gauge } from "@/components/ui/gauge";
import { Tile } from "@/components/ui/tile";
import { formatDateShort, formatDays, formatNumber, MINUTES_PER_DAY } from "@/lib/format";
import { paramValue, type SearchParamsLike } from "@/lib/url-state";
import { NewProjectButton } from "@/modules/projects/components/project-form";
import {
  pageNumber,
  progressLabel,
  projectsSubtitle,
  teamInitials,
} from "@/modules/projects/components/project-view";
import {
  getProjectsOverview,
  listProjectAssignees,
  listProjects,
  type ProjectSummary,
} from "@/modules/projects/project.service";
import type { ProjectListView } from "@/modules/projects/project.schema";
import { CapacityBars } from "@/modules/time/components/capacity-bars";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Projets" };

const PATH = "/projets";
const PAGE_SIZE = 25;

const VIEWS: Record<string, ProjectListView> = {
  "a-venir": "upcoming",
  livres: "delivered",
  "en-retard": "late",
  archives: "archived",
};

const EMPTY_COPY: Record<ProjectListView, { title: string; description: string }> = {
  active: {
    title: "Aucun projet en cours",
    description: "Un devis accepté crée son projet. Vous pouvez aussi en créer un à la main.",
  },
  upcoming: {
    title: "Aucun projet à venir",
    description: "Les projets en préparation apparaissent ici.",
  },
  delivered: { title: "Aucun projet livré", description: "Les projets mis en ligne arrivent ici." },
  late: { title: "Aucun projet en retard", description: "Tout tient dans les temps." },
  archived: { title: "Aucun projet archivé", description: "Rien n’a été archivé." },
};

const columns: DataTableColumn<ProjectSummary>[] = [
  {
    key: "project",
    header: "Projet",
    primary: true,
    cell: (project) => (
      <CellIdentity
        name={project.companyName}
        title={project.name.startsWith(project.companyName) ? project.companyName : project.name}
        subtitle={[
          project.offer !== project.name ? project.offer : project.companyName,
          project.estimatedMinutes ? formatDays(project.estimatedMinutes) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    ),
  },
  {
    key: "stage",
    header: "Étape",
    width: 170,
    cell: (project) => (
      <span className="block truncate">
        {project.stage ? `${project.stage.index} · ${project.stage.name}` : "—"}
      </span>
    ),
  },
  {
    key: "progress",
    header: "Avancement",
    width: 150,
    cell: (project) => (
      <span className="flex w-full min-w-0 items-center gap-3">
        <Gauge
          value={project.progress.percent}
          label={`Avancement de ${project.name}`}
          valueText={progressLabel(project.progress)}
          className="min-w-0 flex-1"
        />
        <span className="tabular shrink-0 text-xs">{progressLabel(project.progress)}</span>
      </span>
    ),
  },
  {
    key: "due",
    header: "Mise en ligne",
    width: 110,
    cell: (project) =>
      project.deliveredOn
        ? formatDateShort(project.deliveredOn)
        : project.dueOn
          ? formatDateShort(project.dueOn)
          : "—",
  },
  {
    key: "status",
    header: "Statut",
    width: 170,
    cell: (project) => <Badge tone={project.health.tone}>{project.health.label}</Badge>,
  },
  {
    key: "team",
    header: "Équipe",
    width: 80,
    hideWhenCollapsed: true,
    cell: (project) => <span className="block truncate">{teamInitials(project.team)}</span>,
  },
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["projects:read", "projects:read_assigned"])) return <ForbiddenState />;

  const raw = (await searchParams) as SearchParamsLike;
  const params = {
    vue: paramValue(raw, "vue"),
    q: paramValue(raw, "q"),
    page: paramValue(raw, "page"),
  };
  const view = VIEWS[params.vue ?? ""] ?? "active";
  const canCreate = can(ctx.actor, "projects:create");
  const assignedOnly = !can(ctx.actor, "projects:read");

  const [{ items, total, page, pageSize }, overview, members] = await Promise.all([
    listProjects(ctx, {
      view,
      search: params.q?.slice(0, 200) || undefined,
      page: pageNumber(params.page),
      pageSize: PAGE_SIZE,
    }),
    getProjectsOverview(ctx),
    canCreate ? listProjectAssignees(ctx) : Promise.resolve([]),
  ]);

  const copy = params.q
    ? { title: "Aucun projet ne correspond", description: "Essayez un autre terme de recherche." }
    : EMPTY_COPY[view];
  const capacity = overview.load?.weeks[0]?.capacityMinutes ?? 0;

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        title="Projets"
        subtitle={projectsSubtitle(overview, assignedOnly)}
        actions={
          <>
            <ButtonLink href="/projets/calendrier">Vue calendrier</ButtonLink>
            {canCreate ? <NewProjectButton members={members} /> : null}
          </>
        }
        className="mb-0 lg:mb-0"
      >
        <FilterBar searchParam="q" searchPlaceholder="Rechercher…" label="Filtrer les projets">
          <FilterChip param="vue">En cours</FilterChip>
          <FilterChip param="vue" value="a-venir">
            À venir
          </FilterChip>
          <FilterChip param="vue" value="livres">
            Livrés
          </FilterChip>
          <FilterChip param="vue" value="en-retard">
            En retard
          </FilterChip>
          {can(ctx.actor, "projects:archive") ? (
            <FilterChip param="vue" value="archives">
              Archivés
            </FilterChip>
          ) : null}
        </FilterBar>
      </PageHeader>

      <div className="grid items-start gap-(--grid-gap) min-[1808px]:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
        <DataTable
          caption="Projets"
          columns={columns}
          rows={items}
          rowKey={(project) => project.id}
          rowHref={(project) => `/projets/${project.id}`}
          rowHeight="lg"
          query={{ pathname: PATH, searchParams: params }}
          pagination={total > pageSize ? { page, pageSize, total } : undefined}
          empty={
            <EmptyState compact icon="projets" title={copy.title} description={copy.description} />
          }
        />

        {overview.load ? (
          <Tile className="gap-3 rounded-lg p-6">
            <h2 className="text-tile-title text-ink">
              {capacity > 0
                ? `Charge sur 6 semaines · ${formatNumber(capacity / MINUTES_PER_DAY, 1)} journées par semaine`
                : "Charge sur 6 semaines"}
            </h2>
            {capacity > 0 ? (
              <CapacityBars weeks={overview.load.weeks} />
            ) : (
              <p className="text-sm text-muted">
                Renseignez la capacité de l’équipe pour voir la charge à venir.
              </p>
            )}
          </Tile>
        ) : null}
      </div>
    </div>
  );
}
