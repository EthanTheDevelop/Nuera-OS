import { docusealNotConfigured } from "@/integrations/docuseal/docuseal.client";
import type { DocusealWebhookEvent } from "@/integrations/docuseal/docuseal.webhook";
import { recordAudit } from "@/modules/audit/audit.service";
import { listContactOptions } from "@/modules/crm/company.lookup";
import { emitEvent } from "@/modules/platform/events";
import { createProjectFromQuote } from "@/modules/projects/project.service";
import { markOpportunityWon, markQuoteSent } from "@/modules/sales/opportunity.service";
import { assertCan, type Actor } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Quote, QuoteVersion } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import { cancelSubmissionQuietly, type QuoteDeps } from "./quote.deps";
import { buildQuoteDocument, renderSignatureHtml } from "./quote.document";
import * as quoteRepository from "./quote.repository";
import {
  isOpenStatus,
  isValidityOver,
  parseSignatureExternalId,
  signatureExternalId,
  SIGNER_ROLE,
  todayInParis,
} from "./quote.rules";
import { manualAcceptanceSchema, sendForSignatureSchema } from "./quote.schema";
import { requireCurrentVersion, toDocumentInput } from "./quote.service";
import { assertQuoteTransition, canQuoteTransition } from "./quote.status";

/**
 * Envoi, signature et acceptation.
 *
 * Nuera OS n'émet pas le document légal : il garde les références (Indy) et trace la signature.
 * L'acceptation, par DocuSeal ou saisie manuelle, se joue dans UNE transaction et est idempotente :
 * devis accepté, affaire gagnée, projet créé, événement `quote.accepted`.
 */

// --- Disponibilité et listes -------------------------------------------------------------------

/** Pour l'écran : DocuSeal est-il branché ? Si non, seul le parcours manuel est proposé. */
export function getSignatureAvailability(deps: QuoteDeps): { configured: boolean } {
  return { configured: deps.docuseal.isConfigured };
}

/** Contacts du client du devis : la personne qui signe en fait partie. */
export async function getSignerOptions(ctx: ServiceContext, quoteId: string) {
  assertCan(ctx.actor, "quotes:send");
  const quote = await quoteRepository.findById(ctx.db, quoteId);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  const [contacts, context] = await Promise.all([
    listContactOptions(ctx.db, quote.companyId),
    quoteRepository.findContext(ctx.db, quote),
  ]);
  return { contacts, defaultContactId: context.opportunityContactId };
}

// --- Envoi -------------------------------------------------------------------------------------

function assertSendable(
  version: QuoteVersion,
  lines: readonly { quantity: number }[],
  now: Date,
): void {
  if (lines.length === 0 || version.totalCents <= 0) {
    throw new ConflictError("Ajoutez au moins une ligne chiffrée avant d'envoyer ce devis.");
  }
  if (!version.validUntil) {
    throw new ConflictError("Indiquez la date de validité avant d'envoyer ce devis.", {
      validUntil: ["Date de validité obligatoire pour envoyer."],
    });
  }
  if (isValidityOver(version.validUntil, now)) {
    throw new ConflictError("La date de validité est dépassée : mettez-la à jour avant d'envoyer.");
  }
}

interface MarkSentOptions {
  actorId: string;
  signatureStatus: Quote["signatureStatus"];
  now: Date;
}

/**
 * Applique l'envoi dans la transaction. Une version n'est envoyée qu'une fois : redemander une
 * signature sur la même version ne réémet pas `quote.sent` et ne touche pas à la version.
 */
async function applySent(
  ctx: ServiceContext,
  tx: Database,
  quote: Quote,
  version: QuoteVersion,
  options: MarkSentOptions,
): Promise<Quote> {
  const firstSend = version.sentAt === null;
  if (firstSend) {
    await quoteRepository.updateVersion(tx, version.id, { sentAt: options.now });
  }
  if (quote.status === "draft") assertQuoteTransition("draft", "sent");

  const updated = await quoteRepository.updateQuote(tx, quote.id, {
    status: quote.status === "draft" ? "sent" : quote.status,
    signatureStatus: options.signatureStatus,
    docusealSubmissionId: null,
    ...(firstSend ? { sentAt: options.now, lastReminderAt: null } : {}),
  });

  if (firstSend) {
    await recordAudit(tx, {
      actorId: options.actorId,
      action: "quote.sent",
      entityType: "quote",
      entityId: quote.id,
      metadata: {
        number: quote.number,
        version: version.version,
        totalCents: version.totalCents,
        channel: options.signatureStatus === "pending" ? "docuseal" : "manual",
      },
    });
    await emitEvent(tx, {
      type: "quote.sent",
      entityType: "quote",
      entityId: quote.id,
      companyId: quote.companyId,
      payload: { number: quote.number, versionId: version.id, totalCents: version.totalCents },
      actorId: options.actorId,
      dedupeKey: `quote.sent:${version.id}`,
    });
    if (quote.opportunityId) {
      await markQuoteSent(ctx, tx, { opportunityId: quote.opportunityId });
    }
  }
  return updated;
}

/**
 * « Envoyer à signer ». Sans connexion : `ServiceUnavailableError`, rien n'est écrit, et l'écran
 * propose le parcours manuel.
 *
 * Tout se joue sous le verrou du devis : deux clics s'attendent, le second trouve la signature en
 * attente et ne crée pas de seconde demande. L'appel à DocuSeal vient EN DERNIER, après l'écriture
 * dans Twenty : si le CRM est coupé, le client ne reçoit aucun e-mail. Si DocuSeal échoue, la
 * transaction s'annule. Seul reste possible un écart d'étape dans Twenty, sans gravité, qu'un
 * nouvel envoi rattrape. Si la validation finale échoue, la demande créée est archivée.
 */
export async function sendQuoteForSignature(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  deps: QuoteDeps,
  now: Date = new Date(),
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:send");
  const { signerContactId } = parseInput(sendForSignatureSchema, input);
  if (!deps.docuseal.isConfigured) throw docusealNotConfigured();

  let createdSubmissionId: string | null = null;
  try {
    return await ctx.db.transaction(async (tx) => {
      const quote = await quoteRepository.lockById(tx, id);
      if (!quote) throw new NotFoundError("Devis introuvable.");
      if (!isOpenStatus(quote.status)) throw new ConflictError("Ce devis est clos.");

      const version = await requireCurrentVersion(tx, quote);
      if (version.sentAt && quote.signatureStatus === "pending") return quote;

      const lines = await quoteRepository.findLines(tx, version.id);
      assertSendable(version, lines, now);

      const signer = await quoteRepository.findContact(tx, signerContactId, quote.companyId);
      if (!signer) {
        throw new ConflictError("Cette personne n'est pas un contact de ce client.", {
          signerContactId: ["Contact d'un autre client."],
        });
      }
      if (!signer.email) {
        throw new ValidationError("Ce contact n'a pas d'adresse e-mail.", {
          signerContactId: ["Adresse e-mail manquante sur la fiche du contact."],
        });
      }

      const context = await quoteRepository.findContext(tx, quote);
      const html = renderSignatureHtml(
        buildQuoteDocument(
          toDocumentInput(quote, {
            company: { name: context.companyName, ...context.companyAddress },
            version,
            lines,
          }),
        ),
      );

      await applySent(ctx, tx, quote, version, {
        actorId: ctx.actor.userId,
        signatureStatus: "pending",
        now,
      });

      const submission = await deps.docuseal.createSubmission({
        name: `Devis ${quote.number} · version ${version.version}`,
        document: { name: `Devis ${quote.number}`, html },
        submitter: {
          role: SIGNER_ROLE,
          name: signer.fullName,
          email: signer.email,
          externalId: signatureExternalId(quote.id, version.id),
        },
        expireAt: version.validUntil ? new Date(`${version.validUntil}T23:59:59Z`) : null,
      });
      createdSubmissionId = submission.id;

      const updated = await quoteRepository.updateQuote(tx, quote.id, {
        docusealSubmissionId: submission.id,
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "quote.signature_requested",
        entityType: "quote",
        entityId: quote.id,
        metadata: {
          version: version.version,
          submissionId: submission.id,
          signerEmail: signer.email,
        },
      });
      return updated;
    });
  } catch (error) {
    await cancelSubmissionQuietly(deps, createdSubmissionId, id);
    throw error;
  }
}

/**
 * Parcours manuel : le devis part hors DocuSeal (e-mail, Indy, papier). `signature_status` vaut
 * `unavailable` : la signature sera enregistrée à la main, avec sa référence. Idempotent.
 */
export async function markQuoteSentManually(
  ctx: ServiceContext,
  id: string,
  now: Date = new Date(),
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:send");
  return ctx.db.transaction(async (tx) => {
    const quote = await quoteRepository.lockById(tx, id);
    if (!quote) throw new NotFoundError("Devis introuvable.");
    if (!isOpenStatus(quote.status)) throw new ConflictError("Ce devis est clos.");
    const version = await requireCurrentVersion(tx, quote);
    if (version.sentAt) return quote;
    assertSendable(version, await quoteRepository.findLines(tx, version.id), now);
    return applySent(ctx, tx, quote, version, {
      actorId: ctx.actor.userId,
      signatureStatus: "unavailable",
      now,
    });
  });
}

// --- Acceptation -------------------------------------------------------------------------------

interface AcceptOptions {
  /** NULL : action système (webhook). */
  auditActorId: string | null;
  method: "docuseal" | "manual";
  signedAt: Date;
  references?: { indyReference: string | null; officialDocumentUrl: string | null };
  note?: string | null;
}

async function lockAndFindRival(tx: Database, quote: Quote) {
  if (!quote.opportunityId) return null;
  await quoteRepository.lockOpportunity(tx, quote.opportunityId);
  return quoteRepository.findAcceptedSibling(tx, quote.opportunityId, quote.id);
}

/**
 * Cœur de l'acceptation, à appeler avec le devis verrouillé. C'est la dernière version envoyée qui
 * est acceptée : une version en préparation n'a jamais été vue par le client.
 *
 * Un avenant ne crée ni projet ni gain d'affaire : il modifie un projet déjà lancé.
 */
async function acceptInTransaction(
  ctx: ServiceContext,
  tx: Database,
  quote: Quote,
  options: AcceptOptions,
): Promise<{ quote: Quote; alreadyAccepted: boolean; projectId: string | null }> {
  if (quote.status === "accepted") {
    return { quote, alreadyAccepted: true, projectId: null };
  }
  assertQuoteTransition(quote.status, "accepted");

  const version = await quoteRepository.findLatestSentVersion(tx, quote.id);
  if (!version) throw new ConflictError("Ce devis n'a jamais été envoyé.");

  // Une affaire, un projet : un second devis accepté sur la même affaire en créerait un autre. Le
  // verrou de l'affaire départage deux acceptations simultanées.
  const rival = quote.parentQuoteId ? null : await lockAndFindRival(tx, quote);
  if (rival) {
    throw new ConflictError(
      `Le devis ${rival.number} est déjà accepté sur cette affaire : refusez celui-ci, ou créez un avenant.`,
    );
  }

  const now = new Date();
  const accepted = await quoteRepository.updateQuote(tx, quote.id, {
    status: "accepted",
    acceptedAt: now,
    acceptedVersionId: version.id,
    currentVersionId: version.id,
    signatureStatus: "signed",
    signedAt: options.signedAt,
    // Acceptation manuelle : la demande DocuSeal est archivée, elle ne désigne aucun document signé.
    ...(options.method === "manual" ? { docusealSubmissionId: null } : {}),
    ...(options.references ?? {}),
  });

  await recordAudit(tx, {
    actorId: options.auditActorId,
    action: "quote.signed",
    entityType: "quote",
    entityId: quote.id,
    metadata: {
      method: options.method,
      version: version.version,
      signedAt: options.signedAt.toISOString(),
      submissionId: quote.docusealSubmissionId,
      indyReference: options.references?.indyReference ?? quote.indyReference,
      officialDocumentUrl: options.references?.officialDocumentUrl ?? quote.officialDocumentUrl,
      note: options.note ?? null,
    },
  });
  await recordAudit(tx, {
    actorId: options.auditActorId,
    action: "quote.accepted",
    entityType: "quote",
    entityId: quote.id,
    metadata: { number: quote.number, version: version.version, totalCents: version.totalCents },
  });

  let projectId: string | null = null;
  if (!quote.parentQuoteId) {
    if (quote.opportunityId) {
      await markOpportunityWon(ctx, tx, { opportunityId: quote.opportunityId, quoteId: quote.id });
    }
    const project = await createProjectFromQuote(ctx, tx, {
      quoteId: quote.id,
      opportunityId: quote.opportunityId,
      companyId: quote.companyId,
      versionId: version.id,
    });
    projectId = project.id;
  }

  await emitEvent(tx, {
    type: "quote.accepted",
    entityType: "quote",
    entityId: quote.id,
    companyId: quote.companyId,
    payload: {
      number: quote.number,
      versionId: version.id,
      opportunityId: quote.opportunityId,
      totalCents: version.totalCents,
    },
    actorId: options.auditActorId,
    dedupeKey: `quote.accepted:${quote.id}`,
  });

  return { quote: accepted, alreadyAccepted: false, projectId };
}

/**
 * Acceptation hors DocuSeal : la référence du document signé est obligatoire et auditée. Une
 * demande DocuSeal encore ouverte est archivée ensuite, pour que le client ne signe pas deux fois.
 */
export async function acceptQuoteManually(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  deps: QuoteDeps,
  now: Date = new Date(),
) {
  assertCan(ctx.actor, "quotes:update");
  const data = parseInput(manualAcceptanceSchema, input);
  if (data.signedOn > todayInParis(now)) {
    throw new ValidationError("La date de signature ne peut pas être dans le futur.", {
      signedOn: ["La date de signature ne peut pas être dans le futur."],
    });
  }

  let submissionToCancel: string | null = null;
  const result = await ctx.db.transaction(async (tx) => {
    const quote = await quoteRepository.lockById(tx, id);
    if (!quote) throw new NotFoundError("Devis introuvable.");
    submissionToCancel =
      quote.status !== "accepted" && quote.signatureStatus === "pending"
        ? quote.docusealSubmissionId
        : null;
    return acceptInTransaction(ctx, tx, quote, {
      auditActorId: ctx.actor.userId,
      method: "manual",
      signedAt: new Date(`${data.signedOn}T12:00:00Z`),
      references: {
        indyReference: data.indyReference ?? quote.indyReference,
        officialDocumentUrl: data.officialDocumentUrl ?? quote.officialDocumentUrl,
      },
      note: data.note,
    });
  });
  await cancelSubmissionQuietly(deps, submissionToCancel, id);
  return result;
}

// --- Retours de DocuSeal -----------------------------------------------------------------------

/**
 * Un webhook n'a pas d'utilisateur. Les services appelés exigent un acteur : c'est l'auteur de la
 * version signée, ou à défaut le plus ancien associé actif. Le journal du devis, lui, marque
 * l'action comme système (`actorId` NULL).
 */
async function delegatedContext(
  base: Pick<ServiceContext, "db" | "crm">,
  tx: Database,
  quote: Quote,
): Promise<ServiceContext> {
  const version = await quoteRepository.findLatestSentVersion(tx, quote.id);
  const author = version?.createdBy ? await quoteRepository.findUser(tx, version.createdBy) : null;
  if (author && !author.banned && (author.role === "admin" || author.role === "member")) {
    const actor: Actor = {
      userId: author.id,
      role: author.role,
      name: author.name,
      email: author.email,
    };
    return { db: tx, crm: base.crm, actor };
  }
  const admin = await quoteRepository.findOldestAdmin(tx);
  if (!admin) throw new Error("Aucun compte associé pour traiter la signature.");
  return {
    db: tx,
    crm: base.crm,
    actor: { userId: admin.id, role: "admin", name: admin.name, email: admin.email },
  };
}

async function applySignatureCompleted(
  base: Pick<ServiceContext, "db" | "crm">,
  tx: Database,
  quote: Quote,
  completedAt: Date | null,
): Promise<"processed" | "ignored"> {
  if (quote.status === "accepted") return "processed";
  if (!canQuoteTransition(quote.status, "accepted")) {
    // Le client a signé un devis clos entre-temps : on ne le rouvre pas, mais on le trace.
    logger.warn("quote.signature_on_closed", { quoteId: quote.id, status: quote.status });
    await recordAudit(tx, {
      actorId: null,
      action: "quote.signature_ignored",
      entityType: "quote",
      entityId: quote.id,
      metadata: { reason: "closed", status: quote.status },
    });
    return "ignored";
  }
  // Un refus ici ferait rejouer le webhook pendant 48 h pour rien : on trace, l'équipe arbitre.
  const rival = quote.parentQuoteId ? null : await lockAndFindRival(tx, quote);
  if (rival) {
    logger.warn("quote.signature_on_rival", { quoteId: quote.id, acceptedQuoteId: rival.id });
    await recordAudit(tx, {
      actorId: null,
      action: "quote.signature_ignored",
      entityType: "quote",
      entityId: quote.id,
      metadata: { reason: "other_quote_accepted", acceptedNumber: rival.number },
    });
    return "ignored";
  }
  const ctx = await delegatedContext(base, tx, quote);
  await acceptInTransaction(ctx, tx, quote, {
    auditActorId: null,
    method: "docuseal",
    signedAt: completedAt ?? new Date(),
  });
  return "processed";
}

async function applySignatureDeclined(
  tx: Database,
  quote: Quote,
  declineReason: string | null,
): Promise<void> {
  if (quote.status === "accepted") return;
  await quoteRepository.updateQuote(tx, quote.id, {
    signatureStatus: "declined",
    docusealSubmissionId: null,
  });
  await recordAudit(tx, {
    actorId: null,
    action: "quote.signature_declined",
    entityType: "quote",
    entityId: quote.id,
    metadata: { reason: declineReason },
  });
}

/** Demande expirée ou archivée chez DocuSeal : une nouvelle pourra être envoyée. */
async function applySignatureClosed(
  tx: Database,
  quote: Quote,
  reason: "expired" | "archived",
): Promise<void> {
  if (quote.status === "accepted") return;
  await quoteRepository.updateQuote(tx, quote.id, {
    signatureStatus: "none",
    docusealSubmissionId: null,
  });
  await recordAudit(tx, {
    actorId: null,
    action: "quote.updated",
    entityType: "quote",
    entityId: quote.id,
    metadata: { signature: reason },
  });
}

export type DocusealWebhookOutcome = "processed" | "ignored" | "duplicate";

/**
 * Traite un webhook déjà authentifié. Le reçu et les effets sont dans la même transaction : si le
 * traitement échoue (CRM indisponible par exemple), rien n'est gardé, la route répond 5xx et
 * DocuSeal rejoue. Un rejeu d'un événement déjà traité répond `duplicate`, sans effet.
 */
export async function processDocusealWebhook(
  base: Pick<ServiceContext, "db" | "crm">,
  event: DocusealWebhookEvent,
): Promise<DocusealWebhookOutcome> {
  if (event.type === "ignored") return "ignored";

  return base.db.transaction(async (tx) => {
    if (!(await quoteRepository.claimWebhookReceipt(tx, event.receiptId))) return "duplicate";

    const quote = await quoteRepository.lockBySubmissionId(tx, event.submissionId);
    if (!quote) {
      await traceOrphanSignature(tx, event);
      await quoteRepository.setWebhookReceiptStatus(tx, event.receiptId, "ignored");
      return "ignored";
    }

    let outcome: "processed" | "ignored" = "processed";
    switch (event.type) {
      case "submission.completed":
        outcome = await applySignatureCompleted(base, tx, quote, event.completedAt);
        break;
      case "form.declined":
        await applySignatureDeclined(tx, quote, event.declineReason);
        break;
      case "submission.expired":
        await applySignatureClosed(tx, quote, "expired");
        break;
      case "submission.archived":
        await applySignatureClosed(tx, quote, "archived");
        break;
    }
    await quoteRepository.setWebhookReceiptStatus(tx, event.receiptId, outcome);
    return outcome;
  });
}

/**
 * Signature d'une demande rendue caduque par une nouvelle version : pas d'effet sur le devis, mais
 * l'équipe doit pouvoir le lire dans l'historique, puisque le client croit avoir signé.
 */
async function traceOrphanSignature(
  tx: Database,
  event: Exclude<DocusealWebhookEvent, { type: "ignored" }>,
): Promise<void> {
  if (event.type !== "submission.completed") return;
  const reference = event.externalIds.map(parseSignatureExternalId).find(Boolean);
  if (!reference) return;
  const quote = await quoteRepository.findById(tx, reference.quoteId);
  if (!quote) return;
  logger.warn("quote.signature_on_stale_submission", {
    quoteId: quote.id,
    submissionId: event.submissionId,
  });
  await recordAudit(tx, {
    actorId: null,
    action: "quote.signature_ignored",
    entityType: "quote",
    entityId: quote.id,
    metadata: {
      reason: "stale_version",
      versionId: reference.versionId,
      submissionId: event.submissionId,
    },
  });
}

/**
 * Adresse du document signé dans DocuSeal. Elle expire vite : relue à chaque ouverture, jamais
 * gardée en base. Sans connexion : `ServiceUnavailableError`.
 */
export async function getSignedDocumentUrl(
  ctx: ServiceContext,
  id: string,
  deps: QuoteDeps,
): Promise<string> {
  assertCan(ctx.actor, "quotes:read");
  const quote = await quoteRepository.findById(ctx.db, id);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  if (quote.signatureStatus !== "signed" || !quote.docusealSubmissionId) {
    throw new ConflictError("Ce devis n'a pas de document signé dans DocuSeal.");
  }
  if (!deps.docuseal.isConfigured) throw docusealNotConfigured();
  const [document] = await deps.docuseal.getSubmissionDocuments(quote.docusealSubmissionId);
  if (!document) throw new ConflictError("DocuSeal ne trouve pas le document signé.");
  return document.url;
}

/**
 * « Vérifier la signature » : relit l'état chez DocuSeal et applique le même traitement qu'un
 * webhook. Utile si un webhook s'est perdu, ou s'il ne peut pas atteindre l'instance.
 */
export async function refreshQuoteSignature(
  ctx: ServiceContext,
  id: string,
  deps: QuoteDeps,
): Promise<Quote> {
  assertCan(ctx.actor, "quotes:send");
  const quote = await quoteRepository.findById(ctx.db, id);
  if (!quote) throw new NotFoundError("Devis introuvable.");
  if (quote.signatureStatus !== "pending" || !quote.docusealSubmissionId) return quote;

  const submission = await deps.docuseal.getSubmission(quote.docusealSubmissionId);
  await ctx.db.transaction(async (tx) => {
    const locked = await quoteRepository.lockById(tx, id);
    if (!locked || locked.docusealSubmissionId !== submission.id) return;
    switch (submission.status) {
      case "completed":
        await applySignatureCompleted(ctx, tx, locked, submission.completedAt);
        break;
      case "declined":
        await applySignatureDeclined(tx, locked, null);
        break;
      case "expired":
        await applySignatureClosed(tx, locked, "expired");
        break;
      case "pending":
        break;
    }
  });
  const refreshed = await quoteRepository.findById(ctx.db, id);
  if (!refreshed) throw new NotFoundError("Devis introuvable.");
  return refreshed;
}
