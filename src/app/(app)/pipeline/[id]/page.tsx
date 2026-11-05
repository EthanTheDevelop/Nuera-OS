import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { ActivityList } from "@/components/ui/activity-list";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CompactLink } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { InfoCard } from "@/components/ui/info-card";
import { StepTimeline, type StepState } from "@/components/ui/step-timeline";
import { Tile } from "@/components/ui/tile";
import {
  ACTIVITY_KIND_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGES,
  type OpportunityStage,
} from "@/lib/domain-enums";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import { listAppointmentsForOpportunity } from "@/modules/appointments/appointment.service";
import { listActivitiesForOpportunity } from "@/modules/crm/activity.service";
import { listMemberOptions } from "@/modules/crm/company.service";
import { ActivityAddButton, CompleteTaskButton } from "@/modules/crm/components/activity-form";
import { listContactsForCompany } from "@/modules/crm/contact.service";
import {
  ArchiveOpportunityButton,
  NextActionButton,
} from "@/modules/sales/components/opportunity-actions";
import { EditOpportunityButton } from "@/modules/sales/components/opportunity-form";
import { cardSignal, idleLabel } from "@/modules/sales/components/opportunity-view";
import { StageMenu } from "@/modules/sales/components/stage-menu";
import {
  getOpportunity,
  getOpportunityCommercialLinks,
  getOpportunityFilterOptions,
  getOpportunityStageHistory,
  type OpportunityView,
} from "@/modules/sales/opportunity.service";
import { canOpportunityTransition, isOpportunityClosed } from "@/modules/sales/opportunity.status";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = { title: "Affaire" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_STAGES: readonly OpportunityStage[] = ["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"];

async function loadOpportunity(ctx: ServiceContext, id: string): Promise<OpportunityView> {
  if (!UUID.test(id)) notFound();
  try {
    return await getOpportunity(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Frise de l'affaire : les quatre étapes ouvertes, puis l'issue. */
function stageSteps(stage: OpportunityStage) {
  const currentIndex = PATH_STAGES.indexOf(stage);
  const closed = isOpportunityClosed(stage);
  const steps = PATH_STAGES.map((step, index) => {
    const state: StepState = closed
      ? "done"
      : index < currentIndex
        ? "done"
        : index === currentIndex
          ? "current"
          : "todo";
    return {
      id: step,
      title: OPPORTUNITY_STAGE_LABELS[step],
      state,
      detail: state === "done" ? "fait" : state === "current" ? "en cours" : "à venir",
    };
  });
  return [
    ...steps,
    {
      id: "OUTCOME",
      title: stage === "LOST" ? OPPORTUNITY_STAGE_LABELS.LOST : OPPORTUNITY_STAGE_LABELS.WON,
      state: closed ? ("current" as const) : ("todo" as const),
      detail: closed ? "clôturée" : "à venir",
    },
  ];
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "sales:read")) return <ForbiddenState />;

  const { id } = await params;
  const opportunity = await loadOpportunity(ctx, id);
  const canUpdate = can(ctx.actor, "sales:update");
  const canLog = can(ctx.actor, "crm:update");

  const [history, activities, members, filterOptions, contacts, commercial, appointments] =
    await Promise.all([
      getOpportunityStageHistory(ctx, id),
      can(ctx.actor, "crm:read") ? listActivitiesForOpportunity(ctx, id, { limit: 50 }) : [],
      canUpdate ? listMemberOptions(ctx) : Promise.resolve([]),
      canUpdate ? getOpportunityFilterOptions(ctx) : Promise.resolve({ sources: [], owners: [] }),
      opportunity.companyId
        ? listContactsForCompany(ctx, opportunity.companyId, { limit: 50 })
        : [],
      getOpportunityCommercialLinks(ctx, id),
      canAny(ctx.actor, ["messages:read", "crm:read"])
        ? listAppointmentsForOpportunity(ctx, id, { limit: 10 })
        : [],
    ]);

  const { quotes, projects } = commercial;
  const archived = opportunity.archivedAt !== null;
  const newQuoteHref =
    can(ctx.actor, "quotes:create") &&
    opportunity.companyId &&
    !archived &&
    !isOpportunityClosed(opportunity.stage)
      ? `/devis?nouveau=1&client=${opportunity.companyId}&affaire=${opportunity.id}`
      : null;
  const nextStages =
    canUpdate && !archived
      ? OPPORTUNITY_STAGES.filter(
          (stage) =>
            stage !== opportunity.stage &&
            canOpportunityTransition(opportunity.stage, stage, ctx.actor.role),
        )
      : [];
  const signal = cardSignal(opportunity);
  const openTasks = activities.filter((row) => row.kind === "task" && !row.completedAt);
  const log = activities.filter((row) => row.kind !== "task" || row.completedAt);
  const links = {
    companyId: opportunity.companyId,
    opportunityId: opportunity.id,
    contacts: contacts.map((contact) => ({ id: contact.id, fullName: contact.fullName })),
  };

  const facts = [
    {
      label: "Montant",
      value: opportunity.amountCents === null ? "—" : formatCentsHT(opportunity.amountCents),
    },
    {
      label: "Budget estimé",
      value:
        opportunity.budgetEstimateCents === null
          ? "—"
          : formatCentsHT(opportunity.budgetEstimateCents),
    },
    {
      label: "Probabilité",
      value: opportunity.probability === null ? "—" : `${opportunity.probability} %`,
    },
    {
      label: "Clôture prévue",
      value: opportunity.expectedCloseOn ? formatDate(opportunity.expectedCloseOn) : "—",
    },
    { label: "Dernière activité", value: idleLabel(opportunity.idleDays) },
    { label: "Créée le", value: formatDate(opportunity.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        breadcrumbs={[{ label: "Pipeline", href: "/pipeline" }, { label: opportunity.name }]}
        title={opportunity.name}
        subtitle={[
          opportunity.companyName,
          opportunity.amountCents === null ? null : formatCentsHT(opportunity.amountCents),
        ]
          .filter(Boolean)
          .join(" · ")}
        badges={
          <>
            <StatusBadge kind="opportunity" status={opportunity.stage} />
            {opportunity.source ? (
              <Badge>Origine : {opportunity.source.toLowerCase()}</Badge>
            ) : null}
            {opportunity.ownerName ? (
              <Badge tone="accent">Suivie par {opportunity.ownerName}</Badge>
            ) : null}
            {archived ? <Badge tone="warn">Archivée</Badge> : null}
          </>
        }
        actions={
          <>
            {canUpdate && !archived ? (
              <EditOpportunityButton
                options={{
                  members,
                  sources: filterOptions.sources,
                  canMerge: can(ctx.actor, "crm:merge"),
                }}
                opportunity={{
                  id: opportunity.id,
                  name: opportunity.name,
                  stage: opportunity.stage,
                  company:
                    opportunity.companyId && opportunity.companyName
                      ? { id: opportunity.companyId, name: opportunity.companyName }
                      : null,
                  contactId: opportunity.contactId,
                  contactName: opportunity.contactName,
                  amountCents: opportunity.amountCents,
                  expectedCloseOn: opportunity.expectedCloseOn,
                  probability: opportunity.probability,
                  source: opportunity.source,
                  need: opportunity.need,
                  budgetEstimateCents: opportunity.budgetEstimateCents,
                  ownerMemberId: opportunity.ownerMemberId,
                }}
              />
            ) : null}
            <StageMenu
              opportunity={{ id: opportunity.id, name: opportunity.name }}
              nextStages={nextStages}
            />
            {opportunity.companyId ? (
              <ButtonLink variant="accent" href={`/clients/${opportunity.companyId}`}>
                Fiche client
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {archived ? (
        <Alert tone="warn">
          Cette affaire est archivée : elle ne figure plus dans le pipeline.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Tile icon="pipeline" title="Étapes" className="rounded-lg p-6">
            <StepTimeline label="Étapes de l'affaire" steps={stageSteps(opportunity.stage)} />
            {opportunity.stage === "LOST" ? (
              <Alert tone="danger">
                Motif de perte : {opportunity.lostReason ?? "non renseigné"}
              </Alert>
            ) : null}
          </Tile>

          <Tile
            icon="devis"
            title="Devis et projet"
            aside={
              newQuoteHref ? (
                <CompactLink variant="quiet" icon="plus" href={newQuoteHref}>
                  Nouveau devis
                </CompactLink>
              ) : null
            }
            className="rounded-lg p-6"
          >
            {quotes.length === 0 && projects.length === 0 ? (
              <p className="text-sm text-muted">
                {opportunity.companyId
                  ? "Aucun devis pour cette affaire. Le projet naît de l'acceptation d'un devis."
                  : "Rattachez d'abord cette affaire à un client pour préparer un devis."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {quotes.map((quote) => (
                  <li
                    key={quote.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <Link
                      href={`/devis/${quote.id}`}
                      className="hit-44 min-w-0 flex-1 basis-48 truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
                    >
                      {quote.number} · {quote.title}
                    </Link>
                    <span className="tabular text-sm text-text">
                      {quote.totalCents === null ? "—" : formatCentsHT(quote.totalCents)}
                    </span>
                    <StatusBadge kind="quote" status={quote.status} />
                  </li>
                ))}
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <Link
                      href={`/projets/${project.id}`}
                      className="hit-44 min-w-0 flex-1 basis-48 truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
                    >
                      Projet {project.number} · {project.name}
                    </Link>
                    <StatusBadge kind="project" status={project.status} />
                  </li>
                ))}
              </ul>
            )}
          </Tile>

          <Tile
            icon="messages"
            title="Échanges"
            aside={
              canLog && !archived ? (
                <ActivityAddButton links={links} members={members} label="Consigner" />
              ) : null
            }
            className="rounded-lg p-6"
          >
            <ActivityList
              items={log.map((row) => ({
                id: row.id,
                date: formatDateShort(row.occurredAt),
                dateTime: row.occurredAt.toISOString(),
                title: `${ACTIVITY_KIND_LABELS[row.kind]} · ${row.subject}`,
                detail: row.body,
                actor: row.ownerName ?? undefined,
              }))}
              empty={
                <EmptyState
                  compact
                  icon="messages"
                  title="Aucun échange"
                  description="Appels, réunions, e-mails et notes de cette affaire apparaîtront ici."
                />
              }
            />
          </Tile>

          <Tile icon="clock" title="Historique des étapes" className="rounded-lg p-6">
            <ActivityList
              items={history.map((entry) => ({
                id: entry.id,
                date: formatDateShort(entry.at),
                dateTime: entry.at.toISOString(),
                title: entry.fromStage
                  ? `${OPPORTUNITY_STAGE_LABELS[entry.fromStage]} → ${OPPORTUNITY_STAGE_LABELS[entry.toStage]}`
                  : `Créée en ${OPPORTUNITY_STAGE_LABELS[entry.toStage]}`,
                actor: entry.actorName ?? undefined,
                detail: entry.actorName ? undefined : "Modifiée dans Twenty",
              }))}
              empty={
                <p className="text-sm text-muted">Aucun changement d&apos;étape enregistré.</p>
              }
            />
          </Tile>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard
            icon="flag"
            title="Prochaine action"
            aside={
              canUpdate && !archived ? (
                <NextActionButton
                  opportunityId={opportunity.id}
                  nextAction={opportunity.nextAction}
                  nextActionOn={opportunity.nextActionOn}
                />
              ) : null
            }
          >
            {opportunity.nextAction ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text">{opportunity.nextAction}</p>
                <p className={signal.tone === "warn" ? "text-xs text-warn" : "text-xs text-muted"}>
                  {signal.label}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">Aucune action prévue.</p>
            )}
          </InfoCard>

          <Tile
            icon="check"
            title="Tâches et relances"
            aside={
              canLog && !archived ? (
                <ActivityAddButton
                  links={links}
                  members={members}
                  defaultKind="task"
                  kinds={["task"]}
                  label="Ajouter"
                  title="Nouvelle tâche"
                />
              ) : null
            }
            className="rounded-lg p-6"
          >
            {openTasks.length === 0 ? (
              <p className="text-sm text-muted">Aucune tâche ouverte.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">{task.subject}</span>
                      <span className="block text-xs text-muted">
                        {[
                          task.dueAt ? `Pour le ${formatDateShort(task.dueAt)}` : null,
                          task.ownerName,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Sans date"}
                      </span>
                    </span>
                    {canLog && !archived ? <CompleteTaskButton activityId={task.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Tile>

          {canAny(ctx.actor, ["messages:read", "crm:read"]) ? (
            <Tile
              icon="clock"
              title="Rendez-vous"
              aside={
                <CompactLink
                  variant="quiet"
                  href={`/messages/rendez-vous?affaire=${opportunity.id}`}
                >
                  Tout voir
                </CompactLink>
              }
              className="rounded-lg p-6"
            >
              {appointments.length === 0 ? (
                <p className="text-sm text-muted">Aucun rendez-vous lié à cette affaire.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {appointments.map((appointment) => (
                    <li key={appointment.id} className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">
                        {appointment.title}
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDateShort(appointment.startsAt)} {formatTime(appointment.startsAt)}
                        {appointment.status === "cancelled" ? " · annulé" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Tile>
          ) : null}

          <InfoCard icon="clients" title="Qualification" rows={facts}>
            {opportunity.need ? (
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <p className="text-xs text-muted">Besoin</p>
                <p className="text-sm whitespace-pre-line text-text">{opportunity.need}</p>
              </div>
            ) : null}
          </InfoCard>

          {opportunity.companyId || opportunity.contactName ? (
            <InfoCard icon="messages" title="Interlocuteur">
              <dl className="flex flex-col gap-2 text-sm">
                {opportunity.companyId ? (
                  <div>
                    <dt className="text-xs text-muted">Client</dt>
                    <dd>
                      <Link
                        href={`/clients/${opportunity.companyId}`}
                        className="hit-44 font-medium text-text hover:underline hover:underline-offset-4"
                      >
                        {opportunity.companyName}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {opportunity.contactName ? (
                  <div>
                    <dt className="text-xs text-muted">Contact</dt>
                    <dd>
                      <Link
                        href={`/clients/contacts/${opportunity.contactId}`}
                        className="hit-44 font-medium text-text hover:underline hover:underline-offset-4"
                      >
                        {opportunity.contactName}
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </InfoCard>
          ) : null}

          {canUpdate ? (
            <div className="px-1">
              <ArchiveOpportunityButton
                opportunity={{ id: opportunity.id, name: opportunity.name, archived }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
