import { INDY_APP_URL, INDY_CONNECTION_STATUS } from "@/integrations/indy/indy.connection";
import type { FinancialDocumentStatus, IntegrationStatus } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { listCompanyOptions, type CompanyOption } from "@/modules/crm/company.lookup";
import { emitEvent } from "@/modules/platform/events";
import { assertCan } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import type { FinancialDocument } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { PageParams, Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import {
  addDays,
  lastMonths,
  monthlyCents,
  monthOf,
  parisDay,
  type DayRange,
} from "./finance.dates";
import * as repository from "./finance.repository";
import {
  directCostInputSchema,
  directCostListFilterSchema,
  invoiceInputSchema,
  invoiceVisibilitySchema,
  invoiceListFilterSchema,
  invoiceStatusChangeSchema,
  scheduleInputSchema,
  scheduleListFilterSchema,
} from "./finance.schema";
import { assertInvoiceTransition } from "./invoice.status";
import { assertScheduleTransition, deriveScheduleStatus } from "./schedule.status";

export type { InvoiceRow, ScheduleRow, DirectCostRow, CompanyLinks } from "./finance.repository";

const FOREIGN_LINK_MESSAGES: Record<string, string> = {
  projectId: "Ce projet n'appartient pas à ce client.",
  contractId: "Ce contrat n'appartient pas à ce client.",
  quoteId: "Ce devis n'appartient pas à ce client.",
  siteId: "Ce site n'appartient pas à ce client.",
  scheduleItemId: "Cette échéance n'appartient pas à ce client.",
  documentId: "Ce justificatif n'appartient pas à ce client.",
};

/** Refuse un lien vers l'objet d'un autre client, avant que la clé composite ne le fasse en SQL. */
async function assertLinksBelongToCompany(db: Database, link: repository.LinkCheck): Promise<void> {
  const foreign = await repository.findForeignLinks(db, link);
  if (foreign.length === 0) return;
  throw new ValidationError(
    "Un lien pointe vers un autre client.",
    Object.fromEntries(foreign.map((field) => [field, [FOREIGN_LINK_MESSAGES[field] ?? ""]])),
  );
}

/** Un associé actif émet la facture (A12). Celui déjà posé reste valable s'il est parti depuis. */
async function assertIssuer(db: Database, memberId: string, currentId?: string | null) {
  if (memberId === currentId) return;
  const member = await repository.getMemberForChoice(db, memberId);
  if (member?.kind !== "partner" || member.status !== "active" || member.archivedAt) {
    throw new ValidationError("Certaines informations sont invalides.", {
      issuerMemberId: ["Choisissez un associé actif : lui seul émet une facture."],
    });
  }
}

/** L'intervenant d'un coût existe et reste actif, sauf s'il était déjà posé sur ce coût. */
async function assertCostMember(db: Database, memberId: string | null, currentId?: string | null) {
  if (!memberId || memberId === currentId) return;
  const member = await repository.getMemberForChoice(db, memberId);
  if (!member || member.status !== "active" || member.archivedAt) {
    throw new ValidationError("Certaines informations sont invalides.", {
      memberId: ["Choisissez un intervenant actif."],
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

const DUPLICATE_REF = "Cette référence existe déjà : ouvrez la facture correspondante.";

// --- Factures : transitions --------------------------------------------------------------------

/**
 * Change l'état d'une facture dans la transaction `tx` : machine d'états, écriture conditionnelle,
 * audit, événement émis une seule fois, échéance recalculée. Même état : rien à faire, l'opération
 * répétée reste silencieuse.
 */
export async function applyInvoiceStatus(
  tx: Database,
  document: FinancialDocument,
  to: FinancialDocumentStatus,
  options: { actorId: string | null; paidOn?: string | null; at?: Date },
): Promise<FinancialDocument> {
  if (document.status === to) return document;
  assertInvoiceTransition(document.status, to);

  const paidOn = to === "paid" ? (options.paidOn ?? parisDay(options.at ?? new Date())) : null;
  const updated = await repository.transitionDocument(tx, document.id, document.status, {
    status: to,
    paidOn,
  });
  if (!updated) {
    throw new ConflictError("Cette facture vient de changer d'état. Actualisez la page.");
  }

  await recordAudit(tx, {
    actorId: options.actorId,
    action: "financial_document.status_changed",
    entityType: "financial_document",
    entityId: document.id,
    metadata: { from: document.status, to, externalRef: document.externalRef, paidOn },
  });

  if (to === "paid" && document.kind === "invoice") {
    await emitEvent(tx, {
      type: "invoice.paid",
      entityType: "financial_document",
      entityId: document.id,
      companyId: document.companyId,
      payload: { externalRef: document.externalRef, amountCents: document.amountCents, paidOn },
      actorId: options.actorId,
      dedupeKey: `invoice.paid:${document.id}`,
    });
  }
  if (to === "overdue" && document.kind === "invoice") {
    await emitEvent(tx, {
      type: "invoice.overdue",
      entityType: "financial_document",
      entityId: document.id,
      companyId: document.companyId,
      payload: {
        externalRef: document.externalRef,
        amountCents: document.amountCents,
        dueOn: document.dueOn,
      },
      actorId: options.actorId,
      // Une échéance repoussée puis dépassée est un nouveau retard ; le même retard n'alerte qu'une fois.
      dedupeKey: `invoice.overdue:${document.id}:${document.dueOn}`,
    });
  }

  await syncScheduleItem(tx, document.scheduleItemId);
  return updated;
}

/** Une échéance dépassée passe en retard, une échéance repoussée en sort. */
export async function alignOverdue(
  tx: Database,
  document: FinancialDocument,
  options: { actorId: string | null; at: Date },
): Promise<FinancialDocument> {
  const today = parisDay(options.at);
  const pastDue = document.kind === "invoice" && document.dueOn !== null && document.dueOn < today;
  if (document.status === "issued" && pastDue) {
    return applyInvoiceStatus(tx, document, "overdue", options);
  }
  if (document.status === "overdue" && !pastDue) {
    return applyInvoiceStatus(tx, document, "issued", options);
  }
  return document;
}

/** Recalcule l'état et le document principal d'une échéance depuis ses factures vivantes. */
export async function syncScheduleItem(tx: Database, scheduleItemId: string | null): Promise<void> {
  if (!scheduleItemId) return;
  const item = await repository.getScheduleItemForUpdate(tx, scheduleItemId);
  if (!item) return;
  const totals = await repository.scheduleDocumentTotals(tx, scheduleItemId);
  const status = deriveScheduleStatus({
    amountCents: item.amountCents,
    liveCount: totals.liveCount,
    paidCents: totals.paidCents,
  });
  if (status !== item.status) assertScheduleTransition(item.status, status);
  if (status !== item.status || totals.firstDocumentId !== item.financialDocumentId) {
    await repository.updateScheduleItem(tx, scheduleItemId, {
      status,
      financialDocumentId: totals.firstDocumentId,
    });
  }
}

/** Le total des factures vivantes d'une échéance ne dépasse pas son montant (A12). */
async function assertScheduleCapacity(
  db: Database,
  input: { scheduleItemId: string; amountCents: number; excludingCents: number },
): Promise<void> {
  const item = await repository.getScheduleItemForUpdate(db, input.scheduleItemId);
  if (!item) throw new NotFoundError("Échéance introuvable.");
  const totals = await repository.scheduleDocumentTotals(db, input.scheduleItemId);
  const next = totals.liveCents - input.excludingCents + input.amountCents;
  if (next > item.amountCents) {
    throw new ConflictError("Le total des factures dépasse le montant de cette échéance.", {
      amountCents: ["Le total des factures dépasse le montant de cette échéance."],
    });
  }
}

/**
 * Tâche quotidienne : passe en retard les factures dont l'échéance est dépassée. Appelable depuis un
 * job, sans acteur. Rejouée, elle ne change rien et n'émet rien de plus. Renvoie le nombre de passages.
 */
export async function markOverdueInvoices(db: Database, now: Date = new Date()): Promise<number> {
  const today = parisDay(now);
  const candidates = await repository.listDocumentsToMarkOverdue(db, today);
  let marked = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      // Relu : un paiement peut être arrivé depuis la liste.
      const current = await repository.getDocument(tx, candidate.id);
      if (!current || current.status !== "issued") return;
      await applyInvoiceStatus(tx, current, "overdue", { actorId: null, at: now });
      marked += 1;
    });
  }
  return marked;
}

/** Factures en retard, calculées depuis l'échéance : la réponse ne dépend pas du passage de la tâche. */
export async function listOverdueInvoices(db: Database, now: Date = new Date()) {
  return repository.listOverdueRows(db, parisDay(now));
}

// --- Factures : écritures ----------------------------------------------------------------------

function normalizedAmounts(input: { kind: string; amountCents: number; taxCents: number }) {
  // Un avoir est négatif en base : les sommes de revenus restent justes sans cas particulier.
  const sign = input.kind === "credit_note" ? -1 : 1;
  return {
    amountCents: sign * Math.abs(input.amountCents),
    taxCents: sign * Math.abs(input.taxCents),
  };
}

export async function createInvoiceReference(
  ctx: ServiceContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<FinancialDocument> {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(invoiceInputSchema, rawInput);

  try {
    return await ctx.db.transaction(async (tx) => {
      await assertLinksBelongToCompany(tx, input);
      await assertIssuer(tx, input.issuerMemberId);
      const existing = await repository.findDocumentsByRefs(tx, [input.externalRef]);
      if (existing.length > 0) {
        throw new ConflictError(DUPLICATE_REF, { externalRef: [DUPLICATE_REF] });
      }
      const amounts = normalizedAmounts(input);
      if (input.scheduleItemId) {
        await assertScheduleCapacity(tx, {
          scheduleItemId: input.scheduleItemId,
          amountCents: amounts.amountCents,
          excludingCents: 0,
        });
      }
      const created = await repository.insertDocument(tx, {
        ...input,
        ...amounts,
        source: "manual",
        status: "issued",
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "financial_document.created",
        entityType: "financial_document",
        entityId: created.id,
        metadata: { externalRef: created.externalRef, source: "manual" },
      });
      await syncScheduleItem(tx, created.scheduleItemId);
      return alignOverdue(tx, created, { actorId: ctx.actor.userId, at: now });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(DUPLICATE_REF, { externalRef: [DUPLICATE_REF] });
    }
    throw error;
  }
}

export async function updateInvoiceReference(
  ctx: ServiceContext,
  id: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<FinancialDocument> {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(invoiceInputSchema, rawInput);
  assertIdFormat(id, "Facture introuvable.");

  try {
    return await ctx.db.transaction(async (tx) => {
      const current = await repository.getDocument(tx, id);
      if (!current) throw new NotFoundError("Facture introuvable.");
      if (current.status === "cancelled") {
        throw new ConflictError("Une facture annulée ne se modifie plus.");
      }
      await assertLinksBelongToCompany(tx, input);
      await assertIssuer(tx, input.issuerMemberId, current.issuerMemberId);
      if (input.externalRef !== current.externalRef) {
        const existing = await repository.findDocumentsByRefs(tx, [input.externalRef]);
        if (existing.some((row) => row.id !== id)) {
          throw new ConflictError(DUPLICATE_REF, { externalRef: [DUPLICATE_REF] });
        }
      }
      const amounts = normalizedAmounts(input);
      if (input.scheduleItemId) {
        await assertScheduleCapacity(tx, {
          scheduleItemId: input.scheduleItemId,
          amountCents: amounts.amountCents,
          excludingCents: current.scheduleItemId === input.scheduleItemId ? current.amountCents : 0,
        });
      }
      // La clé composite interdit de changer de client tant que l'échéance la désigne :
      // `syncScheduleItem` recalcule ensuite le document principal.
      if (current.companyId !== input.companyId && current.scheduleItemId) {
        await repository.updateScheduleItem(tx, current.scheduleItemId, {
          financialDocumentId: null,
        });
      }
      const updated = await repository.updateDocument(tx, id, { ...input, ...amounts });
      if (!updated) throw new NotFoundError("Facture introuvable.");
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "financial_document.updated",
        entityType: "financial_document",
        entityId: id,
        metadata: {
          externalRef: updated.externalRef,
          fromRef: current.externalRef,
          fromCents: current.amountCents,
          toCents: updated.amountCents,
          fromCompanyId: current.companyId,
          toCompanyId: updated.companyId,
          fromScheduleItemId: current.scheduleItemId,
          toScheduleItemId: updated.scheduleItemId,
          source: updated.source,
        },
      });
      await syncScheduleItem(tx, updated.scheduleItemId);
      if (current.scheduleItemId !== updated.scheduleItemId) {
        await syncScheduleItem(tx, current.scheduleItemId);
      }
      return alignOverdue(tx, updated, { actorId: ctx.actor.userId, at: now });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(DUPLICATE_REF, { externalRef: [DUPLICATE_REF] });
    }
    throw error;
  }
}

/** Encaissement, annulation ou correction. `overdue` et son retour ne se décident pas à la main. */
export async function changeInvoiceStatus(
  ctx: ServiceContext,
  id: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<FinancialDocument> {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(invoiceStatusChangeSchema, rawInput);
  assertIdFormat(id, "Facture introuvable.");
  if (input.to === "overdue") {
    throw new ConflictError("Le retard se calcule depuis la date d'échéance.");
  }
  const today = parisDay(now);
  if (input.to === "paid" && input.paidOn && input.paidOn > today) {
    throw new ValidationError("Certaines informations sont invalides.", {
      paidOn: ["La date de paiement ne peut pas être future."],
    });
  }
  return ctx.db.transaction(async (tx) => {
    const current = await repository.getDocument(tx, id);
    if (!current) throw new NotFoundError("Facture introuvable.");
    const changed = await applyInvoiceStatus(tx, current, input.to, {
      actorId: ctx.actor.userId,
      paidOn: input.paidOn,
      at: now,
    });
    // Annuler un encaissement : la facture retrouve son retard si l'échéance est passée.
    return input.to === "issued"
      ? alignOverdue(tx, changed, { actorId: ctx.actor.userId, at: now })
      : changed;
  });
}

/** Rendre une facture visible ou non dans l'espace du client. */
export async function setInvoiceClientVisibility(
  ctx: ServiceContext,
  id: string,
  rawVisible: boolean,
): Promise<FinancialDocument> {
  assertCan(ctx.actor, "finance:manage");
  const visible = parseInput(invoiceVisibilitySchema, rawVisible);
  assertIdFormat(id, "Facture introuvable.");
  return ctx.db.transaction(async (tx) => {
    const current = await repository.getDocument(tx, id);
    if (!current) throw new NotFoundError("Facture introuvable.");
    if (current.clientVisible === visible) return current;
    const updated = await repository.updateDocument(tx, id, { clientVisible: visible });
    if (!updated) throw new NotFoundError("Facture introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "financial_document.shared",
      entityType: "financial_document",
      entityId: id,
      metadata: { visible, externalRef: current.externalRef },
    });
    return updated;
  });
}

// --- Factures : lectures -----------------------------------------------------------------------

export async function listInvoices(
  ctx: ServiceContext,
  rawFilter: unknown,
  params: PageParams,
  now: Date = new Date(),
): Promise<Paginated<repository.InvoiceRow>> {
  assertCan(ctx.actor, "finance:read");
  const filter = parseInput(invoiceListFilterSchema, rawFilter);
  return repository.listInvoices(ctx.db, filter, params, parisDay(now));
}

export async function getInvoice(
  ctx: ServiceContext,
  id: string,
  now: Date = new Date(),
): Promise<repository.InvoiceRow> {
  assertCan(ctx.actor, "finance:read");
  const row = isUuid(id) ? await repository.getInvoiceRow(ctx.db, id, parisDay(now)) : null;
  if (!row) throw new NotFoundError("Facture introuvable.");
  return row;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant mal formé dans une URL est un objet introuvable, pas une erreur SQL. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function assertIdFormat(id: string, message: string): void {
  if (!isUuid(id)) throw new NotFoundError(message);
}

/** Lecture compacte pour la fiche client 360° (`docs/domain-model.md` §8). */
export async function listInvoicesForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
  now: Date = new Date(),
): Promise<repository.InvoiceRow[]> {
  assertCan(ctx.actor, "finance:read");
  assertIdFormat(companyId, "Client introuvable.");
  return repository.listInvoicesLimited(ctx.db, { companyId }, options.limit ?? 20, parisDay(now));
}

export interface PortalInvoice {
  id: string;
  kind: repository.InvoiceRow["kind"];
  externalRef: string | null;
  label: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  amountCents: number;
  taxCents: number;
  status: FinancialDocumentStatus;
  paidOn: string | null;
  documentId: string | null;
}

/**
 * Factures partagées au client connecté. Le cloisonnement vient du `PortalContext` : aucune autre
 * entreprise ne peut être demandée. Rien d'interne ne sort (émetteur, source, liens de gestion).
 */
export async function listInvoicesForPortal(
  ctx: PortalContext,
  now: Date = new Date(),
): Promise<PortalInvoice[]> {
  const rows = await repository.listInvoicesLimited(
    ctx.db,
    { companyId: ctx.companyId, onlyClientVisible: true },
    200,
    parisDay(now),
  );
  return rows
    .filter((row) => row.status !== "cancelled")
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      externalRef: row.externalRef,
      label: row.scheduleLabel ?? row.projectName ?? row.contractName,
      issuedOn: row.issuedOn,
      dueOn: row.dueOn,
      amountCents: row.amountCents,
      taxCents: row.taxCents,
      status: row.status,
      paidOn: row.paidOn,
      documentId: row.documentId,
    }));
}

// --- Échéancier --------------------------------------------------------------------------------

export async function listSchedule(
  ctx: ServiceContext,
  rawFilter: unknown,
  params: PageParams,
): Promise<Paginated<repository.ScheduleRow>> {
  assertCan(ctx.actor, "finance:read");
  return repository.listScheduleItems(
    ctx.db,
    parseInput(scheduleListFilterSchema, rawFilter),
    params,
  );
}

export async function getScheduleDetail(
  ctx: ServiceContext,
  id: string,
  now: Date = new Date(),
): Promise<{ item: repository.ScheduleRow; invoices: repository.InvoiceRow[] }> {
  assertCan(ctx.actor, "finance:read");
  const item = isUuid(id) ? await repository.getScheduleRow(ctx.db, id) : null;
  if (!item) throw new NotFoundError("Échéance introuvable.");
  const invoices = await repository.listInvoicesLimited(
    ctx.db,
    { scheduleItemId: id },
    50,
    parisDay(now),
  );
  return { item, invoices };
}

export async function createScheduleItem(ctx: ServiceContext, rawInput: unknown) {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(scheduleInputSchema, rawInput);
  return ctx.db.transaction(async (tx) => {
    await assertLinksBelongToCompany(tx, input);
    const created = await repository.insertScheduleItem(tx, input);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "schedule_item.created",
      entityType: "schedule_item",
      entityId: created.id,
      metadata: { label: created.label, amountCents: created.amountCents },
    });
    return created;
  });
}

export async function updateScheduleItem(ctx: ServiceContext, id: string, rawInput: unknown) {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(scheduleInputSchema, rawInput);
  assertIdFormat(id, "Échéance introuvable.");
  return ctx.db.transaction(async (tx) => {
    const current = await repository.getScheduleItemForUpdate(tx, id);
    if (!current) throw new NotFoundError("Échéance introuvable.");
    await assertLinksBelongToCompany(tx, input);
    const totals = await repository.scheduleDocumentTotals(tx, id);
    // Une facture annulée reste liée : son historique retient aussi le client.
    if (
      input.companyId !== current.companyId &&
      (await repository.countScheduleDocuments(tx, id)) > 0
    ) {
      throw new ConflictError("Cette échéance a des factures : son client ne change plus.", {
        companyId: ["Cette échéance a des factures : son client ne change plus."],
      });
    }
    if (input.amountCents < totals.liveCents) {
      throw new ConflictError("Ce montant est inférieur au total de ses factures.", {
        amountCents: ["Ce montant est inférieur au total de ses factures."],
      });
    }
    const updated = await repository.updateScheduleItem(tx, id, input);
    if (!updated) throw new NotFoundError("Échéance introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "schedule_item.updated",
      entityType: "schedule_item",
      entityId: id,
      metadata: {
        label: updated.label,
        fromLabel: current.label,
        fromCents: current.amountCents,
        toCents: updated.amountCents,
        fromDueOn: current.dueOn,
        toDueOn: updated.dueOn,
        fromCompanyId: current.companyId,
        toCompanyId: updated.companyId,
      },
    });
    await syncScheduleItem(tx, id);
    return updated;
  });
}

/** Une échéance qui a porté une facture reste dans l'historique : seule une prévision se retire. */
export async function deleteScheduleItem(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "finance:manage");
  assertIdFormat(id, "Échéance introuvable.");
  await ctx.db.transaction(async (tx) => {
    const current = await repository.getScheduleItemForUpdate(tx, id);
    if (!current) throw new NotFoundError("Échéance introuvable.");
    if ((await repository.countScheduleDocuments(tx, id)) > 0) {
      throw new ConflictError("Cette échéance porte des factures : elle ne peut pas être retirée.");
    }
    await repository.deleteScheduleItem(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "schedule_item.deleted",
      entityType: "schedule_item",
      entityId: id,
      metadata: { label: current.label, amountCents: current.amountCents },
    });
  });
}

// --- Coûts directs -----------------------------------------------------------------------------

export async function listDirectCosts(
  ctx: ServiceContext,
  rawFilter: unknown,
  params: PageParams,
): Promise<Paginated<repository.DirectCostRow>> {
  assertCan(ctx.actor, "finance:read");
  return repository.listDirectCosts(
    ctx.db,
    parseInput(directCostListFilterSchema, rawFilter),
    params,
  );
}

export async function getDirectCost(
  ctx: ServiceContext,
  id: string,
): Promise<repository.DirectCostRow> {
  assertCan(ctx.actor, "finance:read");
  const row = isUuid(id) ? await repository.getDirectCostRow(ctx.db, id) : null;
  if (!row) throw new NotFoundError("Coût introuvable.");
  return row;
}

export async function createDirectCost(ctx: ServiceContext, rawInput: unknown) {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(directCostInputSchema, rawInput);
  return ctx.db.transaction(async (tx) => {
    if (input.companyId) {
      await assertLinksBelongToCompany(tx, { ...input, companyId: input.companyId });
    }
    await assertCostMember(tx, input.memberId);
    const created = await repository.insertDirectCost(tx, input);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "direct_cost.created",
      entityType: "direct_cost",
      entityId: created.id,
      metadata: { label: created.label, amountCents: created.amountCents, nature: created.nature },
    });
    return created;
  });
}

export async function updateDirectCost(ctx: ServiceContext, id: string, rawInput: unknown) {
  assertCan(ctx.actor, "finance:manage");
  const input = parseInput(directCostInputSchema, rawInput);
  assertIdFormat(id, "Coût introuvable.");
  return ctx.db.transaction(async (tx) => {
    const current = await repository.getDirectCost(tx, id);
    if (!current) throw new NotFoundError("Coût introuvable.");
    if (input.companyId) {
      await assertLinksBelongToCompany(tx, { ...input, companyId: input.companyId });
    }
    await assertCostMember(tx, input.memberId, current.memberId);
    const updated = await repository.updateDirectCost(tx, id, input);
    if (!updated) throw new NotFoundError("Coût introuvable.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "direct_cost.updated",
      entityType: "direct_cost",
      entityId: id,
      metadata: {
        label: updated.label,
        fromCents: current.amountCents,
        toCents: updated.amountCents,
        nature: updated.nature,
      },
    });
    return updated;
  });
}

export async function deleteDirectCost(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "finance:manage");
  assertIdFormat(id, "Coût introuvable.");
  await ctx.db.transaction(async (tx) => {
    const current = await repository.getDirectCost(tx, id);
    if (!current) throw new NotFoundError("Coût introuvable.");
    await repository.deleteDirectCost(tx, id);
    // Le journal garde la trace complète de ce qui a été retiré.
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "direct_cost.deleted",
      entityType: "direct_cost",
      entityId: id,
      metadata: {
        label: current.label,
        amountCents: current.amountCents,
        category: current.category,
        nature: current.nature,
        incurredOn: current.incurredOn,
        companyId: current.companyId,
        projectId: current.projectId,
        contractId: current.contractId,
      },
    });
  });
}

export interface RecurringCostLine {
  id: string;
  label: string;
  /** Rattachement : client, sinon agence (`null`). */
  companyName: string | null;
  contractName: string | null;
  /** NULL : à chiffrer, jamais 0. */
  monthlyCents: number | null;
}

export interface SubscriptionMargin {
  contractId: string;
  number: string;
  name: string;
  companyName: string;
  monthlyPriceCents: number;
  /** NULL : aucun coût renseigné, le verdict est impossible. */
  monthlyCostCents: number | null;
  deficitCents: number;
}

export interface RecurringOverview {
  lines: RecurringCostLine[];
  /** Somme des lignes chiffrées. */
  monthlyTotalCents: number;
  toQuantifyCount: number;
  deficits: SubscriptionMargin[];
  subscriptionsWithoutCost: number;
  subscriptionsChecked: number;
}

/**
 * Coûts récurrents et abonnements déficitaires. Un abonnement est déficitaire si ses coûts mensuels
 * dépassent son prix mensuel. Coûts retenus : les coûts récurrents réalisés rattachés au contrat,
 * sinon le coût mensuel estimé du contrat. Le temps passé n'y entre pas : il est dans `getMargin`.
 */
export async function getRecurringOverview(ctx: ServiceContext): Promise<RecurringOverview> {
  assertCan(ctx.actor, "finance:read");
  const [costRows, { contractRows, costRows: contractCostRows }] = await Promise.all([
    repository.listRecurringCostRows(ctx.db),
    repository.listRunningContractsWithCosts(ctx.db),
  ]);

  const lines: RecurringCostLine[] = costRows.map((row) => ({
    id: row.id,
    label: row.label,
    companyName: row.companyName,
    contractName: row.contractName,
    monthlyCents:
      row.amountCents > 0 && row.recurringPeriod
        ? monthlyCents(row.amountCents, row.recurringPeriod)
        : null,
  }));

  const costByContract = new Map<string, number>();
  for (const row of contractCostRows) {
    if (!row.contractId || !row.recurringPeriod || row.amountCents <= 0) continue;
    costByContract.set(
      row.contractId,
      (costByContract.get(row.contractId) ?? 0) +
        monthlyCents(row.amountCents, row.recurringPeriod),
    );
  }

  const deficits: SubscriptionMargin[] = [];
  let withoutCost = 0;
  for (const contract of contractRows) {
    const monthlyPrice = monthlyCents(contract.priceCents, contract.period);
    const monthlyCost = costByContract.get(contract.id) ?? contract.monthlyCostCents;
    if (monthlyCost === null || monthlyCost === undefined) {
      withoutCost += 1;
      continue;
    }
    if (monthlyCost > monthlyPrice) {
      deficits.push({
        contractId: contract.id,
        number: contract.number,
        name: contract.name,
        companyName: contract.companyName,
        monthlyPriceCents: monthlyPrice,
        monthlyCostCents: monthlyCost,
        deficitCents: monthlyCost - monthlyPrice,
      });
    }
  }
  deficits.sort((a, b) => b.deficitCents - a.deficitCents);

  return {
    lines,
    monthlyTotalCents: lines.reduce((total, line) => total + (line.monthlyCents ?? 0), 0),
    toQuantifyCount: lines.filter((line) => line.monthlyCents === null).length,
    deficits,
    subscriptionsWithoutCost: withoutCost,
    subscriptionsChecked: contractRows.length,
  };
}

// --- Synthèse ----------------------------------------------------------------------------------

export interface FinanceMonth {
  key: string;
  label: string;
  longLabel: string;
  collectedCents: number;
  byIssuer: { memberId: string | null; name: string; cents: number }[];
}

export interface FinanceSummary {
  range: DayRange;
  /** Factures émises dans la période, avoirs déduits, annulées exclues. */
  invoicedCents: number;
  /** Factures payées dans la période. */
  collectedCents: number;
  collectedDocuments: number;
  /** Factures émises dont l'échéance n'est pas dépassée. */
  outstandingCents: number;
  outstandingCount: number;
  overdueCents: number;
  overdueCount: number;
  /** Part non facturée des échéances non payées : certain, mais pas encore facturé. */
  plannedScheduleCents: number;
  plannedScheduleCount: number;
  /** Devis envoyés non signés : prévisionnel, jamais additionné au certain. */
  openQuotesCents: number;
  openQuotesCount: number;
  /** Revenus récurrents mensuels des contrats en cours. */
  mrrCents: number;
  runningContracts: number;
  maxInvoicesPerScheduleItem: number;
  /** Encaissements des 6 derniers mois, par associé émetteur. */
  months: FinanceMonth[];
  documentCount: number;
  lastImportAt: Date | null;
}

/** Synthèse pour le tableau de bord et l'écran 21. Réservée à `finance:read` : vérifiée par l'appelant. */
export async function getFinanceSummary(
  db: Database,
  range: DayRange,
  now: Date = new Date(),
): Promise<FinanceSummary> {
  const today = parisDay(now);
  const months = lastMonths(range.to > today ? today : range.to, 6);
  const monthsRange = { from: months[0]?.range.from ?? range.from, to: range.to };
  const [
    collected,
    invoicedCents,
    open,
    planned,
    openQuotes,
    prices,
    monthly,
    maxInvoices,
    documentCount,
    lastImport,
  ] = await Promise.all([
    repository.sumCollected(db, range),
    repository.sumInvoiced(db, range),
    repository.sumOpenInvoices(db, today),
    repository.sumPlannedSchedule(db),
    repository.sumOpenQuotes(db),
    repository.listRunningContractPrices(db),
    repository.collectedByMonthAndIssuer(db, monthsRange),
    repository.maxDocumentsPerScheduleItem(db, range),
    repository.countDocuments(db),
    repository.getLastImport(db),
  ]);

  return {
    range,
    invoicedCents,
    collectedCents: collected.cents,
    collectedDocuments: collected.documents,
    outstandingCents: open.openCents,
    outstandingCount: open.openCount,
    overdueCents: open.overdueCents,
    overdueCount: open.overdueCount,
    plannedScheduleCents: planned.cents,
    plannedScheduleCount: planned.items,
    openQuotesCents: openQuotes.cents,
    openQuotesCount: openQuotes.quotes,
    mrrCents: prices.reduce((total, row) => total + monthlyCents(row.priceCents, row.period), 0),
    runningContracts: prices.length,
    maxInvoicesPerScheduleItem: maxInvoices,
    months: months.map((month) => {
      const rows = monthly.filter((row) => row.month === month.key);
      return {
        key: month.key,
        label: month.label,
        longLabel: month.longLabel,
        collectedCents: rows.reduce((total, row) => total + row.cents, 0),
        byIssuer: rows
          .map((row) => ({
            memberId: row.issuerMemberId,
            name: row.issuerName ?? "Sans émetteur",
            cents: row.cents,
          }))
          .sort((a, b) => b.cents - a.cents),
      };
    }),
    documentCount,
    lastImportAt: lastImport?.at ?? null,
  };
}

export interface FinanceOverview {
  summary: FinanceSummary;
  upcoming: repository.ScheduleRow[];
  /** Factures à relancer, les plus anciennes d'abord (10.04.03). */
  overdue: repository.InvoiceRow[];
  recurring: RecurringOverview;
  connection: {
    status: IntegrationStatus;
    lastSuccessAt: Date | null;
    appUrl: string;
  };
}

/** Données de l'écran 21, hors rentabilité (voir `profitability.service.ts`). */
export async function getFinanceOverview(
  ctx: ServiceContext,
  now: Date = new Date(),
): Promise<FinanceOverview> {
  assertCan(ctx.actor, "finance:read");
  const today = parisDay(now);
  const [summary, upcoming, overdue, recurring, connection] = await Promise.all([
    getFinanceSummary(ctx.db, monthOf(today), now),
    repository.listUpcomingSchedule(ctx.db, 5),
    repository.listOverdueRows(ctx.db, today, 5),
    getRecurringOverview(ctx),
    repository.getIndyConnection(ctx.db),
  ]);
  return {
    summary,
    upcoming,
    overdue,
    recurring,
    connection: {
      status: connection?.status ?? INDY_CONNECTION_STATUS,
      lastSuccessAt: connection?.lastSuccessAt ?? null,
      appUrl: INDY_APP_URL,
    },
  };
}

export interface FinanceFormOptions {
  companies: CompanyOption[];
  /** Associés actifs : les seuls émetteurs possibles (A12). */
  issuers: { id: string; fullName: string; kind: string }[];
  /** Tous les intervenants actifs : rattachement d'un coût, sous-traitance comprise. */
  members: { id: string; fullName: string; kind: string }[];
}

export async function getFinanceFormOptions(ctx: ServiceContext): Promise<FinanceFormOptions> {
  assertCan(ctx.actor, "finance:read");
  const [companies, issuers, members] = await Promise.all([
    listCompanyOptions(ctx.db, { limit: 500 }),
    repository.listIssuerOptions(ctx.db),
    repository.listMemberOptions(ctx.db),
  ]);
  return { companies, issuers, members };
}

/** Projets, contrats, devis, sites, échéances et justificatifs d'un client, pour les formulaires. */
export async function getCompanyLinks(
  ctx: ServiceContext,
  companyId: string,
): Promise<repository.CompanyLinks> {
  assertCan(ctx.actor, "finance:read");
  if (!isUuid(companyId)) throw new NotFoundError("Client introuvable.");
  return repository.listCompanyLinks(ctx.db, companyId);
}

/** Prochaine date d'échéance proposée : 30 jours après l'émission. */
export function defaultDueOn(issuedOn: string): string {
  return addDays(issuedOn, 30);
}
