import type { TicketCategory, TicketCoverage } from "@/lib/domain-enums";
import type { Database } from "@/server/db/types";

export interface ResolveCoverageInput {
  companyId: string;
  siteId?: string | null;
  contractId?: string | null;
  category: TicketCategory;
}

/** Réponse à « cette demande est-elle couverte ? », à recopier dans `tickets.coverage`. */
export interface CoverageDecision {
  coverage: TicketCoverage;
  /** Contrat retenu ; NULL si aucun ne s'applique. */
  contractId: string | null;
  /** Explication en français, affichable telle quelle. */
  reason: string;
  /** Quota de la période ; NULL si le contrat n'en prévoit pas. */
  includedMinutes: number | null;
  consumedMinutes: number | null;
  includedTickets: number | null;
  consumedTickets: number | null;
}

/** Détermine la couverture d'une demande d'après les contrats actifs du client et du site. */
export async function resolveCoverage(
  _db: Database,
  _input: ResolveCoverageInput,
): Promise<CoverageDecision> {
  throw new Error("resolveCoverage n'est pas implémenté : à livrer par le lot Contrats.");
}

export interface ConsumeContractQuotaInput {
  contractId: string;
  minutes: number;
  /** NULL : consommation hors ticket (intervention planifiée). */
  ticketId: string | null;
}

/** Impute une consommation au forfait et émet `contract.quota_80` ou `contract.quota_exceeded`. */
export async function consumeContractQuota(
  _tx: Database,
  _input: ConsumeContractQuotaInput,
): Promise<void> {
  throw new Error("consumeContractQuota n'est pas implémenté : à livrer par le lot Contrats.");
}
