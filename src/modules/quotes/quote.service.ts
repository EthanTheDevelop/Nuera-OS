import type { QuoteStatus } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { getCatalogItemsByIds, listActiveCatalogItems } from "@/modules/catalog/catalog.service";
import { listCompanyOptions } from "@/modules/crm/company.lookup";
import { emitEvent } from "@/modules/platform/events";
import { nextNumber } from "@/modules/platform/sequences";
import {
  linkChangeRequestQuote,
  listChangeRequestsForCompany,
} from "@/modules/projects/production.service";
import { listOpportunitiesForCompany } from "@/modules/sales/opportunity.service";
import { isOpportunityClosed } from "@/modules/sales/opportunity.status";
import { listAssignableMembers } from "@/modules/team/team.lookup";
import { assertCan, can, canAny } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Quote, QuoteVersion } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { computeAmounts, computeTotals, type CalcLine, type QuoteTotals } from "./quote.calc";
import { buildQuoteDocument, type QuoteDocumentInput } from "./quote.document";
import * as quoteRepository from "./quote.repository";
import {
  isOpenStatus,
  isValidityOver,
  quoteActions,
  REMINDER_AFTER_DAYS,
  startOfMonthInParis,
  todayInParis,
} from "./quote.rules";
import {
  createAmendmentSchema,
  createQuoteSchema,
  quoteContentSchema,
  quoteListSchema,
  quoteReferencesSchema,
  refusalSchema,
  type QuoteContentInput,
  type QuoteListFilter,
  type QuoteListInput,
} from "./quote.schema";
import { assertQuoteTransition } from "./quote.status";
import { cancelSubmissionQuietly, type QuoteDeps } from "./quote.deps";

/**
 * Devis : lecture, édition, versions, avenants et transitions simples. L'envoi, la signature et
 * l'acceptation sont dans `quote-signature.service.ts`.
 *
 * Une version envoyée est figée : ses lignes et ses montants ne sont plus jamais réécrits. Tout
 * changement ultérieur crée la version suivante.
 */

/** Plafond de la colonne entière des montants. */
const MAX_TOTAL_CENTS = 2_000_000_000;
const HISTORY_LIMIT = 30;

const FILTER_STATUSES: Record<QuoteListFilter, readonly QuoteStatus[]> = {
  brouillons: ["draft"],
  envoyes: ["sent", "negotiation"],
  signes: ["accepted"],
  refuses: ["refused", "expired"],
};

// --- Lecture -----------------------------------------------------------------------------------

export async function listQuotes(ctx: ServiceContext, input: QuoteListInput = {}) {
  assertCan(ctx.actor, "quotes:read");
  const { search, filter, page, pageSize } = parseInput(quoteListSchema, input);
  const { items, total } = await quoteRepository.findPage(
    ctx.db,
    { search, statuses: filter ? FILTER_STATUSES[filter] : undefined },
    { page, pageSize },
  );
  return { items, total, page, pageSize };
}

/** Résumé de l'en-tête de l'écran 09 : à signer, signés ce mois, montant HT des deux ensemble. */
export async function getQuoteSummary(ctx: ServiceContext, now: Date = new Date()) {
  assertCan(ctx.actor, "quotes:read");
  const summary = await quoteRepository.summarize(ctx.db, startOfMonthInParis(now));
  return {
    toSignCount: summary.toSignCount,
    signedThisMonthCount: summary.signedThisMonthCount,
    totalCents: summary.toSignCents + summary.signedThisMonthCents,
  };
}

/** Lecture compacte pour la fiche client 360°. */
export async function listQuotesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
) {
  assertCan(ctx.actor, "quotes:read");
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const rows = await quoteRepository.findByCompany(ctx.db, companyId, limit);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    totalCents: row.totalCents,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    isAmendment: row.parentQuoteId !== null,
  }));
}

async function requireQuote(db: Database, id: string): Promise<Quote> {
  const quote = await quoteRepository.findById(db, id);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  return quote;
}

async function requireLocked(tx: Database, id: string): Promise<Quote> {
  const quote = await quoteRepository.lockById(tx, id);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  return quote;
}

export async function requireCurrentVersion(db: Database, quote: Quote): Promise<QuoteVersion> {
  const version = quote.currentVersionId
    ? await quoteRepository.findVersion(db, quote.id, quote.currentVersionId)
    : null;
  if (!version) throw new ConflictError("Ce devis n'a pas de version courante.");
  return version;
}

/**
 * Coûts internes et rentabilité d'un devis : réservés à qui le compose. Le rôle Lecture voit les
 * prix, pas le coût : il n'a ni `finance:read` ni `team:read_costs`.
 */
function canSeeQuoteCosts(ctx: ServiceContext): boolean {
  return can(ctx.actor, "quotes:update");
}

/**
 * Fiche d'un devis pour l'écran 09. `versionNumber` affiche une version passée, telle qu'elle a été
 * figée. Un objet absent ou archivé répond 404. Sans droit sur les coûts, ils valent 0 et
 * `costsVisible` est faux : aucune donnée à filtrer côté écran.
 */
export async function getQuoteDetail(
  ctx: ServiceContext,
  id: string,
  options: { versionNumber?: number; now?: Date } = {},
) {
  assertCan(ctx.actor, "quotes:read");
  const quote = await requireQuote(ctx.db, id);
  const versions = await quoteRepository.findVersions(ctx.db, quote.id);
  const current = versions.find((version) => version.id === quote.currentVersionId) ?? versions[0];
  if (!current) throw new ConflictError("Ce devis n'a pas de version.");
  const displayed =
    options.versionNumber === undefined
      ? current
      : versions.find((version) => version.version === options.versionNumber);
  if (!displayed) throw new NotFoundError("Version introuvable.");

  const [lines, context, parent, amendments, history, members, project, depositPaid] =
    await Promise.all([
      quoteRepository.findLines(ctx.db, displayed.id),
      quoteRepository.findContext(ctx.db, quote),
      quote.parentQuoteId ? quoteRepository.findLink(ctx.db, quote.parentQuoteId) : null,
      quoteRepository.findAmendments(ctx.db, quote.id),
      quoteRepository.findHistory(ctx.db, quote.id, HISTORY_LIMIT),
      listAssignableMembers(ctx.db),
      quoteRepository.findProjectLink(ctx.db, quote.id),
      quoteRepository.hasPaidScheduleItem(ctx.db, quote.id),
    ]);

  const latestSent = versions.find((version) => version.sentAt !== null) ?? null;
  const { recurringCents } = computeTotals(lines);
  const costsVisible = canSeeQuoteCosts(ctx);
  const visibleVersion = (version: QuoteVersion): QuoteVersion =>
    costsVisible ? version : { ...version, estimatedCostCents: 0 };
  const amounts = computeAmounts(displayed);
  return {
    quote,
    company: { id: quote.companyId, name: context.companyName, ...context.companyAddress },
    opportunity: quote.opportunityId
      ? { id: quote.opportunityId, name: context.opportunityName ?? "" }
      : null,
    version: visibleVersion(displayed),
    isCurrentVersion: displayed.id === current.id,
    currentVersion: visibleVersion(current),
    latestSentVersion: latestSent ? visibleVersion(latestSent) : null,
    lines: costsVisible ? lines : lines.map((line) => ({ ...line, estimatedCostCents: 0 })),
    amounts: costsVisible ? amounts : { ...amounts, marginPercent: null },
    costsVisible,
    /** Signé dans DocuSeal : le document se relit chez lui, `getSignedDocumentUrl`. */
    hasSignedDocument: quote.signatureStatus === "signed" && quote.docusealSubmissionId !== null,
    recurringCents,
    versions: versions.map(visibleVersion),
    parent,
    amendments,
    history,
    project,
    depositPaid,
    /** Co-traitance (A12) : chaque échéance donne une facture par associé. */
    invoicesPerPayment: members.filter((member) => member.kind === "partner").length,
    actions: quoteActions({
      status: quote.status,
      signatureStatus: quote.signatureStatus,
      versionSent: current.sentAt !== null,
      hasSentVersion: latestSent !== null,
      sentValidUntil: latestSent?.validUntil ?? null,
      isAmendment: quote.parentQuoteId !== null,
      now: options.now,
    }),
  };
}
export type QuoteDetail = Awaited<ReturnType<typeof getQuoteDetail>>;

/** Modèle du document client : aperçu imprimable d'une version, sans aucun coût interne. */
export async function getQuoteDocument(
  ctx: ServiceContext,
  id: string,
  options: { versionNumber?: number } = {},
) {
  const detail = await getQuoteDetail(ctx, id, options);
  return {
    quoteId: detail.quote.id,
    versionNumber: detail.version.version,
    document: buildQuoteDocument(toDocumentInput(detail.quote, detail)),
  };
}

export function toDocumentInput(
  quote: Quote,
  data: {
    company: QuoteDocumentInput["company"];
    version: QuoteDocumentInput["version"];
    lines: QuoteDocumentInput["lines"];
  },
): QuoteDocumentInput {
  return {
    number: quote.number,
    title: quote.title,
    issuedByNote: quote.issuedByNote,
    indyReference: quote.indyReference,
    company: data.company,
    version: data.version,
    lines: data.lines,
  };
}

/** Listes de la fenêtre de création. */
export async function getQuoteFormOptions(ctx: ServiceContext) {
  assertCan(ctx.actor, "quotes:create");
  return { companies: await listCompanyOptions(ctx.db, { limit: 1000 }) };
}

/** Affaires ouvertes d'un client, pour rattacher un nouveau devis. */
export async function getOpportunityOptions(ctx: ServiceContext, companyId: string) {
  assertCan(ctx.actor, "quotes:create");
  if (!quoteRepository.isUuid(companyId)) return [];
  const opportunities = await listOpportunitiesForCompany(ctx, companyId, { limit: 100 });
  return opportunities
    .filter((opportunity) => !isOpportunityClosed(opportunity.stage))
    .map((opportunity) => ({ id: opportunity.id, name: opportunity.name }));
}

/** Demandes supplémentaires acceptées du client, à transformer en avenant (04.04.02). */
export async function getAmendmentOptions(ctx: ServiceContext, companyId: string) {
  assertCan(ctx.actor, "quotes:create");
  if (!canAny(ctx.actor, ["projects:read", "support:read"])) return [];
  const requests = await listChangeRequestsForCompany(ctx, companyId, { limit: 100 });
  return requests.filter((request) => request.status === "accepted");
}

/** Données de l'éditeur : version courante, lignes et catalogue actif. */
export async function getQuoteEditor(ctx: ServiceContext, id: string) {
  assertCan(ctx.actor, "quotes:update");
  const quote = await requireQuote(ctx.db, id);
  const version = await requireCurrentVersion(ctx.db, quote);
  const [lines, catalog, context] = await Promise.all([
    quoteRepository.findLines(ctx.db, version.id),
    listActiveCatalogItems(ctx),
    quoteRepository.findContext(ctx.db, quote),
  ]);
  return { quote, version, lines, catalog, companyName: context.companyName };
}

// --- Création ----------------------------------------------------------------------------------

function issuedByNoteFrom(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `Émis par ${names[0]}`;
  const head = names.slice(0, -1).join(", ");
  return `Émis par ${head} et ${names[names.length - 1]}, en co-traitance`;
}

async function defaultIssuedByNote(db: Database): Promise<string | null> {
  const members = await listAssignableMembers(db);
  return issuedByNoteFrom(
    members.filter((member) => member.kind === "partner").map((member) => member.fullName),
  );
}

export async function createQuote(ctx: ServiceContext, input: unknown): Promise<Quote> {
  assertCan(ctx.actor, "quotes:create");
  const data = parseInput(createQuoteSchema, input);

  if (!(await quoteRepository.companyExists(ctx.db, data.companyId))) {
    throw new ValidationError("Ce client n'existe pas ou a été archivé.", {
      companyId: ["Client introuvable."],
    });
  }
  if (data.opportunityId) {
    const opportunity = await quoteRepository.findCompanyOpportunity(
      ctx.db,
      data.opportunityId,
      data.companyId,
    );
    if (!opportunity) {
      throw new ConflictError("Cette affaire appartient à un autre client.", {
        opportunityId: ["Affaire d'un autre client."],
      });
    }
    // Le navigateur ne propose que les affaires ouvertes : le serveur l'exige aussi.
    if (opportunity.archivedAt || isOpportunityClosed(opportunity.stage)) {
      throw new ConflictError("Cette affaire est close : elle ne reçoit plus de devis.", {
        opportunityId: ["Affaire close."],
      });
    }
  }
  const issuedByNote = await defaultIssuedByNote(ctx.db);

  return ctx.db.transaction(async (tx) => {
    const number = await nextNumber(tx, "quote");
    const quote = await quoteRepository.insertQuote(tx, {
      number,
      companyId: data.companyId,
      opportunityId: data.opportunityId ?? null,
      title: data.title,
      issuedByNote,
    });
    const version = await quoteRepository.insertVersion(tx, {
      quoteId: quote.id,
      version: 1,
      createdBy: ctx.actor.userId,
    });
    const created = await quoteRepository.updateQuote(tx, quote.id, {
      currentVersionId: version.id,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.created",
      entityType: "quote",
      entityId: quote.id,
      metadata: { number, companyId: data.companyId, opportunityId: data.opportunityId ?? null },
    });
    return created;
  });
}

/**
 * Avenant : un nouveau devis, numéroté, lié au devis signé (`parent_quote_id`). Le périmètre
 * repart de la version acceptée. Son acceptation ne crée pas de second projet.
 *
 * Avec `changeRequestId`, l'avenant reprend le chiffrage d'une demande supplémentaire acceptée du
 * même client, et la demande passe à « transformée » (`linkChangeRequestQuote`, lot Projets) dans la
 * même transaction : la rejouer est refusé, sans second avenant.
 */
export async function createAmendment(
  ctx: ServiceContext,
  parentQuoteId: string,
  input: unknown,
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:create");
  const data = parseInput(createAmendmentSchema, input);
  const issuedByFallback = await defaultIssuedByNote(ctx.db);

  const parentCompany = (await quoteRepository.findById(ctx.db, parentQuoteId))?.companyId;
  const changeRequest =
    data.changeRequestId && parentCompany
      ? (await getAmendmentOptions(ctx, parentCompany)).find(
          (request) => request.id === data.changeRequestId,
        )
      : null;
  if (data.changeRequestId && parentCompany && !changeRequest) {
    throw new ConflictError("Cette demande n'est pas une demande acceptée de ce client.", {
      changeRequestId: ["Demande indisponible."],
    });
  }

  return ctx.db.transaction(async (tx) => {
    const parent = await requireLocked(tx, parentQuoteId);
    if (parent.status !== "accepted") {
      throw new ConflictError("Seul un devis signé peut recevoir un avenant.");
    }
    if (parent.parentQuoteId) {
      throw new ConflictError("Un avenant se rattache au devis d'origine, pas à un autre avenant.");
    }
    const accepted = parent.acceptedVersionId
      ? await quoteRepository.findVersion(tx, parent.id, parent.acceptedVersionId)
      : null;
    const number = await nextNumber(tx, "quote");
    const quote = await quoteRepository.insertQuote(tx, {
      number,
      companyId: parent.companyId,
      parentQuoteId: parent.id,
      title: data.title,
      issuedByNote: parent.issuedByNote ?? issuedByFallback,
    });
    const line = changeRequest
      ? {
          label: changeRequest.title,
          quantity: 1,
          unitPriceCents: changeRequest.amountCents ?? 0,
          estimatedCostCents: 0,
          estimatedMinutes: changeRequest.estimatedMinutes ?? 0,
          recurring: false,
        }
      : null;
    const totals = computeTotals(line ? [line] : []);
    const version = await quoteRepository.insertVersion(tx, {
      quoteId: quote.id,
      version: 1,
      scope: accepted?.scope ?? null,
      exclusions: accepted?.exclusions ?? null,
      conditions: accepted?.conditions ?? null,
      taxPercent: accepted?.taxPercent ?? 20,
      totalCents: totals.totalCents,
      estimatedCostCents: totals.estimatedCostCents,
      estimatedMinutes: totals.estimatedMinutes,
      changeNote: `Avenant au devis ${parent.number}`,
      createdBy: ctx.actor.userId,
    });
    if (line) {
      const { recurring: _recurring, ...values } = line;
      await quoteRepository.replaceLines(tx, version.id, [{ ...values, position: 1 }]);
    }
    const created = await quoteRepository.updateQuote(tx, quote.id, {
      currentVersionId: version.id,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.created",
      entityType: "quote",
      entityId: quote.id,
      metadata: {
        number,
        parentQuoteId: parent.id,
        parentNumber: parent.number,
        changeRequestId: changeRequest?.id ?? null,
      },
    });
    // Dans la même transaction : pas d'avenant sans sa demande, ni de second avenant au rejeu.
    if (changeRequest) {
      await linkChangeRequestQuote(
        { ...ctx, db: tx },
        { changeRequestId: changeRequest.id, quoteId: quote.id },
      );
    }
    return created;
  });
}

// --- Édition et versions -----------------------------------------------------------------------

function normalizedLines(
  lines: readonly {
    catalogItemId?: string | null;
    label: string;
    unitLabel?: string | null;
    quantity: number;
    unitPriceCents: number;
    estimatedCostCents: number;
    estimatedMinutes: number;
  }[],
) {
  return lines.map((line) => [
    line.catalogItemId ?? null,
    line.label,
    line.unitLabel ?? null,
    line.quantity,
    line.unitPriceCents,
    line.estimatedCostCents,
    line.estimatedMinutes,
  ]);
}

function sameContent(
  version: QuoteVersion,
  currentLines: Parameters<typeof normalizedLines>[0],
  data: QuoteContentInput,
): boolean {
  return (
    (version.scope ?? null) === (data.scope ?? null) &&
    (version.exclusions ?? null) === (data.exclusions ?? null) &&
    (version.conditions ?? null) === (data.conditions ?? null) &&
    (version.validUntil ?? null) === (data.validUntil ?? null) &&
    (version.depositPercent ?? 0) === data.depositPercent &&
    version.taxPercent === data.taxPercent &&
    JSON.stringify(normalizedLines(currentLines)) === JSON.stringify(normalizedLines(data.lines))
  );
}

function versionValues(data: QuoteContentInput, totals: QuoteTotals) {
  return {
    scope: data.scope ?? null,
    exclusions: data.exclusions ?? null,
    conditions: data.conditions ?? null,
    validUntil: data.validUntil ?? null,
    depositPercent: data.depositPercent,
    taxPercent: data.taxPercent,
    totalCents: totals.totalCents,
    estimatedCostCents: totals.estimatedCostCents,
    estimatedMinutes: totals.estimatedMinutes,
  };
}

function lineValues(data: QuoteContentInput) {
  return data.lines.map((line, index) => ({
    catalogItemId: line.catalogItemId ?? null,
    label: line.label,
    unitLabel: line.unitLabel ?? null,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    estimatedCostCents: line.estimatedCostCents,
    estimatedMinutes: line.estimatedMinutes,
    position: index + 1,
  }));
}

/**
 * Enregistre le contenu de l'éditeur.
 *
 * - Version courante encore jamais envoyée : réécrite sur place.
 * - Version envoyée : figée. Un contenu différent crée la version suivante et rend caduque la
 *   demande de signature en cours, pour que le client ne signe pas un document dépassé. Un contenu
 *   identique ne crée rien : répéter l'enregistrement est sans effet.
 */
export async function saveQuoteContent(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  deps: QuoteDeps,
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:update");
  const data = parseInput(quoteContentSchema, input);

  const catalogIds = data.lines.flatMap((line) => (line.catalogItemId ? [line.catalogItemId] : []));
  const items = await getCatalogItemsByIds(ctx, catalogIds);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const unknown = catalogIds.find((catalogId) => !itemById.has(catalogId));
  if (unknown) throw new ValidationError("Une ligne référence une prestation inconnue.");

  const calcLines: CalcLine[] = data.lines.map((line) => ({
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    estimatedCostCents: line.estimatedCostCents,
    estimatedMinutes: line.estimatedMinutes,
    recurring: line.catalogItemId ? itemById.get(line.catalogItemId)?.kind === "recurring" : false,
  }));
  const totals = computeTotals(calcLines);
  if (
    totals.totalCents > MAX_TOTAL_CENTS ||
    totals.estimatedCostCents > MAX_TOTAL_CENTS ||
    totals.estimatedMinutes > MAX_TOTAL_CENTS
  ) {
    throw new ValidationError("Le total de ce devis dépasse le montant autorisé.");
  }

  let submissionToCancel: string | null = null;
  const saved = await ctx.db.transaction(async (tx) => {
    const quote = await requireLocked(tx, id);
    if (!isOpenStatus(quote.status)) {
      throw new ConflictError(
        quote.status === "accepted"
          ? "Un devis signé ne se modifie plus : créez un avenant."
          : "Ce devis est clos : il ne se modifie plus.",
      );
    }
    const current = await requireCurrentVersion(tx, quote);
    const currentLines = await quoteRepository.findLines(tx, current.id);

    // Une prestation retirée de la vente reste acceptée si elle figure déjà dans le devis.
    const alreadyUsed = new Set(currentLines.map((line) => line.catalogItemId));
    const retired = data.lines.find(
      (line) =>
        line.catalogItemId &&
        itemById.get(line.catalogItemId)?.active === false &&
        !alreadyUsed.has(line.catalogItemId),
    );
    if (retired) {
      throw new ConflictError(`« ${retired.label} » a été retirée du catalogue.`);
    }

    const header = { title: data.title, issuedByNote: data.issuedByNote ?? null };

    if (current.sentAt === null) {
      await quoteRepository.updateVersion(tx, current.id, {
        ...versionValues(data, totals),
        changeNote: data.changeNote ?? current.changeNote,
      });
      await quoteRepository.replaceLines(tx, current.id, lineValues(data));
      const updated = await quoteRepository.updateQuote(tx, quote.id, header);
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "quote.updated",
        entityType: "quote",
        entityId: quote.id,
        metadata: {
          version: current.version,
          totalCents: totals.totalCents,
          lines: data.lines.length,
        },
      });
      return updated;
    }

    if (sameContent(current, currentLines, data)) {
      if (quote.title === header.title && quote.issuedByNote === header.issuedByNote) return quote;
      const updated = await quoteRepository.updateQuote(tx, quote.id, header);
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "quote.updated",
        entityType: "quote",
        entityId: quote.id,
        metadata: { version: current.version },
      });
      return updated;
    }

    if (!data.changeNote) {
      throw new ValidationError("Dites ce qui change : cette version a déjà été envoyée.", {
        changeNote: ["Indiquez ce qui change par rapport à la version envoyée."],
      });
    }
    const versionNumber = await quoteRepository.nextVersionNumber(tx, quote.id);
    const version = await quoteRepository.insertVersion(tx, {
      quoteId: quote.id,
      version: versionNumber,
      ...versionValues(data, totals),
      changeNote: data.changeNote,
      createdBy: ctx.actor.userId,
    });
    await quoteRepository.replaceLines(tx, version.id, lineValues(data));

    const pendingSubmission =
      quote.signatureStatus === "pending" ? quote.docusealSubmissionId : null;
    submissionToCancel = pendingSubmission;
    const updated = await quoteRepository.updateQuote(tx, quote.id, {
      ...header,
      currentVersionId: version.id,
      ...(quote.signatureStatus === "pending"
        ? { signatureStatus: "none" as const, docusealSubmissionId: null }
        : {}),
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.version_created",
      entityType: "quote",
      entityId: quote.id,
      metadata: {
        version: versionNumber,
        changeNote: data.changeNote,
        totalCents: totals.totalCents,
        signatureCancelled: pendingSubmission !== null,
      },
    });
    return updated;
  });

  await cancelSubmissionQuietly(deps, submissionToCancel, saved.id);
  return saved;
}

/** Références du document officiel (Indy). Idempotent. */
export async function updateQuoteReferences(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:update");
  const data = parseInput(quoteReferencesSchema, input);
  return ctx.db.transaction(async (tx) => {
    const quote = await requireLocked(tx, id);
    const indyReference = data.indyReference ?? null;
    const officialDocumentUrl = data.officialDocumentUrl ?? null;
    if (
      quote.indyReference === indyReference &&
      quote.officialDocumentUrl === officialDocumentUrl
    ) {
      return quote;
    }
    const updated = await quoteRepository.updateQuote(tx, quote.id, {
      indyReference,
      officialDocumentUrl,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.updated",
      entityType: "quote",
      entityId: quote.id,
      metadata: { indyReference, officialDocumentUrl },
    });
    return updated;
  });
}

// --- Transitions -------------------------------------------------------------------------------

/** Le client discute le devis. Idempotent. */
export async function markQuoteNegotiation(ctx: ServiceContext, id: string): Promise<Quote> {
  assertCan(ctx.actor, "quotes:update");
  return ctx.db.transaction(async (tx) => {
    const quote = await requireLocked(tx, id);
    if (quote.status === "negotiation") return quote;
    assertQuoteTransition(quote.status, "negotiation");
    const updated = await quoteRepository.updateQuote(tx, quote.id, { status: "negotiation" });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.updated",
      entityType: "quote",
      entityId: quote.id,
      metadata: { fromStatus: quote.status, toStatus: "negotiation" },
    });
    return updated;
  });
}

export async function refuseQuote(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  deps: QuoteDeps,
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:update");
  const { reason } = parseInput(refusalSchema, input);
  let submissionToCancel: string | null = null;
  const refused = await ctx.db.transaction(async (tx) => {
    const quote = await requireLocked(tx, id);
    if (quote.status === "refused") return quote;
    assertQuoteTransition(quote.status, "refused");
    submissionToCancel = quote.signatureStatus === "pending" ? quote.docusealSubmissionId : null;
    const updated = await quoteRepository.updateQuote(tx, quote.id, {
      status: "refused",
      refusedAt: new Date(),
      ...(quote.signatureStatus === "pending"
        ? { signatureStatus: "none" as const, docusealSubmissionId: null }
        : {}),
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.refused",
      entityType: "quote",
      entityId: quote.id,
      metadata: { reason },
    });
    await emitEvent(tx, {
      type: "quote.refused",
      entityType: "quote",
      entityId: quote.id,
      companyId: quote.companyId,
      payload: { number: quote.number },
      actorId: ctx.actor.userId,
      dedupeKey: `quote.refused:${quote.id}`,
    });
    return updated;
  });
  await cancelSubmissionQuietly(deps, submissionToCancel, refused.id);
  return refused;
}

async function applyExpiry(tx: Database, quote: Quote, actorId: string | null): Promise<Quote> {
  assertQuoteTransition(quote.status, "expired");
  // La demande en cours devient caduque : DocuSeal la ferme à la même date (`expire_at`). Une
  // signature tardive n'aura aucun effet et restera lisible dans l'historique.
  const pending = quote.signatureStatus === "pending";
  const updated = await quoteRepository.updateQuote(tx, quote.id, {
    status: "expired",
    ...(pending ? { signatureStatus: "none" as const, docusealSubmissionId: null } : {}),
  });
  await recordAudit(tx, {
    actorId,
    action: "quote.expired",
    entityType: "quote",
    entityId: quote.id,
    metadata: { number: quote.number, signatureCancelled: pending },
  });
  await emitEvent(tx, {
    type: "quote.expired",
    entityType: "quote",
    entityId: quote.id,
    companyId: quote.companyId,
    payload: { number: quote.number },
    actorId,
    dedupeKey: `quote.expired:${quote.id}`,
  });
  return updated;
}

/** Constat manuel d'un devis dépassé : refusé tant que sa validité court. Idempotent. */
export async function expireQuote(
  ctx: ServiceContext,
  id: string,
  now: Date = new Date(),
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:update");
  return ctx.db.transaction(async (tx) => {
    const quote = await requireLocked(tx, id);
    if (quote.status === "expired") return quote;
    assertQuoteTransition(quote.status, "expired");
    const sent = await quoteRepository.findLatestSentVersion(tx, quote.id);
    if (!isValidityOver(sent?.validUntil ?? null, now)) {
      throw new ConflictError("La validité de ce devis n'est pas encore dépassée.");
    }
    return applyExpiry(tx, quote, ctx.actor.userId);
  });
}

/**
 * Pour le lot Automatisations (tâche planifiée) : passe en « Expiré » tout devis envoyé dont la
 * validité est dépassée. Sans acteur ni permission : c'est une action système. Idempotent.
 */
export async function expireOverdueQuotes(db: Database, now: Date = new Date()): Promise<string[]> {
  const ids = await quoteRepository.findExpirableIds(db, todayInParis(now));
  const expired: string[] = [];
  for (const id of ids) {
    await db.transaction(async (tx) => {
      const quote = await quoteRepository.lockById(tx, id);
      if (!quote || quote.status !== "sent") return;
      await applyExpiry(tx, quote, null);
      expired.push(id);
    });
  }
  return expired;
}

/** Archive un devis clos ou un brouillon. Un devis en cours ou signé ne s'archive pas. Idempotent. */
export async function archiveQuote(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "quotes:update");
  await ctx.db.transaction(async (tx) => {
    const quote = await quoteRepository.lockAnyById(tx, id);
    if (!quote) throw new NotFoundError("Devis introuvable.");
    if (quote.archivedAt) return;
    if (quote.status !== "draft" && quote.status !== "refused" && quote.status !== "expired") {
      throw new ConflictError("Seul un brouillon, un devis refusé ou expiré peut être archivé.");
    }
    if (await quoteRepository.isLinkedToChangeRequest(tx, quote.id)) {
      throw new ConflictError(
        "Ce devis est issu d'une demande de changement, qui y renvoie : il ne s'archive pas.",
      );
    }
    await quoteRepository.updateQuote(tx, quote.id, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "quote.archived",
      entityType: "quote",
      entityId: quote.id,
      metadata: { number: quote.number, status: quote.status },
    });
  });
}

// --- Relance J+7 (lot Automatisations) ---------------------------------------------------------

/**
 * Devis envoyés, non signés, à relancer : envoyés depuis au moins 7 jours, sans relance depuis
 * 7 jours. Sans acteur ni permission : lecture système de la tâche planifiée.
 */
export async function listQuotesDueForReminder(db: Database, now: Date = new Date()) {
  const threshold = new Date(now.getTime() - REMINDER_AFTER_DAYS * 86_400_000);
  return quoteRepository.findDueForReminder(db, threshold);
}

/**
 * À appeler une fois la relance partie, dans la transaction de l'automatisation. Pose
 * `last_reminder_at` : le devis sort de `listQuotesDueForReminder` pour 7 jours. Idempotent.
 */
export async function recordQuoteReminder(
  tx: Database,
  input: { quoteId: string; now?: Date; actorId?: string | null },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const quote = await quoteRepository.lockById(tx, input.quoteId);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  const threshold = now.getTime() - REMINDER_AFTER_DAYS * 86_400_000;
  if (quote.lastReminderAt && quote.lastReminderAt.getTime() > threshold) return false;
  await quoteRepository.updateQuote(tx, quote.id, { lastReminderAt: now });
  await recordAudit(tx, {
    actorId: input.actorId ?? null,
    action: "quote.reminded",
    entityType: "quote",
    entityId: quote.id,
    metadata: { number: quote.number },
  });
  return true;
}

// --- Lecture pour le lot Projets ---------------------------------------------------------------

/** Version acceptée d'un devis et ses lignes, dans la transaction de l'acceptation. */
export async function getQuoteVersionSnapshot(
  db: Database,
  input: { quoteId: string; versionId: string },
) {
  const quote = await quoteRepository.findById(db, input.quoteId);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  const version = await quoteRepository.findVersion(db, input.quoteId, input.versionId);
  if (!version) throw new NotFoundError("Version introuvable.");
  const lines = await quoteRepository.findLines(db, version.id);
  return { quote, version, lines };
}
