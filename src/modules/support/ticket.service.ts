import {
  TICKET_COVERAGE_LABELS,
  TICKET_SEVERITY_LABELS,
  type TicketCoverage,
  type TicketStatus,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { recordAudit, type AuditEvent } from "@/modules/audit/audit.service";
import { consumeContractQuota, resolveCoverage } from "@/modules/contracts/contract.service";
import { getCompanyOption, listCompanyOptions } from "@/modules/crm/company.lookup";
import { listDocumentsFor } from "@/modules/documents/document.service";
import {
  addComment,
  listComments,
  listMentionCandidates,
  type CommentView,
} from "@/modules/messaging/comment.service";
import { emitEvent } from "@/modules/platform/events";
import { nextNumber } from "@/modules/platform/sequences";
import { getMemberIdForUser, listAssignableMembers } from "@/modules/team/team.lookup";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Ticket } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as repository from "./ticket.repository";
import type { TicketFilter, TicketRow, TicketScope } from "./ticket.repository";
import {
  addPortalTicketMessageSchema,
  addTicketCommentSchema,
  addTicketMessageSchema,
  assignTicketSchema,
  createPortalTicketSchema,
  createTicketSchema,
  logTicketTimeSchema,
  convertTicketSchema,
  ticketQuerySchema,
  transitionTicketSchema,
  updateTicketSchema,
  type AddPortalTicketMessageInput,
  type AddTicketCommentInput,
  type AddTicketMessageInput,
  type AssignTicketInput,
  type ConvertTicketInput,
  type CreatePortalTicketInput,
  type CreateTicketInput,
  type LogTicketTimeInput,
  type TicketQuery,
  type TransitionTicketInput,
  type UpdateTicketInput,
} from "./ticket.schema";
import {
  createLinkedChangeRequest,
  createLinkedQuote,
  findChangeRequestLink,
} from "./ticket.conversion";
import {
  computeDueAt,
  endOfParisDay,
  hasContractualSla,
  isTicketOpen,
  parisDay,
  startOfParisMonth,
  type TicketSla,
} from "./ticket.sla";
import { assertTicketTransition } from "./ticket.status";
import { addTicketTimeEntry, listTicketTime, sumTicketMinutes } from "./ticket.time";

export type { TicketRow, TicketScope } from "./ticket.repository";

/** Double envoi d'un formulaire : au-delà, une demande identique est une nouvelle demande. */
const DUPLICATE_WINDOW_MS = 60_000;
const MESSAGE_DUPLICATE_WINDOW_MS = 15_000;
/** Une colonne du tableau reste lisible : le reste se consulte dans la liste. */
const BOARD_COLUMN_LIMIT = 40;
const LIST_PAGE_SIZE = 25;
const COMPANY_LIST_LIMIT = 20;
const RECURRENCE_LIMIT = 10;
const DAY_MS = 86_400_000;
const AVERAGE_RESPONSE_WINDOW_MS = 90 * DAY_MS;
/** Marque, dans l'historique, la décision de couverture affichée sur la fiche. */
const COVERAGE_NOTE_PREFIX = "Couverture : ";
const NO_MEMBER = "00000000-0000-0000-0000-000000000000";
/** États où un contrat accepte encore une consommation (voir `consumeContractQuota`). */
const QUOTA_OPEN_CONTRACT_STATUSES = ["active", "to_review", "suspended"];

const href = (ticketId: string) => `/support/${ticketId}`;

function asTicketFilter(query: TicketQuery, memberId: string | null, now: Date) {
  const filter: TicketFilter = {
    search: query.q,
    status: query.statut,
    severity: query.gravite,
    coverage: query.couverture,
    companyId: query.client,
    siteId: query.site,
  };
  if (query.filtre === "miennes") {
    // Sans fiche d'équipe, « mes demandes » ne renvoie rien : aucune demande n'a cet identifiant.
    filter.assigneeMemberId = memberId ?? NO_MEMBER;
  }
  if (query.filtre === "sans_responsable") filter.unassigned = true;
  if (query.filtre === "retard") filter.overdueAt = now;
  if (query.filtre === "critiques") filter.severity = "critical";
  if (query.filtre === "incidents") filter.incident = true;
  if (query.filtre === "hors_contrat") filter.outsideContract = true;
  return filter;
}

/** Périmètre de lecture de l'acteur : la permission ne suffit pas, il s'applique dans la requête. */
async function readScope(ctx: ServiceContext): Promise<TicketScope> {
  assertCanAny(ctx.actor, ["support:read", "support:read_assigned"]);
  if (can(ctx.actor, "support:read")) return { kind: "all" };
  return { kind: "assigned", memberId: await getMemberIdForUser(ctx.db, ctx.actor.userId) };
}

async function auditTicket(
  tx: Database,
  actorId: string | null,
  action: AuditEvent["action"],
  ticketId: string,
  metadata: Record<string, unknown>,
) {
  await recordAudit(tx, { actorId, action, entityType: "ticket", entityId: ticketId, metadata });
}

// --- Règles communes ---------------------------------------------------------------------------

/** Vérifie que les rattachements appartiennent au client : réponse claire plutôt qu'erreur SQL. */
async function assertLinksBelongToCompany(
  tx: Database,
  companyId: string,
  links: { siteId?: string | null; contractId?: string | null; projectId?: string | null },
) {
  const fieldErrors: Record<string, string[]> = {};
  if (links.siteId) {
    const site = await repository.findSiteLink(tx, links.siteId);
    if (site?.companyId !== companyId)
      fieldErrors.siteId = ["Ce site n'appartient pas à ce client."];
  }
  if (links.contractId) {
    const contract = await repository.findContractLink(tx, links.contractId);
    if (contract?.companyId !== companyId) {
      fieldErrors.contractId = ["Ce contrat n'appartient pas à ce client."];
    }
  }
  if (links.projectId) {
    const project = await repository.findProjectLink(tx, links.projectId);
    if (project?.companyId !== companyId) {
      fieldErrors.projectId = ["Ce projet n'appartient pas à ce client."];
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError("Certains rattachements sont invalides.", fieldErrors);
  }
}

/**
 * Ce qui ne se propose plus dans le formulaire ne se vise pas non plus à la main : site ou projet
 * archivé, contrat résilié ou archivé. Un lien déjà posé reste valable, lui.
 */
async function assertLinksStillOpen(
  tx: Database,
  links: { siteId?: string | null; contractId?: string | null; projectId?: string | null },
  current?: { siteId: string | null; contractId: string | null; projectId: string | null },
) {
  const fieldErrors: Record<string, string[]> = {};
  if (links.siteId && links.siteId !== current?.siteId) {
    const site = await repository.findSiteLink(tx, links.siteId);
    if (site?.archivedAt) fieldErrors.siteId = ["Ce site est archivé."];
  }
  if (links.contractId && links.contractId !== current?.contractId) {
    const contract = await repository.findContractLink(tx, links.contractId);
    if (contract?.archivedAt || contract?.status === "terminated") {
      fieldErrors.contractId = ["Ce contrat n'est plus en vigueur."];
    }
  }
  if (links.projectId && links.projectId !== current?.projectId) {
    const project = await repository.findProjectLink(tx, links.projectId);
    if (project?.archivedAt) fieldErrors.projectId = ["Ce projet est archivé."];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError("Certains rattachements ne sont plus disponibles.", fieldErrors);
  }
}

/** Un seul incident ouvert par site (`tickets_open_incident_unique`) : réponse claire, pas d'erreur SQL. */
async function assertNoOtherOpenIncident(tx: Database, ticketId: string, siteId: string | null) {
  if (!siteId) return;
  const other = await repository.findOpenIncident(tx, siteId);
  if (other && other.id !== ticketId) {
    throw new ConflictError(`Un incident est déjà ouvert sur ce site : ${other.number}.`);
  }
}

async function assertAssignable(tx: Database, memberId: string): Promise<string> {
  const members = await listAssignableMembers(tx);
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) {
    throw new ValidationError("Choisissez un membre actif de l'équipe.", {
      assigneeMemberId: ["Choisissez un membre actif de l'équipe."],
    });
  }
  return member.fullName;
}

/** Délais d'un contrat encore en vigueur. Un contrat résilié n'engage plus l'agence. */
async function contractSla(tx: Database, contractId: string | null): Promise<TicketSla | null> {
  if (!contractId) return null;
  const contract = await repository.findContractLink(tx, contractId);
  if (!contract || !["active", "to_review"].includes(contract.status)) return null;
  return { responseHours: contract.responseHours, resolutionHours: contract.resolutionHours };
}

function dueFromSla(sla: TicketSla | null, openedAt: Date, firstResponseAt: Date | null) {
  return sla ? computeDueAt(openedAt, sla, firstResponseAt) : null;
}

/**
 * Échéance après une décision de couverture. Les délais du contrat priment ; sans eux, une échéance
 * convenue à la main reste, sauf si elle venait du contrat que la demande vient de quitter.
 */
async function dueAfterCoverage(tx: Database, current: Ticket, contractId: string | null) {
  const sla = await contractSla(tx, contractId);
  if (hasContractualSla(sla)) {
    return dueFromSla(sla, current.createdAt, current.firstResponseAt);
  }
  if (contractId === current.contractId) return current.dueAt;
  return hasContractualSla(await contractSla(tx, current.contractId)) ? null : current.dueAt;
}

interface NewTicket {
  companyId: string;
  siteId?: string | null;
  contractId?: string | null;
  projectId?: string | null;
  subject: string;
  description?: string | null;
  channel: Ticket["channel"];
  category: Ticket["category"];
  severity: Ticket["severity"];
  assigneeMemberId?: string | null;
  isIncident?: boolean;
  openedByUserId?: string | null;
}

/** Valeurs d'une nouvelle demande : le contrat du site s'applique tant qu'aucun n'est choisi. */
async function prepareTicket(tx: Database, input: NewTicket, openedAt: Date) {
  let contractId = input.contractId ?? null;
  if (!contractId && input.siteId) {
    const site = await repository.findSiteLink(tx, input.siteId);
    contractId = site?.contractId ?? null;
  }
  const sla = await contractSla(tx, contractId);
  return {
    number: await nextNumber(tx, "ticket", openedAt),
    companyId: input.companyId,
    siteId: input.siteId ?? null,
    contractId,
    projectId: input.projectId ?? null,
    subject: input.subject,
    description: input.description ?? null,
    channel: input.channel,
    category: input.category,
    severity: input.severity,
    assigneeMemberId: input.assigneeMemberId ?? null,
    isIncident: input.isIncident ?? false,
    openedByUserId: input.openedByUserId ?? null,
    dueAt: dueFromSla(sla, openedAt, null),
    createdAt: openedAt,
    updatedAt: openedAt,
  };
}

/** Ce qui accompagne toute nouvelle demande : historique, événements, journal. */
async function recordCreation(
  tx: Database,
  ticket: Ticket,
  actorId: string | null,
  action: AuditEvent["action"],
  note?: string,
) {
  await repository.insertEvent(tx, {
    ticketId: ticket.id,
    fromStatus: null,
    toStatus: "received",
    actorId,
    note: note ?? null,
    at: ticket.createdAt,
  });
  await emitEvent(tx, {
    type: "ticket.created",
    entityType: "ticket",
    entityId: ticket.id,
    companyId: ticket.companyId,
    actorId,
    dedupeKey: `ticket.created:${ticket.id}`,
    payload: {
      number: ticket.number,
      subject: ticket.subject,
      severity: ticket.severity,
      channel: ticket.channel,
      siteId: ticket.siteId,
    },
  });
  if (ticket.severity === "critical") await emitCritical(tx, ticket, actorId);
  await auditTicket(tx, actorId, action, ticket.id, {
    number: ticket.number,
    companyId: ticket.companyId,
    channel: ticket.channel,
    severity: ticket.severity,
  });
}

async function emitCritical(tx: Database, ticket: Ticket, actorId: string | null) {
  await emitEvent(tx, {
    type: "ticket.critical",
    entityType: "ticket",
    entityId: ticket.id,
    companyId: ticket.companyId,
    actorId,
    dedupeKey: `ticket.critical:${ticket.id}`,
    payload: { number: ticket.number, subject: ticket.subject, siteId: ticket.siteId },
  });
}

// --- Lecture -----------------------------------------------------------------------------------

export interface SupportBoardColumn {
  status: TicketStatus;
  items: TicketRow[];
  total: number;
}

export interface SupportOverview {
  counts: Record<TicketStatus, number>;
  open: number;
  overdue: number;
  critical: number;
  unassigned: number;
  closedThisMonth: number;
  avgFirstResponseMinutes: number | null;
}

async function overview(db: Database, scope: TicketScope, now: Date): Promise<SupportOverview> {
  const [counts, counters] = await Promise.all([
    repository.countByStatus(db, scope),
    repository.readCounters(db, scope, now, {
      responseSince: new Date(now.getTime() - AVERAGE_RESPONSE_WINDOW_MS),
      closedSince: startOfParisMonth(now),
    }),
  ]);
  return {
    counts,
    open: counts.received + counts.qualified + counts.in_progress,
    overdue: counters.overdue,
    critical: counters.critical,
    unassigned: counters.unassigned,
    closedThisMonth: counters.closedSince,
    avgFirstResponseMinutes: counters.avgFirstResponseMinutes,
  };
}

/** Résumé de l'agence pour le tableau de bord et les automatisations : aucun acteur. */
export async function getSupportSummary(db: Database, now: Date = new Date()) {
  return overview(db, { kind: "all" }, now);
}

/** Résumé dans le périmètre de l'acteur : en-tête de l'écran, compteur de la barre latérale. */
export async function getSupportOverview(ctx: ServiceContext, now: Date = new Date()) {
  return overview(ctx.db, await readScope(ctx), now);
}

export async function getSupportBoard(
  ctx: ServiceContext,
  rawQuery: unknown,
): Promise<SupportBoardColumn[]> {
  const scope = await readScope(ctx);
  const query = parseInput(ticketQuerySchema, rawQuery);
  const memberId = await getMemberIdForUser(ctx.db, ctx.actor.userId);
  const filter = asTicketFilter(query, memberId, new Date());
  const totals = await repository.countByStatus(ctx.db, scope, filter);
  const statuses: TicketStatus[] = ["received", "qualified", "in_progress", "resolved", "closed"];
  return Promise.all(
    statuses.map(async (status) => ({
      status,
      total: totals[status],
      items:
        filter.status && filter.status !== status
          ? []
          : await repository.listBoardColumn(ctx.db, scope, filter, status, BOARD_COLUMN_LIMIT),
    })),
  );
}

export async function listTickets(ctx: ServiceContext, rawQuery: unknown) {
  const scope = await readScope(ctx);
  const query = parseInput(ticketQuerySchema, rawQuery);
  const memberId = await getMemberIdForUser(ctx.db, ctx.actor.userId);
  const page = query.page ?? 1;
  const { items, total } = await repository.listTicketRows(
    ctx.db,
    scope,
    asTicketFilter(query, memberId, new Date()),
    { page, pageSize: LIST_PAGE_SIZE, sort: query.tri, direction: query.sens },
  );
  return { items, total, page, pageSize: LIST_PAGE_SIZE };
}

export interface CompanyTicketRow {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  severity: Ticket["severity"];
  coverage: TicketCoverage;
  siteId: string | null;
  siteName: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  createdAt: Date;
  isIncident: boolean;
  href: string;
}

/** Demandes d'un client pour sa fiche 360° : les plus récentes, dans le périmètre de l'acteur. */
export async function listTicketsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyTicketRow[]> {
  const scope = await readScope(ctx);
  const { items } = await repository.listTicketRows(
    ctx.db,
    scope,
    { companyId },
    { page: 1, pageSize: options.limit ?? COMPANY_LIST_LIMIT },
  );
  return items.map((row) => ({
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    severity: row.severity,
    coverage: row.coverage,
    siteId: row.siteId,
    siteName: row.siteName,
    assigneeName: row.assigneeName,
    dueAt: row.dueAt,
    createdAt: row.createdAt,
    isIncident: row.isIncident,
    href: href(row.id),
  }));
}

/**
 * Demandes ouvertes qui arrivent à échéance ou l'ont dépassée, pour les alertes. Pas d'acteur :
 * appelé par une tâche planifiée.
 */
export async function listTicketsNearingDue(
  db: Database,
  now: Date,
  options: { withinHours?: number; limit?: number } = {},
) {
  const before = new Date(now.getTime() + (options.withinHours ?? 4) * 3_600_000);
  return repository.listDueBefore(db, before, options.limit ?? 200);
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;

/** La fiche d'une demande. Hors périmètre : 404, comme si elle n'existait pas. */
export async function getTicketDetail(ctx: ServiceContext, ticketId: string) {
  const ticket = await getTicketAccess(ctx, ticketId);

  const [messages, events, sla, changeRequest] = await Promise.all([
    repository.listMessages(ctx.db, ticketId, { includeInternal: true }),
    repository.listEvents(ctx.db, ticketId),
    contractSla(ctx.db, ticket.contractId),
    findChangeRequestLink(ctx.db, ticket.changeRequestId),
  ]);
  return {
    ticket,
    messages,
    events,
    sla,
    // Le numéro du devis ne vaut que pour qui peut l'ouvrir : pas de lien mort.
    changeRequest:
      changeRequest && !can(ctx.actor, "quotes:read")
        ? { ...changeRequest, quoteId: null, quoteNumber: null }
        : changeRequest,
    coverageReason: lastCoverageReason(events),
  };
}

/** Dernière décision de couverture écrite dans l'historique, sans son préfixe. */
function lastCoverageReason(events: readonly { note: string | null }[]): string | null {
  const event = [...events].reverse().find((row) => row.note?.includes(COVERAGE_NOTE_PREFIX));
  const note = event?.note;
  if (!note) return null;
  return note.slice(note.lastIndexOf(COVERAGE_NOTE_PREFIX) + COVERAGE_NOTE_PREFIX.length);
}

/** Libellés des filtres posés dans l'URL. Le prestataire n'apprend aucun nom hors de son périmètre. */
export async function getTicketFilterLabels(
  ctx: ServiceContext,
  rawQuery: unknown,
): Promise<{ client: string | null; site: string | null }> {
  const scope = await readScope(ctx);
  const query = parseInput(ticketQuerySchema, rawQuery);
  if (scope.kind !== "all") return { client: null, site: null };
  const [company, site] = await Promise.all([
    query.client ? repository.findCompanyLabel(ctx.db, query.client) : null,
    query.site ? repository.findSiteLink(ctx.db, query.site) : null,
  ]);
  return { client: company?.name ?? null, site: site ? (site.primaryDomain ?? site.name) : null };
}

export async function getTicketComments(
  ctx: ServiceContext,
  ticketId: string,
): Promise<CommentView[]> {
  await getTicketAccess(ctx, ticketId);
  return listComments(ctx, { entityType: "ticket", entityId: ticketId });
}

/** Un identifiant mal formé désigne une demande qui n'existe pas : 404, pas d'erreur SQL. */
const ticketIdSchema = z.uuid();

function assertTicketId(ticketId: string) {
  if (!ticketIdSchema.safeParse(ticketId).success) throw new NotFoundError("Demande introuvable.");
}

async function getTicketAccess(ctx: ServiceContext, ticketId: string) {
  const scope = await readScope(ctx);
  const ticket = ticketIdSchema.safeParse(ticketId).success
    ? await repository.findTicketRow(ctx.db, scope, ticketId)
    : null;
  if (!ticket) throw new NotFoundError("Demande introuvable.");
  return ticket;
}

export async function getTicketTime(ctx: ServiceContext, ticketId: string) {
  await getTicketAccess(ctx, ticketId);
  return listTicketTime(ctx, ticketId);
}

/** Listes de choix des formulaires. Jamais de coût ni de tarif. */
export async function getTicketFormOptions(ctx: ServiceContext) {
  assertCanAny(ctx.actor, ["support:create", "support:update"]);
  const [companies, members] = await Promise.all([
    listCompanyOptions(ctx.db, { limit: 500 }),
    listAssignableMembers(ctx.db),
  ]);
  return { companies, members };
}

/** Documents joints à la demande, par le service du module Documents. */
export async function getTicketAttachments(ctx: ServiceContext, ticketId: string) {
  await getTicketAccess(ctx, ticketId);
  return listDocumentsFor(ctx, { ticketId });
}

/** Membres mentionnables et attribuables, pour la fenêtre. */
export async function getTicketPeople(ctx: ServiceContext) {
  await readScope(ctx);
  const [members, mentionCandidates] = await Promise.all([
    can(ctx.actor, "support:update") ? listAssignableMembers(ctx.db) : [],
    listMentionCandidates(ctx),
  ]);
  return { members, mentionCandidates };
}

export async function getCompanyTargets(ctx: ServiceContext, companyId: string) {
  assertCanAny(ctx.actor, ["support:create", "support:update"]);
  const company = ticketIdSchema.safeParse(companyId).success
    ? await getCompanyOption(ctx.db, companyId)
    : null;
  if (!company) throw new NotFoundError("Client introuvable.");
  return repository.listCompanyTargets(ctx.db, companyId);
}

/** Clients et sites les plus demandeurs (09.04.03). Réservé à qui voit toutes les demandes. */
export async function getTicketRecurrence(
  ctx: ServiceContext,
  options: { days: number },
  now: Date = new Date(),
) {
  assertCan(ctx.actor, "support:read");
  const since = new Date(now.getTime() - options.days * DAY_MS);
  const [companies, sites] = await Promise.all([
    repository.topCompanies(ctx.db, since, RECURRENCE_LIMIT),
    repository.topSites(ctx.db, since, RECURRENCE_LIMIT),
  ]);
  return { companies, sites, since };
}

// --- Écriture ----------------------------------------------------------------------------------

export async function createTicket(ctx: ServiceContext, input: CreateTicketInput): Promise<Ticket> {
  assertCan(ctx.actor, "support:create");
  const data = parseInput(createTicketSchema, input);
  const now = new Date();
  return ctx.db.transaction(async (tx) => {
    const company = await repository.findCompanyLabel(tx, data.companyId);
    if (!company || company.archivedAt) {
      throw new ValidationError("Client introuvable.", { companyId: ["Client introuvable."] });
    }
    await assertLinksBelongToCompany(tx, data.companyId, data);
    await assertLinksStillOpen(tx, data);
    if (data.assigneeMemberId) await assertAssignable(tx, data.assigneeMemberId);

    await repository.lockDuplicateKey(tx, `ticket:${data.companyId}:${data.subject}`);
    const duplicate = await repository.findRecentDuplicate(tx, {
      companyId: data.companyId,
      subject: data.subject,
      openedByUserId: ctx.actor.userId,
      since: new Date(now.getTime() - DUPLICATE_WINDOW_MS),
    });
    if (duplicate) return duplicate;

    const ticket = await repository.insertTicket(
      tx,
      await prepareTicket(tx, { ...data, openedByUserId: ctx.actor.userId }, now),
    );
    await recordCreation(tx, ticket, ctx.actor.userId, "ticket.created");
    return ticket;
  });
}

export async function updateTicket(ctx: ServiceContext, input: UpdateTicketInput): Promise<Ticket> {
  assertCan(ctx.actor, "support:update");
  const data = parseInput(updateTicketSchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, data.ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.status === "closed") {
      throw new ConflictError("Une demande clôturée ne se modifie plus.");
    }
    await assertLinksBelongToCompany(tx, current.companyId, data);
    await assertLinksStillOpen(tx, data, current);

    // Un champ absent ne dit rien : seul un champ vidé retire le lien.
    const siteId = data.siteId === undefined ? current.siteId : data.siteId;
    const contractId = data.contractId === undefined ? current.contractId : data.contractId;
    const projectId = data.projectId === undefined ? current.projectId : data.projectId;
    if (current.isIncident && siteId !== current.siteId && isTicketOpen(current.status)) {
      await assertNoOtherOpenIncident(tx, current.id, siteId);
    }

    const sla = await contractSla(tx, contractId);
    // Le contrat fixe les délais quand il en prévoit ; sinon l'échéance se convient à la main.
    let dueAt: Date | null;
    if (hasContractualSla(sla)) {
      dueAt = dueFromSla(sla, current.createdAt, current.firstResponseAt);
    } else if (data.dueOn === undefined) {
      dueAt = await dueAfterCoverage(tx, current, contractId);
    } else if (!data.dueOn) {
      dueAt = null;
    } else {
      // Le formulaire montre un jour : le renvoyer tel quel ne déplace pas l'heure de l'échéance.
      const sameDay = current.dueAt !== null && parisDay(current.dueAt) === data.dueOn;
      dueAt = sameDay ? current.dueAt : endOfParisDay(data.dueOn);
    }

    const ticket = await repository.updateTicketRow(tx, current.id, {
      subject: data.subject,
      description: data.description === undefined ? current.description : data.description,
      siteId,
      contractId,
      projectId,
      category: data.category,
      severity: data.severity,
      coverage: data.coverage,
      dueAt,
    });

    const changes: string[] = [];
    if (current.severity !== ticket.severity) {
      changes.push(
        `Gravité : ${TICKET_SEVERITY_LABELS[current.severity]} → ${TICKET_SEVERITY_LABELS[ticket.severity]}`,
      );
    }
    if (current.coverage !== ticket.coverage) {
      changes.push(
        `Couverture modifiée : ${TICKET_COVERAGE_LABELS[current.coverage]} → ${TICKET_COVERAGE_LABELS[ticket.coverage]}`,
      );
      await auditTicket(tx, ctx.actor.userId, "ticket.coverage_changed", ticket.id, {
        from: current.coverage,
        to: ticket.coverage,
      });
    }
    if ((current.dueAt?.getTime() ?? null) !== (ticket.dueAt?.getTime() ?? null)) {
      changes.push("Échéance modifiée");
    }
    if (changes.length > 0) {
      await repository.insertEvent(tx, {
        ticketId: ticket.id,
        fromStatus: current.status,
        toStatus: current.status,
        actorId: ctx.actor.userId,
        note: changes.join(" · "),
      });
    }
    if (ticket.severity === "critical" && current.severity !== "critical") {
      await emitCritical(tx, ticket, ctx.actor.userId);
    }
    await auditTicket(tx, ctx.actor.userId, "ticket.updated", ticket.id, {
      number: ticket.number,
    });
    return ticket;
  });
}

export async function assignTicket(ctx: ServiceContext, input: AssignTicketInput): Promise<Ticket> {
  assertCan(ctx.actor, "support:update");
  const data = parseInput(assignTicketSchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, data.ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    const assignee = data.assigneeMemberId ?? null;
    if (current.assigneeMemberId === assignee) return current; // Rien à faire : idempotent.
    if (current.status === "closed") {
      throw new ConflictError("Une demande clôturée ne se réattribue plus.");
    }
    if (!assignee && current.status === "in_progress") {
      throw new ConflictError("Une demande en cours garde un responsable.");
    }
    const name = assignee ? await assertAssignable(tx, assignee) : null;
    const ticket = await repository.updateTicketRow(tx, current.id, { assigneeMemberId: assignee });
    await repository.insertEvent(tx, {
      ticketId: ticket.id,
      fromStatus: current.status,
      toStatus: current.status,
      actorId: ctx.actor.userId,
      note: name ? `Attribuée à ${name}` : "Attribution retirée",
    });
    await auditTicket(tx, ctx.actor.userId, "ticket.assigned", ticket.id, {
      assigneeMemberId: assignee,
    });
    return ticket;
  });
}

/**
 * Changement d'état, seul chemin vers `tickets.status` (A5, §4). Demander l'état où la demande se
 * trouve déjà ne fait rien : le glisser-déposer rejoué ou le double clic n'imputent pas deux fois.
 */
export async function transitionTicket(
  ctx: ServiceContext,
  input: TransitionTicketInput,
): Promise<Ticket> {
  assertCan(ctx.actor, "support:update");
  const data = parseInput(transitionTicketSchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, data.ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.status === data.toStatus) return current;
    assertTicketTransition(current.status, data.toStatus);

    const now = new Date();
    const patch: Partial<Ticket> = { status: data.toStatus };
    let note = data.note ?? null;

    if (data.assigneeMemberId && data.assigneeMemberId !== current.assigneeMemberId) {
      await assertAssignable(tx, data.assigneeMemberId);
      patch.assigneeMemberId = data.assigneeMemberId;
    }
    const assignee = patch.assigneeMemberId ?? current.assigneeMemberId;

    if (data.toStatus === "qualified") {
      const decision = await resolveCoverage(tx, {
        companyId: current.companyId,
        siteId: current.siteId,
        contractId: current.contractId,
        category: current.category,
      });
      patch.coverage = decision.coverage;
      patch.contractId = decision.contractId;
      patch.dueAt = await dueAfterCoverage(tx, current, decision.contractId);
      const reason = `${COVERAGE_NOTE_PREFIX}${decision.reason}`;
      note = note ? `${note}\n${reason}` : reason;
    }

    if (data.toStatus === "in_progress" && !assignee) {
      throw new ConflictError("Attribuez un responsable avant de prendre la demande en charge.", {
        assigneeMemberId: ["Choisissez un responsable."],
      });
    }

    if (data.toStatus === "resolved") patch.resolvedAt = now;
    if (current.status === "resolved" && data.toStatus === "in_progress") {
      if (current.isIncident) await assertNoOtherOpenIncident(tx, current.id, current.siteId);
      patch.resolvedAt = null;
      note = note ?? "Rouverte";
    }

    if (data.toStatus === "closed") {
      if (!note) {
        throw new ConflictError("Indiquez ce qui a été vérifié avant de clôturer.", {
          note: ["Indiquez ce qui a été vérifié."],
        });
      }
      patch.closedAt = now;
      // Les heures passées alimentent le forfait, une seule fois : une demande clôturée ne rouvre pas.
      // Un forfait au nombre de demandes compte la demande, même sans temps saisi.
      if (current.contractId && ["covered", "overage"].includes(current.coverage)) {
        const minutes = await sumTicketMinutes(tx, current.id);
        const contract = await repository.findContractLink(tx, current.contractId);
        const toImpute = minutes > 0 || (contract?.includedTickets ?? null) !== null;
        if (toImpute && contract && QUOTA_OPEN_CONTRACT_STATUSES.includes(contract.status)) {
          await consumeContractQuota(tx, {
            contractId: current.contractId,
            minutes,
            ticketId: current.id,
            actorId: ctx.actor.userId,
            now,
          });
        } else if (toImpute) {
          // Résilié ou expiré entre-temps : la demande se clôture, l'écart reste écrit.
          note = `${note}\nTemps non imputé : le contrat n'est plus en vigueur.`;
        }
      }
    }

    const ticket = await repository.updateTicketRow(tx, current.id, patch);
    await repository.insertEvent(tx, {
      ticketId: ticket.id,
      fromStatus: current.status,
      toStatus: data.toStatus,
      actorId: ctx.actor.userId,
      note,
      at: now,
    });
    if (patch.assigneeMemberId) {
      await auditTicket(tx, ctx.actor.userId, "ticket.assigned", ticket.id, {
        assigneeMemberId: patch.assigneeMemberId,
      });
    }
    if (patch.coverage && patch.coverage !== current.coverage) {
      await auditTicket(tx, ctx.actor.userId, "ticket.coverage_changed", ticket.id, {
        from: current.coverage,
        to: patch.coverage,
      });
    }
    await auditTicket(
      tx,
      ctx.actor.userId,
      data.toStatus === "closed" ? "ticket.closed" : "ticket.status_changed",
      ticket.id,
      { number: ticket.number, from: current.status, to: data.toStatus },
    );
    if (data.toStatus === "closed") {
      await emitEvent(tx, {
        type: "ticket.closed",
        entityType: "ticket",
        entityId: ticket.id,
        companyId: ticket.companyId,
        actorId: ctx.actor.userId,
        dedupeKey: `ticket.closed:${ticket.id}`,
        payload: { number: ticket.number, subject: ticket.subject },
      });
    }
    return ticket;
  });
}

/** Refait la décision de couverture, après un changement de contrat, de site ou de catégorie. */
export async function refreshTicketCoverage(
  ctx: ServiceContext,
  ticketId: string,
): Promise<Ticket> {
  assertCan(ctx.actor, "support:update");
  assertTicketId(ticketId);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.status === "closed") {
      throw new ConflictError("Une demande clôturée garde la couverture de sa clôture.");
    }
    const decision = await resolveCoverage(tx, {
      companyId: current.companyId,
      siteId: current.siteId,
      contractId: current.contractId,
      category: current.category,
    });
    const dueAt = await dueAfterCoverage(tx, current, decision.contractId);
    // Recalculer sans que rien n'ait changé ne laisse aucune trace : le bouton se clique sans risque.
    const unchanged =
      decision.coverage === current.coverage &&
      decision.contractId === current.contractId &&
      dueAt?.getTime() === current.dueAt?.getTime() &&
      decision.reason === lastCoverageReason(await repository.listEvents(tx, current.id));
    if (unchanged) return current;

    const ticket = await repository.updateTicketRow(tx, current.id, {
      coverage: decision.coverage,
      contractId: decision.contractId,
      dueAt,
    });
    await repository.insertEvent(tx, {
      ticketId: ticket.id,
      fromStatus: current.status,
      toStatus: current.status,
      actorId: ctx.actor.userId,
      note: `${COVERAGE_NOTE_PREFIX}${decision.reason}`,
    });
    if (decision.coverage !== current.coverage) {
      await auditTicket(tx, ctx.actor.userId, "ticket.coverage_changed", ticket.id, {
        from: current.coverage,
        to: decision.coverage,
      });
    }
    await auditTicket(tx, ctx.actor.userId, "ticket.updated", ticket.id, {
      number: ticket.number,
      contractId: decision.contractId,
      coverageRefreshed: true,
    });
    return ticket;
  });
}

/** Réponse au client ou note interne. Une réponse au client arrête le délai de première réponse. */
export async function addTicketMessage(ctx: ServiceContext, input: AddTicketMessageInput) {
  assertCan(ctx.actor, "support:update");
  const data = parseInput(addTicketMessageSchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, data.ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.status === "closed") {
      throw new ConflictError("Une demande clôturée ne reçoit plus de message.");
    }
    const now = new Date();
    const duplicate = await repository.findRecentSameMessage(tx, {
      ticketId: current.id,
      authorUserId: ctx.actor.userId,
      body: data.body,
      internal: data.internal,
      since: new Date(now.getTime() - MESSAGE_DUPLICATE_WINDOW_MS),
    });
    if (duplicate) return duplicate;

    const message = await repository.insertMessage(tx, {
      ticketId: current.id,
      authorUserId: ctx.actor.userId,
      body: data.body,
      internal: data.internal,
      at: now,
    });
    if (!data.internal && !current.firstResponseAt) {
      const sla = await contractSla(tx, current.contractId);
      await repository.updateTicketRow(tx, current.id, {
        firstResponseAt: now,
        dueAt: hasContractualSla(sla) ? dueFromSla(sla, current.createdAt, now) : current.dueAt,
      });
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "ticket.replied",
      entityType: "ticket_message",
      entityId: message.id,
      metadata: { ticketId: current.id, internal: data.internal },
    });
    return message;
  });
}

/**
 * Commentaire d'équipe et mentions, par le service partagé du lot Messages. Un prestataire commente
 * les demandes qui lui sont attribuées : son périmètre s'applique ici et dans `addComment`.
 */
export async function addTicketComment(ctx: ServiceContext, input: AddTicketCommentInput) {
  assertCanAny(ctx.actor, ["support:update", "support:read_assigned"]);
  const data = parseInput(addTicketCommentSchema, input);
  const ticket = await getTicketAccess(ctx, data.ticketId);
  return addComment(ctx, {
    entityType: "ticket",
    entityId: ticket.id,
    companyId: ticket.companyId,
    body: data.body,
    mentions: data.mentions,
    parentId: data.parentId ?? undefined,
    href: href(ticket.id),
  });
}

/** Temps passé sur la demande, par le service du module Temps : un prestataire y a droit. */
export async function logTicketTime(ctx: ServiceContext, input: LogTicketTimeInput) {
  assertCanAny(ctx.actor, ["support:update", "time:create_own"]);
  const data = parseInput(logTicketTimeSchema, input);
  const ticket = await getTicketAccess(ctx, data.ticketId);
  if (ticket.status === "closed") {
    throw new ConflictError("Le temps d'une demande clôturée est déjà imputé.");
  }
  return addTicketTimeEntry(ctx, {
    ticketId: ticket.id,
    minutes: data.minutes,
    workOn: data.workOn,
    billable: data.billable,
    note: data.note ?? null,
  });
}

/**
 * Transforme une demande hors forfait ou non couverte en demande de changement ou en devis, sans
 * perdre le lien. Rejouer la conversion renvoie ce qui existe déjà.
 */
export async function convertTicket(ctx: ServiceContext, input: ConvertTicketInput) {
  assertCan(ctx.actor, "support:update");
  const data = parseInput(convertTicketSchema, input);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, data.ticketId);
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.coverage !== "overage" && current.coverage !== "not_covered") {
      throw new ConflictError(
        "Seule une demande hors forfait ou non couverte se transforme en prestation.",
      );
    }
    const scoped: ServiceContext = { ...ctx, db: tx };
    const existing = await findChangeRequestLink(tx, current.changeRequestId);
    if (existing && (data.target === "change_request" || existing.quoteId)) return existing;

    let changeRequestId = current.changeRequestId;
    if (!changeRequestId) {
      changeRequestId = await createLinkedChangeRequest(scoped, current);
      await repository.updateTicketRow(tx, current.id, { changeRequestId });
    }
    let note = "Transformée en demande de changement";
    if (data.target === "quote") {
      await createLinkedQuote(scoped, current, changeRequestId);
      note = "Transformée en devis";
    }
    await repository.insertEvent(tx, {
      ticketId: current.id,
      fromStatus: current.status,
      toStatus: current.status,
      actorId: ctx.actor.userId,
      note,
    });
    await auditTicket(tx, ctx.actor.userId, "ticket.updated", current.id, {
      number: current.number,
      conversion: data.target,
      changeRequestId,
    });
    const link = await findChangeRequestLink(tx, changeRequestId);
    if (!link) throw new Error("Demande de changement introuvable après sa création.");
    return link;
  });
}

/** Archivage : la demande sort des listes, son historique reste. Une clôture ne s'efface pas. */
export async function archiveTicket(ctx: ServiceContext, ticketId: string): Promise<Ticket> {
  assertCan(ctx.actor, "support:update");
  assertTicketId(ticketId);
  return ctx.db.transaction(async (tx) => {
    const current = await repository.lockTicket(tx, ticketId, { includeArchived: true });
    if (!current) throw new NotFoundError("Demande introuvable.");
    if (current.archivedAt) return current; // Déjà fait : un double clic ne journalise rien de plus.
    const ticket = await repository.updateTicketRow(tx, current.id, { archivedAt: new Date() });
    await auditTicket(tx, ctx.actor.userId, "ticket.archived", ticket.id, {
      number: ticket.number,
    });
    return ticket;
  });
}

// --- Incidents ---------------------------------------------------------------------------------

export interface OpenIncidentTicketInput {
  siteId: string;
  title: string;
  /** Origine de l'alerte : `uptime_kuma`, `coolify`… */
  source: string;
}

/**
 * Ouvre un ticket d'incident pour un site. Idempotent par incident ouvert (index unique partiel
 * `tickets_open_incident_unique`) : une panne qui se répète renvoie le ticket déjà ouvert, y compris
 * si deux alertes arrivent en même temps. Sans acteur : appelé par la surveillance.
 */
export async function openIncidentTicket(
  tx: Database,
  input: OpenIncidentTicketInput,
): Promise<Ticket> {
  const existing = await repository.findOpenIncident(tx, input.siteId);
  if (existing) return existing;

  const site = await repository.findSiteLink(tx, input.siteId);
  if (!site) throw new NotFoundError("Site introuvable.");

  const now = new Date();
  const created = await repository.insertIncidentIfNone(
    tx,
    await prepareTicket(
      tx,
      {
        companyId: site.companyId,
        siteId: site.id,
        subject: input.title,
        description: `Alerte reçue de ${input.source}.`,
        channel: "monitoring",
        category: "incident",
        severity: "critical",
        isIncident: true,
      },
      now,
    ),
  );
  if (!created) {
    const concurrent = await repository.findOpenIncident(tx, input.siteId);
    if (!concurrent) throw new Error("Incident ni créé ni retrouvé.");
    return concurrent;
  }
  await recordCreation(tx, created, null, "ticket.created", `Alerte de ${input.source}`);
  return created;
}

// --- Portail client ----------------------------------------------------------------------------

/** Demande ouverte par un client depuis son espace : toujours rattachée à son entreprise. */
export async function createTicketFromPortal(
  portalCtx: PortalContext,
  input: CreatePortalTicketInput,
): Promise<{ id: string; number: string; status: TicketStatus }> {
  const data = parseInput(createPortalTicketSchema, input);
  const now = new Date();
  return portalCtx.db.transaction(async (tx) => {
    if (data.siteId) {
      const site = await repository.findSiteLink(tx, data.siteId);
      // Le site d'un autre client, ou un site archivé, n'existe pas pour ce client.
      if (site?.companyId !== portalCtx.companyId || site.archivedAt) {
        throw new NotFoundError("Site introuvable.");
      }
    }
    await repository.lockDuplicateKey(tx, `ticket:${portalCtx.companyId}:${data.subject}`);
    const duplicate = await repository.findRecentDuplicate(tx, {
      companyId: portalCtx.companyId,
      subject: data.subject,
      openedByUserId: portalCtx.actor.userId,
      since: new Date(now.getTime() - DUPLICATE_WINDOW_MS),
    });
    const ticket =
      duplicate ??
      (await repository.insertTicket(
        tx,
        await prepareTicket(
          tx,
          {
            companyId: portalCtx.companyId,
            siteId: data.siteId ?? null,
            subject: data.subject,
            description: data.description ?? null,
            channel: "portal",
            category: data.category,
            severity: "medium",
            openedByUserId: portalCtx.actor.userId,
          },
          now,
        ),
      ));
    if (!duplicate) {
      await recordCreation(tx, ticket, portalCtx.actor.userId, "portal.ticket_opened");
    }
    return { id: ticket.id, number: ticket.number, status: ticket.status };
  });
}

export type PortalTicketRow = Awaited<ReturnType<typeof repository.listPortalRows>>[number];

/** Les demandes de l'entreprise du client, sans aucune donnée interne. */
export async function listTicketsForPortal(
  portalCtx: PortalContext,
  options: { limit?: number } = {},
): Promise<PortalTicketRow[]> {
  return repository.listPortalRows(portalCtx.db, portalCtx.companyId, options.limit ?? 100);
}

export interface PortalTicketMessage {
  id: string;
  body: string;
  at: Date;
  authorName: string;
  fromClient: boolean;
}

export type PortalTicketDetail = PortalTicketRow & {
  description: string | null;
  messages: PortalTicketMessage[];
  timeline: { status: TicketStatus; at: Date }[];
};

/** Fiche côté client. Demande d'un autre client : 404. Les messages internes n'en sortent jamais. */
export async function getTicketForPortal(
  portalCtx: PortalContext,
  ticketId: string,
): Promise<PortalTicketDetail> {
  const ticket = ticketIdSchema.safeParse(ticketId).success
    ? await repository.findPortalRow(portalCtx.db, portalCtx.companyId, ticketId)
    : null;
  if (!ticket) throw new NotFoundError("Demande introuvable.");
  const [messages, timeline] = await Promise.all([
    repository.listMessages(portalCtx.db, ticketId, { includeInternal: false }),
    repository.listPortalTimeline(portalCtx.db, ticketId),
  ]);
  return {
    ...ticket,
    timeline,
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      at: message.at,
      authorName: message.authorName ?? "Nuera Studio",
      fromClient: message.authorRole === "client",
    })),
  };
}

/** Message du client sur sa demande. Toujours public ; une demande clôturée n'en reçoit plus. */
export async function addPortalTicketMessage(
  portalCtx: PortalContext,
  input: AddPortalTicketMessageInput,
): Promise<PortalTicketMessage> {
  const data = parseInput(addPortalTicketMessageSchema, input);
  return portalCtx.db.transaction(async (tx) => {
    const ticket = await repository.findPortalRow(tx, portalCtx.companyId, data.ticketId);
    if (!ticket) throw new NotFoundError("Demande introuvable.");
    if (ticket.status === "closed") {
      throw new ConflictError("Cette demande est clôturée : ouvrez-en une nouvelle.");
    }
    const now = new Date();
    const duplicate = await repository.findRecentSameMessage(tx, {
      ticketId: ticket.id,
      authorUserId: portalCtx.actor.userId,
      body: data.body,
      internal: false,
      since: new Date(now.getTime() - MESSAGE_DUPLICATE_WINDOW_MS),
    });
    const message =
      duplicate ??
      (await repository.insertMessage(tx, {
        ticketId: ticket.id,
        authorUserId: portalCtx.actor.userId,
        body: data.body,
        internal: false,
        at: now,
      }));
    if (!duplicate) {
      await repository.updateTicketRow(tx, ticket.id, { updatedAt: now });
      await emitEvent(tx, {
        type: "ticket.client_message",
        entityType: "ticket",
        entityId: ticket.id,
        companyId: portalCtx.companyId,
        actorId: portalCtx.actor.userId,
        dedupeKey: `ticket.client_message:${message.id}`,
        payload: { number: ticket.number, subject: ticket.subject, messageId: message.id },
      });
      await recordAudit(tx, {
        actorId: portalCtx.actor.userId,
        action: "portal.message_sent",
        entityType: "ticket_message",
        entityId: message.id,
        metadata: { ticketId: ticket.id, companyId: portalCtx.companyId },
      });
    }
    return {
      id: message.id,
      body: message.body,
      at: message.at,
      authorName: portalCtx.actor.name,
      fromClient: true,
    };
  });
}
