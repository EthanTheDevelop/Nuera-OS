import type { OpportunityStage } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { promoteCompanyOnWin } from "@/modules/crm/company.service";
import { emitEvent } from "@/modules/platform/events";
import type { opportunities, Opportunity } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { isOpportunityClosed } from "./opportunity.status";
import { insertStageHistory, updateOpportunityRow } from "./opportunity.repository";

/**
 * Effets d'un changement d'étape : colonnes de clôture, historique, audit, événements, conversion
 * du client. Un seul chemin, qu'il vienne d'un utilisateur, d'un devis ou de Twenty. Les règles de
 * transition restent à l'appelant : Twenty étant maître, sa projection enregistre ce qu'il dit.
 */
export interface StageChange {
  to: OpportunityStage;
  actorId: string | null;
  at?: Date;
  lostReason?: string | null;
  /** Clôture venue d'un devis accepté : la clé rend l'événement unique par devis. */
  quoteId?: string;
  via: "user" | "quote" | "twenty";
  /** Colonnes (T) relues dans Twenty, à écrire avec l'étape. */
  columns?: Partial<typeof opportunities.$inferInsert>;
}

export async function applyStageChange(
  tx: Database,
  current: Opportunity,
  change: StageChange,
): Promise<Opportunity> {
  const from = current.stage;
  const { to, actorId, via } = change;
  const at = change.at ?? new Date();

  const lostReason = to === "LOST" ? (change.lostReason ?? current.lostReason ?? null) : null;
  const row = await updateOpportunityRow(tx, current.id, {
    ...change.columns,
    stage: to,
    wonAt: to === "WON" ? (current.wonAt ?? at) : null,
    lostAt: to === "LOST" ? (current.lostAt ?? at) : null,
    lostReason,
    lastActivityAt: at,
  });

  const historyId = await insertStageHistory(tx, {
    opportunityId: current.id,
    fromStage: from,
    toStage: to,
    actorId,
    at,
  });

  const reopened = isOpportunityClosed(from) && !isOpportunityClosed(to);
  await recordAudit(tx, {
    actorId,
    action: reopened ? "opportunity.reopened" : "opportunity.stage_changed",
    entityType: "opportunity",
    entityId: current.id,
    metadata: { from, to, via, companyId: current.companyId },
  });
  await emitEvent(tx, {
    type: "opportunity.stage_changed",
    entityType: "opportunity",
    entityId: current.id,
    companyId: row.companyId,
    payload: { fromStage: from, toStage: to },
    actorId,
    dedupeKey: `opportunity.stage_changed:${historyId}`,
    occurredAt: at,
  });

  if (to === "WON") {
    await recordAudit(tx, {
      actorId,
      action: "opportunity.won",
      entityType: "opportunity",
      entityId: current.id,
      metadata: { amountCents: row.amountCents, quoteId: change.quoteId ?? null, via },
    });
    await emitEvent(tx, {
      type: "opportunity.won",
      entityType: "opportunity",
      entityId: current.id,
      companyId: row.companyId,
      payload: { amountCents: row.amountCents },
      actorId,
      // Après une réouverture, gagner à nouveau émet un nouvel événement ; un même devis, non.
      dedupeKey: change.quoteId
        ? `opportunity.won:${current.id}:${change.quoteId}`
        : `opportunity.won:${historyId}`,
      occurredAt: at,
    });
    await promoteCompanyOnWin(tx, row.companyId, actorId);
  }

  if (to === "LOST") {
    await recordAudit(tx, {
      actorId,
      action: "opportunity.lost",
      entityType: "opportunity",
      entityId: current.id,
      metadata: { lostReason, via },
    });
    await emitEvent(tx, {
      type: "opportunity.lost",
      entityType: "opportunity",
      entityId: current.id,
      companyId: row.companyId,
      payload: { lostReason: lostReason ?? "Non renseigné" },
      actorId,
      dedupeKey: `opportunity.lost:${historyId}`,
      occurredAt: at,
    });
  }

  return row;
}
