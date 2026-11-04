import type { QuoteStatus, SignatureStatus } from "@/lib/domain-enums";
import { hrefWith, type SearchParamsLike } from "@/lib/url-state";
import { canQuoteTransition } from "./quote.status";

/** Règles pures de l'écran Devis. Le service reste seul à faire foi, l'écran s'en sert pour griser. */

/** Relance automatique du client (écran 12, note de l'écran 09). */
export const REMINDER_AFTER_DAYS = 7;
/** À partir de ce délai sans signature, la liste affiche `Relance J+n` (écran 09). */
export const FOLLOW_UP_BADGE_AFTER_DAYS = 3;

/** Unité proposée pour une ligne récurrente du catalogue. */
export const RECURRING_UNIT_LABEL = "/mois";

/** Rôle du signataire dans le document envoyé à DocuSeal. */
export const SIGNER_ROLE = "Client";

export function todayInParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Premier instant du mois en cours à Paris. */
export function startOfMonthInParis(now: Date = new Date()): Date {
  const [year, month] = todayInParis(now).split("-");
  // Paris est à UTC+1 ou UTC+2 : le premier du mois à Paris tombe la veille à 22 h ou 23 h UTC.
  const utcMidnight = new Date(`${year}-${month}-01T00:00:00Z`);
  const parisHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(utcMidnight),
  );
  return new Date(utcMidnight.getTime() - parisHour * 3_600_000);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isValidityOver(validUntil: string | null, now: Date = new Date()): boolean {
  return validUntil !== null && validUntil < todayInParis(now);
}

export interface QuoteActionState {
  status: QuoteStatus;
  signatureStatus: SignatureStatus;
  /** La version courante a déjà été envoyée, donc elle est figée. */
  versionSent: boolean;
  hasSentVersion: boolean;
  /** Date de validité de la dernière version envoyée. */
  sentValidUntil: string | null;
  isAmendment: boolean;
  now?: Date;
}

export interface QuoteActions {
  edit: boolean;
  /** Envoyer la version courante, encore jamais envoyée. */
  send: boolean;
  /** Redemander une signature sur la version déjà envoyée (demande refusée, expirée ou annulée). */
  requestSignature: boolean;
  checkSignature: boolean;
  negotiate: boolean;
  accept: boolean;
  refuse: boolean;
  expire: boolean;
  /** Créer un avenant : uniquement sur un devis signé qui n'est pas lui-même un avenant. */
  amend: boolean;
  archive: boolean;
}

export function isOpenStatus(status: QuoteStatus): boolean {
  return status === "draft" || status === "sent" || status === "negotiation";
}

export function quoteActions(state: QuoteActionState): QuoteActions {
  const open = isOpenStatus(state.status);
  const pending = state.signatureStatus === "pending";
  const sent = state.status === "sent" || state.status === "negotiation";
  return {
    edit: open,
    send: open && !state.versionSent,
    requestSignature: sent && state.versionSent && !pending,
    checkSignature: sent && pending,
    negotiate: canQuoteTransition(state.status, "negotiation"),
    accept: canQuoteTransition(state.status, "accepted") && state.hasSentVersion,
    refuse: canQuoteTransition(state.status, "refused"),
    expire:
      canQuoteTransition(state.status, "expired") &&
      isValidityOver(state.sentValidUntil, state.now),
    amend: state.status === "accepted" && !state.isAmendment,
    archive: state.status === "draft" || state.status === "refused" || state.status === "expired",
  };
}

/** Badge de la liste : `Relance J+n` remplace « Envoyé » une fois le délai dépassé. */
export function followUpDays(
  status: QuoteStatus,
  sentAt: Date | string | null,
  now: Date = new Date(),
): number | null {
  if (status !== "sent" || !sentAt) return null;
  const sent = sentAt instanceof Date ? sentAt : new Date(sentAt);
  const days = Math.floor((now.getTime() - sent.getTime()) / 86_400_000);
  return days >= FOLLOW_UP_BADGE_AFTER_DAYS ? days : null;
}

/**
 * Lien d'une ligne de la liste : le filtre et la page suivent le devis ouvert, pas ce qui ne vaut que
 * pour le devis ouvert (une version passée donnerait un 404 sur un devis qui ne l'a pas).
 */
export function quoteRowHref(id: string, searchParams: SearchParamsLike): string {
  return hrefWith(`/devis/${id}`, searchParams, {
    version: null,
    document: null,
    nouveau: null,
    client: null,
    affaire: null,
  });
}

/** Référence renvoyée par DocuSeal pour relier une signature à la version envoyée. */
export function signatureExternalId(quoteId: string, versionId: string): string {
  return `quote:${quoteId}:version:${versionId}`;
}

export function parseSignatureExternalId(
  value: string,
): { quoteId: string; versionId: string } | null {
  const match = /^quote:([0-9a-f-]{36}):version:([0-9a-f-]{36})$/.exec(value);
  return match?.[1] && match[2] ? { quoteId: match[1], versionId: match[2] } : null;
}
