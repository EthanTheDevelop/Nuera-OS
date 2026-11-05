import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { Alert } from "@/components/ui/feedback";
import { ActivityList } from "@/components/ui/activity-list";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { budgetTone, Gauge } from "@/components/ui/gauge";
import { InfoCard } from "@/components/ui/info-card";
import { Tile } from "@/components/ui/tile";
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  OFFER_ACTIVITY_LABELS,
  PRIORITY_LABELS,
  type TaskStatus,
} from "@/lib/domain-enums";
import { formatDateShort, formatDateTime, formatDays, formatRelativeTime } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { listMentionCandidates } from "@/modules/messaging/comment.service";
import { BlockerCard } from "@/modules/projects/components/blocker-card";
import { ChangeRequestCard } from "@/modules/projects/components/change-request-card";
import { DeliverableCard } from "@/modules/projects/components/deliverable-card";
import { HandoverCard } from "@/modules/projects/components/handover-card";
import { PhaseTimeline } from "@/modules/projects/components/phase-timeline";
import { EditProjectButton } from "@/modules/projects/components/project-form";
import { ProjectStatusMenu } from "@/modules/projects/components/project-status-menu";
import { pageNumber, projectSubtitle } from "@/modules/projects/components/project-view";
import { RequirementCard } from "@/modules/projects/components/requirement-card";
import { NewTaskButton } from "@/modules/projects/components/task-controls";
import { TaskTable } from "@/modules/projects/components/task-table";
import { TaskWindow } from "@/modules/projects/components/task-window";
import { TeamCard } from "@/modules/projects/components/team-card";
import { daysBetween, parisDay } from "@/modules/projects/project.rules";
import {
  getProjectDetail,
  listProjectAssignees,
  type ProjectDetail,
} from "@/modules/projects/project.service";
import { getTaskDetail, listTasks, type TaskDetail } from "@/modules/projects/task.service";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Projet" };

const TASK_PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadProject(ctx: ServiceContext, id: string): Promise<ProjectDetail> {
  if (!UUID.test(id)) notFound();
  try {
    return await getProjectDetail(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Un lien vers une tâche disparue ou hors périmètre laisse simplement la fiche ouverte. */
async function loadTask(
  ctx: ServiceContext,
  projectId: string,
  taskId: string | undefined,
): Promise<TaskDetail | null> {
  if (!taskId || !UUID.test(taskId)) return null;
  try {
    const task = await getTaskDetail(ctx, taskId);
    return task.projectId === projectId ? task : null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/** M4 : une réponse s'affiche sous son commentaire, en retrait, pas à sa place dans le temps. */
function threaded(comments: TaskDetail["comments"]): TaskDetail["comments"] {
  return comments
    .filter((comment) => comment.parentId === null)
    .flatMap((root) => [root, ...comments.filter((comment) => comment.parentId === root.id)]);
}

function ageLabel(from: Date, today: string): string {
  const days = daysBetween(parisDay(from), today);
  if (days <= 0) return "aujourd’hui";
  return `${days} jour${days > 1 ? "s" : ""}`;
}

function formatMarginCents(cents: number | null): string {
  return cents === null ? "Non calculable" : formatCentsHT(cents);
}

function PlannedCard({ project }: { project: ProjectDetail }) {
  const { planned } = project;
  if (!planned) return null;
  const percent = planned.percent;
  const rows = [
    { label: "Journées vendues", value: formatDays(planned.soldMinutes) },
    { label: "Journées passées", value: formatDays(planned.spentMinutes) },
    { label: "Prévu à date", value: formatDays(planned.plannedToDateMinutes) },
  ];
  if (planned.budgetCents !== null) {
    rows.push({ label: "Budget", value: formatCentsHT(planned.budgetCents) });
  }
  if (planned.consumedCents !== null) {
    rows.push({ label: "Coût du temps", value: formatCentsHT(planned.consumedCents) });
  }
  // La marge vient de `getMargin`, comme partout : prévue et réelle restent séparées.
  if (project.margin) {
    const { forecast, actual } = project.margin;
    rows.push({ label: "Marge prévue", value: formatMarginCents(forecast.marginCents) });
    rows.push({ label: "Marge réelle", value: formatMarginCents(actual.marginCents) });
  }
  const gap = planned.gapMinutes;
  return (
    <InfoCard icon="clock" title="Prévu et réalisé" rows={rows}>
      {percent !== null ? (
        <Gauge
          value={Math.min(percent, 100)}
          tone={budgetTone(percent)}
          height={8}
          label="Consommation de l’enveloppe"
          valueText={`${Math.round(percent)} %`}
        />
      ) : null}
      {gap !== null && gap > 0 ? (
        <p className="text-xs text-warn">+{formatDays(gap)} par rapport au prévu à date.</p>
      ) : null}
      {percent !== null && percent >= 80 ? (
        <p className="text-xs text-warn">{Math.round(percent)} % de l’enveloppe consommés.</p>
      ) : null}
    </InfoCard>
  );
}

function BriefCard({ project }: { project: ProjectDetail }) {
  const rows = [
    { label: "Client", value: project.companyName },
    {
      label: "Activité",
      value: project.activity ? OFFER_ACTIVITY_LABELS[project.activity] : "—",
    },
    { label: "Priorité", value: PRIORITY_LABELS[project.priority] },
    { label: "Responsable", value: project.ownerName ?? "—" },
    { label: "Début", value: project.startOn ? formatDateShort(project.startOn) : "—" },
  ];
  return (
    <InfoCard icon="book" title="Cadrage" rows={rows}>
      {project.objective ? (
        <p className="text-sm whitespace-pre-wrap text-muted">Objectif : {project.objective}</p>
      ) : null}
      {project.scope ? (
        <p className="text-sm whitespace-pre-wrap text-muted">Périmètre : {project.scope}</p>
      ) : null}
    </InfoCard>
  );
}

function HistoryCard({ entries }: { entries: ProjectDetail["history"] }) {
  return (
    <Tile icon="clock" title="Historique" className="gap-3 rounded-lg p-6">
      <ActivityList
        items={entries.map((entry) => ({
          id: entry.id,
          date: formatDateTime(entry.occurredAt),
          title: entry.title,
          detail: entry.detail ?? undefined,
          actor: entry.actorName ?? undefined,
        }))}
        empty={<p className="text-sm text-muted">Aucun événement pour l’instant.</p>}
      />
    </Tile>
  );
}

function LinksCard({ project }: { project: ProjectDetail }) {
  return (
    <InfoCard
      icon="globe2"
      title={project.capabilities.seeBudget ? "Sites et documents" : "Documents"}
      aside={
        <CompactLink variant="quiet" href={`/documents?projet=${project.id}`}>
          Tous les documents
        </CompactLink>
      }
    >
      {project.sites.length === 0 && project.documents.length === 0 ? (
        <p className="text-sm text-muted">Aucun site ni document rattaché pour l’instant.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {project.sites.map((site) => (
            <li key={site.id} className="flex items-center justify-between gap-3">
              <Link
                href={`/sites/${site.id}`}
                className="min-w-0 truncate text-text hover:underline hover:underline-offset-4"
              >
                {site.primaryDomain ?? site.name}
              </Link>
              <StatusBadge kind="site" status={site.status} className="shrink-0" />
            </li>
          ))}
          {project.documents.slice(0, 8).map((document) => (
            <li key={document.id}>
              <a
                href={`/api/documents/${document.id}/download`}
                className="block truncate text-text hover:underline hover:underline-offset-4"
              >
                {document.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["projects:read", "projects:read_assigned"])) return <ForbiddenState />;

  const { id } = await params;
  const raw = (await searchParams) as SearchParamsLike;
  const query = {
    q: paramValue(raw, "q"),
    statut: paramValue(raw, "statut"),
    page: paramValue(raw, "page"),
    tache: paramValue(raw, "tache"),
  };
  const path = `/projets/${id}`;
  const status = TASK_STATUSES.includes(query.statut as TaskStatus)
    ? (query.statut as TaskStatus)
    : undefined;
  const search = query.q?.slice(0, 200) || undefined;
  const now = new Date();
  const today = parisDay(now);

  const project = await loadProject(ctx, id);
  const [tasks, task, members, mentionCandidates] = await Promise.all([
    listTasks(ctx, {
      projectId: id,
      status,
      search,
      page: pageNumber(query.page),
      pageSize: TASK_PAGE_SIZE,
    }),
    loadTask(ctx, id, query.tache),
    project.capabilities.edit || project.capabilities.addTask
      ? listProjectAssignees(ctx)
      : Promise.resolve([]),
    listMentionCandidates(ctx),
  ]);

  const { capabilities } = project;
  const phaseOptions = project.phases.map((phase) => ({ id: phase.id, name: phase.name }));
  const documentOptions = project.documents.map((document) => ({
    id: document.id,
    name: document.title,
  }));
  const openBlocker = project.blockers.find((blocker) => !blocker.resolvedAt);
  const expected = project.requirements.filter((item) => item.status === "expected").length;
  const closeHref = hrefWith(path, query, { tache: null });
  const taskHrefPrefix = `${closeHref}${closeHref.includes("?") ? "&" : "?"}tache=`;
  const hrefOfTask = (taskId: string) => `${taskHrefPrefix}${taskId}`;
  const filtered = Boolean(status || search);
  const showTaskFilters = filtered || tasks.total > TASK_PAGE_SIZE;

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        title={project.title}
        subtitle={projectSubtitle(project)}
        className="mb-0 lg:mb-0"
        actions={
          <>
            {can(ctx.actor, "projects:read") ? (
              <CompactLink variant="secondary" icon="globe2" href={`/espace/apercu/${project.id}`}>
                Ouvrir l&apos;espace client
              </CompactLink>
            ) : null}
            {capabilities.edit ? <EditProjectButton project={project} members={members} /> : null}
            {capabilities.addTask ? (
              <NewTaskButton projectId={project.id} members={members} phases={phaseOptions} />
            ) : null}
          </>
        }
        badges={
          <>
            {project.status === "blocked" && openBlocker ? null : (
              <StatusBadge kind="project" status={project.status} />
            )}
            {project.health.kind === "late" ? (
              <Badge tone="danger">{project.health.label}</Badge>
            ) : null}
            {openBlocker || expected > 0 ? (
              <Badge tone="warn">
                {openBlocker
                  ? `Bloqué · ${openBlocker.title.charAt(0).toLocaleLowerCase("fr-FR")}${openBlocker.title.slice(1)}`
                  : `${expected} contenu${expected > 1 ? "s" : ""} attendu${expected > 1 ? "s" : ""}`}
              </Badge>
            ) : null}
            {project.quote ? (
              <Link href={`/devis/${project.quote.id}`} className="hit-44 rounded-full">
                <Badge>Offre {project.quote.number} acceptée</Badge>
              </Link>
            ) : null}
            <ProjectStatusMenu project={project} />
          </>
        }
      />

      {project.archived ? (
        <Alert tone="warn">Ce projet est archivé : il reste consultable, plus modifiable.</Alert>
      ) : null}

      <PhaseTimeline projectId={project.id} phases={project.phases} editable={capabilities.edit} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {showTaskFilters ? (
            <FilterBar searchParam="q" searchPlaceholder="Rechercher une tâche…" label="Statut">
              <FilterChip param="statut">Toutes · {tasks.total}</FilterChip>
              {TASK_STATUSES.map((value) => (
                <FilterChip key={value} param="statut" value={value}>
                  {TASK_STATUS_LABELS[value]}
                </FilterChip>
              ))}
            </FilterBar>
          ) : null}
          <TaskTable
            tasks={tasks.items}
            total={tasks.total}
            page={tasks.page}
            pageSize={tasks.pageSize}
            path={path}
            searchParams={query}
            hrefOf={hrefOfTask}
            today={today}
            filtered={filtered}
          />
          <HandoverCard
            projectId={project.id}
            items={project.handover}
            editable={capabilities.edit}
          />
          {capabilities.seeBudget ? (
            <ChangeRequestCard
              projectId={project.id}
              requests={project.changeRequests}
              editable={capabilities.edit}
              canConvert={capabilities.convertToQuote}
            />
          ) : null}
          <BriefCard project={project} />
          {capabilities.seeBudget ? <HistoryCard entries={project.history} /> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <PlannedCard project={project} />
          <BlockerCard
            projectId={project.id}
            editable={capabilities.edit}
            blockers={project.blockers.map((blocker) => ({
              ...blocker,
              age: ageLabel(blocker.raisedAt, today),
            }))}
          />
          <DeliverableCard
            projectId={project.id}
            deliverables={project.deliverables}
            phases={phaseOptions}
            documents={documentOptions}
            editable={capabilities.edit}
          />
          <RequirementCard
            projectId={project.id}
            requirements={project.requirements}
            documents={project.documents}
            editable={capabilities.edit}
          />
          <TeamCard
            projectId={project.id}
            team={project.team}
            members={members}
            editable={capabilities.edit}
          />
          {capabilities.seeBudget || project.documents.length > 0 ? (
            <LinksCard project={project} />
          ) : null}
        </div>
      </div>

      {task ? (
        <TaskWindow
          key={task.id}
          task={task}
          closeHref={closeHref}
          taskHrefPrefix={taskHrefPrefix}
          viewer={ctx.actor.name}
          team={project.team.map((member) => ({ name: member.fullName }))}
          mentionNames={mentionCandidates.map((candidate) => candidate.name)}
          comments={threaded(task.comments).map((comment) => {
            const attached = comment.documentId
              ? task.options.documents.find((document) => document.id === comment.documentId)
              : null;
            return {
              id: comment.id,
              author: comment.authorName,
              date: formatRelativeTime(comment.createdAt, now),
              body: comment.body,
              isReply: comment.parentId !== null,
              attachment: comment.documentId
                ? {
                    name: attached?.title ?? "Document joint",
                    href: `/api/documents/${comment.documentId}/download`,
                  }
                : undefined,
            };
          })}
          history={task.history.map((entry) => ({
            id: entry.id,
            date: formatDateTime(entry.occurredAt),
            title: entry.title,
            detail: entry.detail ?? undefined,
            actor: entry.actorName ?? undefined,
          }))}
        />
      ) : null}
    </div>
  );
}
