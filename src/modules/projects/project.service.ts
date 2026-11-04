import type { ServiceContext } from "@/server/context";
import type { Project } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface CreateProjectFromQuoteInput {
  quoteId: string;
  /** NULL : devis sans affaire d'origine. */
  opportunityId: string | null;
  companyId: string;
  /** Version acceptée du devis, source du périmètre et du budget. */
  versionId: string;
}

/**
 * Crée le projet d'un devis accepté. Idempotent par `quoteId` (index unique partiel) : une seconde
 * exécution renvoie le projet existant.
 */
export async function createProjectFromQuote(
  _ctx: ServiceContext,
  _tx: Database,
  _input: CreateProjectFromQuoteInput,
): Promise<Project> {
  throw new Error("createProjectFromQuote n'est pas implémenté : à livrer par le lot Projets.");
}
