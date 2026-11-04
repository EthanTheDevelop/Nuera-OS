import "server-only";
import {
  docusealNotConfigured,
  isDocusealConfigured,
  type DocusealGateway,
  type DocusealSubmissionStatus,
} from "@/integrations/docuseal";
import {
  CONTRACT_KIND_LABELS,
  SIGNATURE_STATUS_LABELS,
  type SignatureStatus,
} from "@/lib/domain-enums";
import { formatDateNumeric } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import { recordAudit } from "@/modules/audit/audit.service";
import { listContactOptions } from "@/modules/crm/company.lookup";
import { assertCan } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Contract } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import { z } from "@/lib/zod";
import * as repository from "./contract.repository";
import { periodLabel } from "./contract.format";

/**
 * Signature d'un contrat par DocuSeal. Sans connexion, rien n'est simulé : l'état se saisit à la main
 * (`updateContractSignature`). L'état revient par « Vérifier la signature » : le webhook DocuSeal
 * appartient aux devis et ne connaît pas les contrats.
 */
const SIGNER_ROLE = "Client";

const requestSignatureSchema = z.object({
  signerContactId: z.uuid({ error: "Choisissez la personne qui signe." }),
});

export function isContractSignatureConfigured(): boolean {
  return isDocusealConfigured();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function section(title: string, body: string | null): string {
  if (!body) return "";
  const text = escapeHtml(body).replaceAll("\n", "<br>");
  return `<h2 style="font-size:14px;margin:20px 0 4px">${escapeHtml(title)}</h2><p style="margin:0">${text}</p>`;
}

/** Document présenté à la signature, tiré des seules données du contrat. */
export function renderContractHtml(contract: Contract, companyName: string): string {
  const rows = [
    ["Client", companyName],
    ["Type", CONTRACT_KIND_LABELS[contract.kind]],
    ["Prix", `${formatCentsHT(contract.priceCents)} · ${periodLabel(contract.period)}`],
    ["Début", contract.startOn ? formatDateNumeric(contract.startOn) : "À la mise en service"],
    ["Fin", contract.endOn ? formatDateNumeric(contract.endOn) : "Sans date de fin"],
    ["Renouvellement", contract.autoRenew ? "Automatique" : "Sur accord"],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5a6072">${escapeHtml(label ?? "")}</td><td style="padding:4px 0">${escapeHtml(value ?? "")}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="fr"><body style="font-family:sans-serif;font-size:13px;color:#141730">
<h1 style="font-size:20px;margin:0 0 4px">Contrat ${escapeHtml(contract.number)}</h1>
<p style="margin:0 0 16px">${escapeHtml(contract.name)}</p>
<table style="border-collapse:collapse">${rows}</table>
${section("Périmètre", contract.scope)}
${section("Exclusions", contract.exclusions)}
${section("Conditions", contract.conditions)}
<p style="margin:32px 0 8px">Signature :</p>
<signature-field name="Signature" role="${SIGNER_ROLE}" style="width:240px;height:80px"></signature-field>
</body></html>`;
}

const SIGNATURE_FROM_SUBMISSION: Record<DocusealSubmissionStatus, SignatureStatus> = {
  completed: "signed",
  declined: "declined",
  expired: "none",
  pending: "pending",
};

/** Envoie le contrat à signer. Une demande déjà en attente n'en crée pas une seconde. */
export async function requestContractSignature(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  deps: { docuseal: DocusealGateway },
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  const { signerContactId } = parseInput(requestSignatureSchema, input);
  if (!deps.docuseal.isConfigured) throw docusealNotConfigured();

  let createdSubmissionId: string | null = null;
  try {
    return await ctx.db.transaction(async (tx) => {
      const contract = await repository.lockContract(tx, id);
      if (!contract) throw new NotFoundError("Contrat introuvable.");
      if (contract.status === "terminated" || contract.status === "expired") {
        throw new ConflictError("Ce contrat est terminé : il ne se signe plus.");
      }
      if (contract.signatureStatus === "signed") {
        throw new ConflictError("Ce contrat est déjà signé.");
      }
      if (contract.signatureStatus === "pending" && contract.docusealSubmissionId) return contract;

      const contacts = await listContactOptions(tx, contract.companyId);
      const signer = contacts.find((contact) => contact.id === signerContactId);
      if (!signer) {
        throw new NotFoundError("Cette personne n'est pas un contact de ce client.");
      }
      if (!signer.email) {
        throw new ValidationError("Ce contact n'a pas d'adresse e-mail.", {
          signerContactId: ["Adresse e-mail manquante sur la fiche du contact."],
        });
      }

      const { companyName } = await repository.findContractLabels(tx, contract);
      const submission = await deps.docuseal.createSubmission({
        name: `Contrat ${contract.number}`,
        document: {
          name: `Contrat ${contract.number}`,
          html: renderContractHtml(contract, companyName),
        },
        submitter: {
          role: SIGNER_ROLE,
          name: signer.fullName,
          email: signer.email,
          externalId: `contract:${contract.id}`,
        },
      });
      createdSubmissionId = submission.id;

      const updated = await repository.updateContract(tx, id, {
        signatureStatus: "pending",
        docusealSubmissionId: submission.id,
      });
      await repository.insertEvent(tx, {
        contractId: id,
        kind: "note",
        note: `Envoyé à la signature de ${signer.fullName}.`,
        actorId: ctx.actor.userId,
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "contract.updated",
        entityType: "contract",
        entityId: id,
        metadata: {
          number: contract.number,
          submissionId: submission.id,
          toSignature: "pending",
          source: "docuseal",
        },
      });
      return updated;
    });
  } catch (error) {
    // La demande existe chez DocuSeal mais pas ici : on la retire pour ne pas laisser un e-mail orphelin.
    if (createdSubmissionId) {
      await deps.docuseal.archiveSubmission(createdSubmissionId).catch((cause: unknown) => {
        logger.warn("contract.signature_cleanup_failed", { contractId: id, error: cause });
      });
    }
    throw error;
  }
}

/** Relit l'état chez DocuSeal et l'applique. Même état : rien ne s'écrit. */
export async function refreshContractSignature(
  ctx: ServiceContext,
  id: string,
  deps: { docuseal: DocusealGateway },
): Promise<Contract> {
  assertCan(ctx.actor, "contracts:update");
  if (!deps.docuseal.isConfigured) throw docusealNotConfigured();

  const current = await repository.findContract(ctx.db, id);
  if (!current) throw new NotFoundError("Contrat introuvable.");
  if (!current.docusealSubmissionId) {
    throw new ConflictError("Aucune demande de signature n'est en cours pour ce contrat.");
  }
  // Hors transaction : un appel réseau ne doit pas garder le verrou du contrat.
  const submission = await deps.docuseal.getSubmission(current.docusealSubmissionId);
  const status = SIGNATURE_FROM_SUBMISSION[submission.status];

  return ctx.db.transaction(async (tx) => {
    const contract = await repository.lockContract(tx, id);
    if (!contract) throw new NotFoundError("Contrat introuvable.");
    if (contract.signatureStatus === status) return contract;
    const updated = await repository.updateContract(tx, id, {
      signatureStatus: status,
      // Une demande expirée est close : une nouvelle pourra partir.
      docusealSubmissionId: submission.status === "expired" ? null : contract.docusealSubmissionId,
    });
    await repository.insertEvent(tx, {
      contractId: id,
      kind: "note",
      note: `Signature : ${SIGNATURE_STATUS_LABELS[status]} (DocuSeal).`,
      actorId: ctx.actor.userId,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contract.updated",
      entityType: "contract",
      entityId: id,
      metadata: {
        number: contract.number,
        fromSignature: contract.signatureStatus,
        toSignature: status,
        source: "docuseal",
      },
    });
    return updated;
  });
}
