import type { DocusealGateway } from "@/integrations/docuseal/docuseal.client";
import { logger } from "@/server/logger";

/** Dépendances externes d'un service, passées explicitement : les tests y branchent un serveur local. */
export interface QuoteDeps {
  docuseal: DocusealGateway;
}

/**
 * Archive chez DocuSeal une demande devenue caduque. Au mieux : l'état local fait déjà foi, et un
 * webhook de cette demande sera ignoré. Un échec se journalise sans bloquer l'utilisateur.
 */
export async function cancelSubmissionQuietly(
  deps: QuoteDeps,
  submissionId: string | null,
  quoteId: string,
): Promise<void> {
  if (!submissionId || !deps.docuseal.isConfigured) return;
  try {
    await deps.docuseal.archiveSubmission(submissionId);
  } catch (error) {
    logger.warn("quote.signature_cancel_failed", { quoteId, submissionId, error });
  }
}
