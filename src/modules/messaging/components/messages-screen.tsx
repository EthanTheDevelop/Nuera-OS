import Link from "next/link";
import { FilterChip, SearchField } from "@/components/ui/filter-bar";
import { ButtonLink } from "@/components/ui/button";
import { DataTablePagination } from "@/components/ui/data-table";
import { initialsOf } from "@/components/ui/avatar";
import { EmptyState } from "@/components/states/states";
import { hrefWith, paramValue, type SearchParamsLike } from "@/lib/url-state";
import { AppointmentFormButton } from "@/modules/appointments/components/appointment-form";
import {
  getNextAppointment,
  listAppointmentMemberOptions,
} from "@/modules/appointments/appointment.service";
import { getCompanyOption } from "@/modules/crm/company.lookup";
import { getProjectDetail, type ProjectDetail } from "@/modules/projects/project.service";
import { getQuoteDetail } from "@/modules/quotes/quote.service";
import { can } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import type { ServiceContext } from "@/server/context";
import { firstNameOf, formatInboxTime, toThreadMessage } from "../messaging.format";
import {
  getConversation,
  getInboxCounts,
  listConversations,
  listMessageMentionCandidates,
  listMessages,
  type ConversationView,
} from "../message.service";
import { parseInboxFilter } from "../messaging.schema";
import { getSuggestionPanel, getSuggestionSettings } from "../suggestion.service";
import { ClientPanel, type PanelProject } from "./client-panel";
import { ConversationList, type ConversationListItem } from "./conversation-list";
import { ConversationThread, NoSelection } from "./conversation-thread";
import {
  ArchiveConversationButton,
  NewConversationButton,
  RestoreConversationButton,
  SuggestionSettingsButton,
} from "./inbox-tools";
import { LiveRefresh } from "./live-refresh";

const NEW_PARAM = "nouvelle";

function displayTitle(conversation: ConversationView): string {
  return conversation.contactName
    ? `${firstNameOf(conversation.contactName)} · ${conversation.companyName}`
    : conversation.companyName;
}

/** Projet du panneau, lu par le service des projets : absent ou archivé, le bloc disparaît. */
async function loadProject(ctx: ServiceContext, projectId: string | null) {
  if (!projectId) return null;
  try {
    return await getProjectDetail(ctx, projectId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/** Acompte du devis accepté, lu par le service des devis : sans droit ni source, la ligne disparaît. */
async function loadDeposit(ctx: ServiceContext, project: ProjectDetail | null) {
  if (!project?.quote || !can(ctx.actor, "quotes:read")) return null;
  try {
    const detail = await getQuoteDetail(ctx, project.quote.id);
    const accepted = detail.versions.find((item) => item.id === detail.quote.acceptedVersionId);
    const percent = (accepted ?? detail.currentVersion).depositPercent;
    return percent ? { percent, paid: detail.depositPaid } : null;
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

function toPanelProject(project: ProjectDetail, deposit: PanelProject["deposit"]): PanelProject {
  const team = project.team.map((member) => member.fullName);
  return {
    id: project.id,
    offer: project.offer,
    budgetCents: project.budgetCents,
    deposit,
    dueOn: project.dueOn,
    memberNames: [...new Set(project.ownerName ? [project.ownerName, ...team] : team)],
    requirements: project.requirements.map((item) => ({
      id: item.id,
      label: item.label,
      received: item.status === "received",
    })),
  };
}

/** `Site vitrine · étape 2 / 4` ; sans jalons, l'étape annoncée au client. */
function projectBadge(project: ProjectDetail | null, stepLabel: string | null): string | null {
  if (!project) return null;
  const phases = project.phases;
  const current = phases.findIndex((phase) => phase.status !== "done");
  if (phases.length > 0 && current >= 0) {
    return `${project.offer} · étape ${current + 1} / ${phases.length}`;
  }
  return [project.offer, stepLabel].filter(Boolean).join(" · ");
}

function excerptOf(conversation: ConversationView): string {
  if (!conversation.lastExcerpt) return conversation.subject ?? "Aucun message";
  return conversation.lastDirection === "internal"
    ? `Note interne : ${conversation.lastExcerpt}`
    : conversation.lastExcerpt;
}

/**
 * Écran 02 (Figma 63:398), plein hauteur sous la coque : colonnes 340 + fil + 300.
 * Sous 1024 px, une colonne à la fois : la liste sur `/messages`, le fil sur `/messages/[id]`.
 */
export async function MessagesScreen({
  ctx,
  conversationId,
  searchParams,
}: {
  ctx: ServiceContext;
  /** Absent : `/messages`, la première conversation s'affiche sur grand écran. */
  conversationId?: string;
  searchParams: SearchParamsLike;
}) {
  const filter = parseInboxFilter(paramValue(searchParams, "filtre"));
  const search = paramValue(searchParams, "q");
  const page = paramValue(searchParams, "page");
  const canSend = can(ctx.actor, "messages:send");

  const [inbox, counts, settings, mentionCandidates] = await Promise.all([
    listConversations(ctx, { filter, search, page }),
    getInboxCounts(ctx),
    getSuggestionSettings(ctx.db),
    listMessageMentionCandidates(ctx),
  ]);
  // Une proposition ne s'ouvre qu'à qui peut répondre, et si le réglage est actif (voir le fil).
  const showReady = canSend && settings.enabled;

  const now = new Date();
  const withQuery = (id: string) => hrefWith(`/messages/${id}`, searchParams, {});
  const rows: ConversationListItem[] = inbox.items.map((conversation) => ({
    id: conversation.id,
    href: withQuery(conversation.id),
    title: displayTitle(conversation),
    initials: initialsOf(conversation.contactName ?? conversation.companyName),
    time: formatInboxTime(conversation.lastMessageAt, now),
    excerpt: excerptOf(conversation),
    unread: conversation.unread,
    ready: showReady && conversation.hasReadySuggestion,
  }));

  const firstId = inbox.items[0]?.id;
  const openId = conversationId ?? firstId;
  const opened = openId ? await getConversation(ctx, openId) : null;

  const [thread, suggestionPanel, project, nextAppointment, memberOptions] = opened
    ? await Promise.all([
        listMessages(ctx, opened.id),
        getSuggestionPanel(ctx, opened.id),
        loadProject(ctx, opened.projectId),
        getNextAppointment(ctx, { companyId: opened.companyId, projectId: opened.projectId }),
        canSend ? listAppointmentMemberOptions(ctx) : Promise.resolve([]),
      ])
    : [null, null, null, null, []];
  const deposit = await loadDeposit(ctx, project);

  const prefillCompanyId = paramValue(searchParams, "client");
  const prefillCompany =
    canSend && prefillCompanyId
      ? await getCompanyOption(ctx.db, prefillCompanyId).catch(() => null)
      : null;

  const panel = opened ? (
    <ClientPanel
      project={project ? toPanelProject(project, deposit) : null}
      nextAppointment={nextAppointment}
      scheduleAction={
        canSend && !opened.archived ? (
          <AppointmentFormButton
            label="Planifier"
            members={memberOptions}
            defaults={{
              title: "",
              company: { id: opened.companyId, name: opened.companyName },
              contactId: opened.contactId,
              projectId: opened.projectId,
            }}
          />
        ) : null
      }
      footer={
        !canSend ? null : opened.archived ? (
          <RestoreConversationButton conversationId={opened.id} />
        ) : (
          <ArchiveConversationButton conversationId={opened.id} />
        )
      }
    />
  ) : null;

  const threadBadge = opened ? projectBadge(project, opened.projectStepLabel) : null;

  return (
    <div className="-mx-4 -mt-5 -mb-12 flex h-[calc(100dvh-56px)] bg-surface lg:-mx-(--content-margin) lg:-mt-7 lg:h-dvh">
      <LiveRefresh />

      {/* Colonne des conversations. */}
      <section
        aria-label="Conversations"
        className={`anim-content min-w-0 flex-col border-r border-border lg:flex lg:w-[340px] lg:shrink-0 ${
          conversationId ? "hidden" : "flex w-full"
        }`}
      >
        <div className="flex shrink-0 flex-col gap-2 px-5 pt-5 pb-1">
          <div className="flex items-center gap-1">
            <h1 className="flex-1 text-[22px] leading-[1.25] font-semibold text-ink">Messages</h1>
            {can(ctx.actor, "integrations:manage") ? (
              <SuggestionSettingsButton settings={settings} />
            ) : null}
            {canSend ? (
              <NewConversationButton
                initialOpen={paramValue(searchParams, NEW_PARAM) === "1"}
                initialCompany={prefillCompany}
              />
            ) : null}
          </div>
          <SearchField
            param="q"
            placeholder="Chercher un client, un message…"
            label="Chercher un client, un message"
            className="sm:w-full"
          />
          <div
            role="group"
            aria-label="Filtres"
            className="flex [scrollbar-width:none] items-center gap-1 overflow-x-auto py-1"
          >
            <FilterChip param="filtre" count={counts.all}>
              Tous
            </FilterChip>
            <FilterChip param="filtre" value="clients">
              Clients
            </FilterChip>
            <FilterChip param="filtre" value="prospects">
              Prospects
            </FilterChip>
            {showReady ? (
              <FilterChip param="filtre" value="pretes" tone="chatgpt" count={counts.ready}>
                Réponse prête
              </FilterChip>
            ) : null}
            {counts.archived > 0 || filter === "archivees" ? (
              <FilterChip param="filtre" value="archivees" count={counts.archived}>
                Archivées
              </FilterChip>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length > 0 ? (
            <ConversationList items={rows} activeId={openId} />
          ) : search || filter ? (
            <EmptyState
              compact
              icon="search"
              title="Aucune conversation"
              description="Aucune conversation ne correspond à cette recherche."
            />
          ) : (
            <EmptyState
              compact
              icon="messages"
              title="Aucune conversation"
              description={
                canSend
                  ? "Ouvrez une conversation avec un client, ou attendez son premier message."
                  : "Les échanges avec les clients apparaîtront ici."
              }
            />
          )}
        </div>
        {inbox.total > inbox.pageSize ? (
          <DataTablePagination
            query={{
              pathname: conversationId ? `/messages/${conversationId}` : "/messages",
              searchParams,
            }}
            page={inbox.page}
            pageSize={inbox.pageSize}
            total={inbox.total}
          />
        ) : null}
      </section>

      {/* Fil. Sur `/messages`, seulement sur grand écran : la liste occupe le téléphone. */}
      <section
        aria-label="Fil de la conversation"
        className={`min-w-0 flex-1 flex-col lg:flex ${conversationId ? "flex" : "hidden"}`}
      >
        {opened && thread && suggestionPanel ? (
          <ConversationThread
            key={opened.id}
            conversation={{
              id: opened.id,
              companyId: opened.companyId,
              projectId: opened.projectId,
              title: opened.contactName ?? opened.companyName,
              subtitle: [opened.companyName, opened.companyActivity?.toLocaleLowerCase("fr-FR")]
                .filter(Boolean)
                .join(" · "),
              initials: initialsOf(opened.contactName ?? opened.companyName),
              badge: threadBadge,
              recipient: opened.contactName ? firstNameOf(opened.contactName) : opened.companyName,
              unread: opened.unread,
              archived: opened.archived,
            }}
            messages={thread.items.map((message) => toThreadMessage(message, now))}
            hasOlder={thread.hasMore}
            suggestionPanel={suggestionPanel}
            mentionCandidates={mentionCandidates}
            canSend={canSend}
            panel={panel}
            headerAside={
              <>
                <ButtonLink href={`/clients/${opened.companyId}`} className="max-lg:hidden">
                  Voir la fiche
                </ButtonLink>
                {/* Sur téléphone, le grand bouton prendrait une rangée entière au-dessus du fil. */}
                <Link
                  href={`/clients/${opened.companyId}`}
                  className="hit-44 text-compact-button text-accent underline-offset-4 hover:underline lg:hidden"
                >
                  Voir la fiche
                </Link>
              </>
            }
          />
        ) : (
          <NoSelection />
        )}
      </section>

      {/* Panneau client : ne bouge pas quand le fil change. */}
      {opened ? (
        <aside
          aria-label="Client et projet"
          className="anim-content hidden w-[300px] shrink-0 overflow-y-auto border-l border-border p-5 pt-6 xl:block"
        >
          {panel}
        </aside>
      ) : null}
    </div>
  );
}

/** Écran vide si `getConversation` échoue : réponse commune aux pages. */
export function MessagesLoading() {
  return (
    <div className="-mx-4 -mt-5 -mb-12 flex h-[calc(100dvh-56px)] bg-surface lg:-mx-(--content-margin) lg:-mt-7 lg:h-dvh">
      <div
        role="status"
        aria-label="Chargement des conversations"
        className="flex w-full flex-col gap-4 border-r border-border p-5 lg:w-[340px] lg:shrink-0"
      >
        <span className="anim-pulse h-6 w-28 rounded-sm bg-surface-raised" />
        <span className="anim-pulse h-9 w-full rounded-md bg-surface-raised" />
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className="flex items-start gap-3">
            <span className="anim-pulse size-9 shrink-0 rounded-full bg-surface-raised" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="anim-pulse h-3.5 w-3/4 rounded-sm bg-surface-raised" />
              <span className="anim-pulse h-3 w-full rounded-sm bg-surface-raised" />
            </span>
          </span>
        ))}
      </div>
      <div className="hidden min-w-0 flex-1 lg:block" />
      <div className="hidden w-[300px] shrink-0 border-l border-border xl:block" />
    </div>
  );
}
