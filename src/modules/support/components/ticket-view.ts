import {
  TICKET_CHANNEL_LABELS,
  TICKET_STATUS_LABELS,
  type TicketCategory,
  type TicketChannel,
  type TicketCoverage,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/domain-enums";
import { formatDateShort, formatMinutes, formatRelativeTime, formatTime } from "@/lib/format";
import type { CommentView } from "@/modules/messaging/comment.service";
import { isTicketOverdue, parisDay } from "../ticket.sla";
import type { TicketDetail } from "../ticket.service";

/**
 * Passage des données de service à l'affichage : textes en français, dates déjà formatées côté
 * serveur (une date relative recalculée au navigateur différerait du rendu serveur).
 */
const MINUTE_MS = 60_000;

/** « En retard · 2 j », « En retard · 3 h ». Comme le badge de l'écran 08. */
export function overdueLabel(dueAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((now.getTime() - dueAt.getTime()) / MINUTE_MS));
  if (minutes < 60) return `En retard · ${minutes} min`;
  if (minutes < 24 * 60) return `En retard · ${Math.round(minutes / 60)} h`;
  return `En retard · ${Math.round(minutes / (24 * 60))} j`;
}

/** Échéance d'une carte : l'heure si c'est aujourd'hui, le jour sinon. */
export function dueLabel(dueAt: Date, now: Date): string {
  return parisDay(dueAt) === parisDay(now)
    ? `Échéance à ${formatTime(dueAt)}`
    : `Échéance le ${formatDateShort(dueAt)}`;
}

export function originLabel(row: {
  channel: TicketChannel;
  siteDomain: string | null;
  siteName: string | null;
}): string {
  const site = row.siteDomain ?? row.siteName;
  return site
    ? `${TICKET_CHANNEL_LABELS[row.channel]} · ${site}`
    : TICKET_CHANNEL_LABELS[row.channel];
}

/** « 4 h », « 45 min » : un délai moyen n'a pas besoin de la minute au-delà d'une heure. */
export function averageDelayLabel(minutes: number): string {
  if (minutes < 1) return "moins d'une minute";
  return minutes < 60 ? `${Math.round(minutes)} min` : formatMinutes(Math.round(minutes / 60) * 60);
}

export function supportSubtitle(overview: {
  open: number;
  overdue: number;
  counts: Record<TicketStatus, number>;
  avgFirstResponseMinutes: number | null;
}): string {
  const parts = [
    overview.open === 0
      ? "Aucune demande ouverte"
      : `${overview.open} ${overview.open > 1 ? "ouvertes" : "ouverte"}`,
    `${overview.counts.resolved} à valider`,
  ];
  if (overview.overdue > 0) parts.push(`${overview.overdue} en retard`);
  if (overview.avgFirstResponseMinutes !== null) {
    parts.push(`délai moyen de réponse ${averageDelayLabel(overview.avgFirstResponseMinutes)}`);
  }
  return parts.join(" · ");
}

export interface TicketWindowMessage {
  id: string;
  authorName: string;
  authorInitials?: string;
  date: string;
  body: string;
  internal: boolean;
}

export interface TicketWindowHistoryEntry {
  id: string;
  date: string;
  dateTime: string;
  title: string;
  detail?: string;
  actor?: string;
}

export interface TicketWindowComment {
  id: string;
  author: string;
  date: string;
  body: string;
  isReply: boolean;
}

export interface TicketWindowTimeEntry {
  id: string;
  date: string;
  minutes: string;
  member: string;
  note: string | null;
  billable: boolean;
}

export interface TicketWindowAttachment {
  id: string;
  title: string;
  detail: string;
  href: string;
  shared: boolean;
}

export interface TicketWindowData {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  companyId: string;
  companyName: string;
  siteId: string | null;
  siteLabel: string | null;
  contractId: string | null;
  contractLabel: string | null;
  projectId: string | null;
  projectLabel: string | null;
  channel: TicketChannel;
  category: TicketCategory;
  severity: TicketSeverity;
  status: TicketStatus;
  coverage: TicketCoverage;
  coverageReason: string | null;
  isIncident: boolean;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueOn: string | null;
  dueText: string | null;
  overdueText: string | null;
  slaText: string | null;
  contractualDue: boolean;
  openedText: string;
  firstResponseText: string | null;
  resolvedText: string | null;
  closedText: string | null;
  messages: TicketWindowMessage[];
  history: TicketWindowHistoryEntry[];
  /** `null` : le service partagé n'a pas répondu. Le reste de la fiche reste utilisable. */
  comments: TicketWindowComment[] | null;
  time: { totalText: string; entries: TicketWindowTimeEntry[] } | null;
  attachments: TicketWindowAttachment[] | null;
  changeRequest: {
    id: string;
    title: string;
    status: string;
    quoteId: string | null;
    quoteNumber: string | null;
  } | null;
  people: string[];
  today: string;
}

const statusLabel = (status: TicketStatus) => TICKET_STATUS_LABELS[status];

export function toTicketWindowData(input: {
  detail: TicketDetail;
  comments: CommentView[] | null;
  time: {
    totalMinutes: number;
    entries: {
      id: string;
      workOn: string;
      minutes: number;
      memberName: string | null;
      note: string | null;
      billable: boolean;
    }[];
  } | null;
  attachments: TicketWindowAttachment[] | null;
  now: Date;
}): TicketWindowData {
  const { detail, comments, time, attachments, now } = input;
  const { ticket, messages, events, sla, changeRequest } = detail;
  const overdue = isTicketOverdue(ticket, now);

  const slaParts = sla
    ? [
        sla.responseHours !== null ? `réponse sous ${sla.responseHours} h` : null,
        sla.resolutionHours !== null ? `résolution sous ${sla.resolutionHours} h` : null,
      ].filter(Boolean)
    : [];

  const people = new Set<string>();
  if (ticket.assigneeName) people.add(ticket.assigneeName);
  for (const message of messages) {
    if (message.authorRole !== "client" && message.authorName) people.add(message.authorName);
  }
  for (const comment of comments ?? []) people.add(comment.authorName);

  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    description: ticket.description,
    companyId: ticket.companyId,
    companyName: ticket.companyName,
    siteId: ticket.siteId,
    siteLabel: ticket.siteDomain ?? ticket.siteName,
    contractId: ticket.contractId,
    contractLabel: ticket.contractNumber,
    projectId: ticket.projectId,
    projectLabel: ticket.projectNumber
      ? `${ticket.projectNumber} · ${ticket.projectName ?? ""}`
      : null,
    channel: ticket.channel,
    category: ticket.category,
    severity: ticket.severity,
    status: ticket.status,
    coverage: ticket.coverage,
    coverageReason: detail.coverageReason,
    isIncident: ticket.isIncident,
    assigneeMemberId: ticket.assigneeMemberId,
    assigneeName: ticket.assigneeName,
    dueOn: ticket.dueAt ? parisDay(ticket.dueAt) : null,
    dueText: ticket.dueAt ? `${formatDateShort(ticket.dueAt)}, ${formatTime(ticket.dueAt)}` : null,
    overdueText: overdue && ticket.dueAt ? overdueLabel(ticket.dueAt, now) : null,
    slaText: slaParts.length ? `Contrat ${ticket.contractNumber} : ${slaParts.join(", ")}` : null,
    contractualDue: slaParts.length > 0,
    openedText: `${formatDateShort(ticket.createdAt)}, ${formatTime(ticket.createdAt)}`,
    firstResponseText: ticket.firstResponseAt
      ? `${formatDateShort(ticket.firstResponseAt)}, ${formatTime(ticket.firstResponseAt)}`
      : null,
    resolvedText: ticket.resolvedAt ? formatDateShort(ticket.resolvedAt) : null,
    closedText: ticket.closedAt ? formatDateShort(ticket.closedAt) : null,
    messages: messages.map((message) => ({
      id: message.id,
      authorName: message.authorName ?? "Système",
      date: formatRelativeTime(message.at, now),
      body: message.body,
      internal: message.internal,
    })),
    history: events.map((event) => {
      const moved = event.fromStatus !== event.toStatus;
      return {
        id: event.id,
        date: formatDateShort(event.at),
        dateTime: event.at.toISOString(),
        title: moved
          ? event.fromStatus
            ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
            : `${statusLabel(event.toStatus)}`
          : (event.note ?? "Modifiée"),
        detail: moved ? (event.note ?? undefined) : undefined,
        actor: event.actorName ?? undefined,
      };
    }),
    comments:
      comments?.map((comment) => ({
        id: comment.id,
        author: comment.authorName,
        date: formatRelativeTime(comment.createdAt, now),
        body: comment.body,
        isReply: comment.parentId !== null,
      })) ?? null,
    time: time
      ? {
          totalText: time.totalMinutes > 0 ? formatMinutes(time.totalMinutes) : "Aucun temps saisi",
          entries: time.entries.map((entry) => ({
            id: entry.id,
            date: formatDateShort(entry.workOn),
            minutes: formatMinutes(entry.minutes),
            member: entry.memberName ?? "—",
            note: entry.note,
            billable: entry.billable,
          })),
        }
      : null,
    attachments,
    changeRequest,
    people: [...people],
    today: parisDay(now),
  };
}
