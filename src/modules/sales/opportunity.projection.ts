import type { CrmOpportunity } from "@/integrations/twenty/crm-gateway";
import { recordAudit } from "@/modules/audit/audit.service";
import { getCompanyRefByTwentyId, getContactRefByTwentyId } from "@/modules/crm/company.lookup";
import { promoteCompanyOnWin } from "@/modules/crm/company.service";
import { isStaleVersion, type ProjectionOutcome } from "@/modules/crm/crm.projection";
import { emitEvent } from "@/modules/platform/events";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import * as repository from "./opportunity.repository";
import { opportunityTwentyColumns } from "./opportunity.service";
import { applyStageChange } from "./opportunity.stage";

/** Au-delà, une affaire découverte par la réconciliation est historique : pas d'événement « créée ». */
const RECENT_CREATION_MS = 7 * 86_400_000;

export interface OpportunityProjection {
  outcome: ProjectionOutcome;
  /** Twenty accepte un contact d'un autre client, pas nous : le lien a été vidé et journalisé. */
  crossCompanyContact: boolean;
}

/**
 * Reflète une affaire de Twenty, maître de ces colonnes : pas de machine à états ici, on enregistre
 * ce qu'il dit, avec l'historique et les événements. Idempotent et insensible à l'ordre.
 */
export async function projectOpportunity(
  db: Database,
  record: CrmOpportunity,
): Promise<OpportunityProjection> {
  return db.transaction(async (tx) => {
    const existing = await repository.findOpportunityByTwentyId(tx, record.id);
    if (existing && isStaleVersion(existing.twentySyncedAt, record.updatedAt)) {
      return { outcome: "skipped", crossCompanyContact: false };
    }

    const company = record.companyId ? await getCompanyRefByTwentyId(tx, record.companyId) : null;
    const unknownCompany = record.companyId !== null && !company;
    let companyId = unknownCompany ? (existing?.companyId ?? null) : (company?.id ?? null);

    if (existing && companyId !== existing.companyId) {
      if (await repository.hasCommercialChildren(tx, existing.id)) {
        // Un devis ou un projet fige le client : clés composites sur des colonnes obligatoires.
        logger.warn("crm.sync.opportunity_move_refused", { opportunityId: existing.id });
        companyId = existing.companyId;
      }
    }

    const contact = record.pointOfContactId
      ? await getContactRefByTwentyId(tx, record.pointOfContactId)
      : null;
    const crossCompanyContact = contact !== null && contact.companyId !== companyId;
    if (crossCompanyContact) {
      logger.warn("crm.sync.cross_company_contact", {
        opportunityTwentyId: record.id,
        contactTwentyId: record.pointOfContactId,
      });
    }
    const contactId = contact && !crossCompanyContact ? contact.id : null;

    const columns = opportunityTwentyColumns(record);
    const at = new Date(record.updatedAt);

    if (!existing) {
      const row = await repository.insertOpportunity(tx, {
        twentyId: record.id,
        companyId,
        contactId,
        stage: record.stage,
        wonAt: record.stage === "WON" ? at : null,
        lostAt: record.stage === "LOST" ? at : null,
        lastActivityAt: at,
        ...columns,
      });
      if (!row) return { outcome: "skipped", crossCompanyContact };
      await repository.insertStageHistory(tx, {
        opportunityId: row.id,
        fromStage: null,
        toStage: record.stage,
        actorId: null,
        at,
      });
      await recordAudit(tx, {
        actorId: null,
        action: "opportunity.created",
        entityType: "opportunity",
        entityId: row.id,
        metadata: { name: row.name, stage: row.stage, via: "twenty" },
      });
      if (record.stage === "WON") await promoteCompanyOnWin(tx, companyId, null);
      if (Date.now() - new Date(record.createdAt).getTime() < RECENT_CREATION_MS) {
        await emitEvent(tx, {
          type: "opportunity.created",
          entityType: "opportunity",
          entityId: row.id,
          companyId,
          payload: { name: row.name, stage: row.stage, amountCents: row.amountCents },
          actorId: null,
          dedupeKey: `opportunity.created:${row.id}`,
        });
      }
      return { outcome: "applied", crossCompanyContact };
    }

    if (companyId !== existing.companyId) {
      await repository.moveOpportunityToCompany(tx, existing.id, companyId, contactId);
    }
    const updated = await repository.updateOpportunityRow(tx, existing.id, {
      ...columns,
      contactId,
    });
    if (updated.stage !== record.stage) {
      await applyStageChange(tx, updated, {
        to: record.stage,
        actorId: null,
        at,
        via: "twenty",
      });
    }
    return { outcome: "applied", crossCompanyContact };
  });
}
