import "server-only";
import { listContractsForCompany } from "@/modules/contracts/contract.service";
import { listDocumentsForCompany } from "@/modules/documents/document.service";
import { listInvoicesForCompany } from "@/modules/finance/finance.service";
import { getMarginForActor } from "@/modules/finance/profitability.service";
import { getProjectDetail, listProjectsForCompany } from "@/modules/projects/project.service";
import { listQuotesForCompany } from "@/modules/quotes/quote.service";
import { listSitesForCompany } from "@/modules/sites/site.service";
import { listTicketsForCompany } from "@/modules/support/ticket.service";
import { assertCan, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { logger } from "@/server/logger";

/**
 * Le reste de la fiche 360° (02.01.03) : projets, devis, contrats, demandes, documents, sites et
 * finances du client, lus par les services de leurs modules.
 *
 * `absent` : le rôle n'a pas ce droit, la section ne s'affiche pas. `unavailable` : la lecture a
 * échoué, la section le dit et le reste de la fiche reste consultable.
 */
export type RelatedSection<T> =
  { state: "absent" } | { state: "unavailable" } | { state: "ready"; data: T };

export async function loadSection<T>(
  key: string,
  allowed: boolean,
  load: () => Promise<T>,
): Promise<RelatedSection<T>> {
  if (!allowed) return { state: "absent" };
  try {
    return { state: "ready", data: await load() };
  } catch (error) {
    logger.error("crm.company_related.section_failed", { section: key, error });
    return { state: "unavailable" };
  }
}

const SECTION_LIMIT = 5;
const IN_PROGRESS: readonly string[] = ["active", "blocked", "in_validation"];

export async function loadCompanyRelated(ctx: ServiceContext, companyId: string) {
  assertCan(ctx.actor, "crm:read");

  const canReadProjects = can(ctx.actor, "projects:read");
  const canReadFinance = can(ctx.actor, "finance:read");
  const [projects, quotes, contracts, tickets, documents, sites, invoices, margin] =
    await Promise.all([
      loadSection("projects", canReadProjects, async () => {
        const listed = await listProjectsForCompany(ctx, companyId, { limit: SECTION_LIMIT });
        // La frise de l'écran 04 montre le projet en cours, sinon le plus récent.
        const lead = listed.find((row) => IN_PROGRESS.includes(row.status)) ?? listed[0];
        const detail = lead ? await getProjectDetail(ctx, lead.id) : null;
        const rows = lead ? [lead, ...listed.filter((row) => row !== lead)] : listed;
        return { rows, leadPhases: detail?.phases ?? [] };
      }),
      loadSection("quotes", can(ctx.actor, "quotes:read"), () =>
        listQuotesForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("contracts", can(ctx.actor, "contracts:read"), () =>
        listContractsForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("tickets", can(ctx.actor, "support:read"), () =>
        listTicketsForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("documents", can(ctx.actor, "documents:read"), () =>
        listDocumentsForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("sites", can(ctx.actor, "sites:read"), () =>
        listSitesForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("invoices", canReadFinance, () =>
        listInvoicesForCompany(ctx, companyId, { limit: SECTION_LIMIT }),
      ),
      loadSection("margin", canReadFinance, () =>
        getMarginForActor(ctx, { scope: "client", id: companyId }),
      ),
    ]);
  return { projects, quotes, contracts, tickets, documents, sites, invoices, margin };
}

export type CompanyRelated = Awaited<ReturnType<typeof loadCompanyRelated>>;
