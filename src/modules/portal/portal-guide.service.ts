import { recordAudit } from "@/modules/audit/audit.service";
import type { PortalContext } from "@/server/context";
import { parseInput } from "@/server/validation";
import * as repository from "./portal.repository";
import {
  dismissTipSchema,
  PORTAL_TIP_KEYS,
  type DismissTipInput,
  type PortalTipKey,
} from "./portal.schema";

/** Guide de première visite et conseils de page, propres à chaque compte client. */
export interface PortalGuide {
  /** L'accueil propose le guide. */
  showGuide: boolean;
  dismissedTips: PortalTipKey[];
}

const isTipKey = (value: string): value is PortalTipKey =>
  (PORTAL_TIP_KEYS as readonly string[]).includes(value);

export async function getPortalGuide(ctx: PortalContext): Promise<PortalGuide> {
  const row = await repository.findPreferences(ctx.db, ctx.actor.userId);
  return {
    showGuide: !row?.guideCompletedAt,
    dismissedTips: (row?.dismissedTips ?? []).filter(isTipKey),
  };
}

const AUDIT_TARGET = {
  action: "portal.preferences_updated",
  entityType: "portal_preferences",
} as const;

/** Idempotent : la première date reste, et aucune trace n'est ajoutée si rien ne change. */
export async function completePortalGuide(ctx: PortalContext): Promise<void> {
  const userId = ctx.actor.userId;
  await ctx.db.transaction(async (tx) => {
    const row = await repository.lockPreferences(tx, userId);
    if (row.guideCompletedAt) return;
    await repository.updateGuideState(tx, userId, { guideCompletedAt: new Date() });
    await recordAudit(tx, {
      ...AUDIT_TARGET,
      actorId: userId,
      entityId: userId,
      metadata: { guide: "completed" },
    });
  });
}

export async function dismissPortalTip(
  ctx: PortalContext,
  rawInput: DismissTipInput,
): Promise<void> {
  const { tip } = parseInput(dismissTipSchema, rawInput);
  const userId = ctx.actor.userId;
  await ctx.db.transaction(async (tx) => {
    const row = await repository.lockPreferences(tx, userId);
    if (row.dismissedTips.includes(tip)) return;
    await repository.updateGuideState(tx, userId, { dismissedTips: [...row.dismissedTips, tip] });
    await recordAudit(tx, {
      ...AUDIT_TARGET,
      actorId: userId,
      entityId: userId,
      metadata: { tipDismissed: tip },
    });
  });
}

/** « Revoir le guide » : le guide et tous les conseils repartent. */
export async function restartPortalGuide(ctx: PortalContext): Promise<void> {
  const userId = ctx.actor.userId;
  await ctx.db.transaction(async (tx) => {
    const row = await repository.lockPreferences(tx, userId);
    if (!row.guideCompletedAt && row.dismissedTips.length === 0) return;
    await repository.updateGuideState(tx, userId, { guideCompletedAt: null, dismissedTips: [] });
    await recordAudit(tx, {
      ...AUDIT_TARGET,
      actorId: userId,
      entityId: userId,
      metadata: { guide: "restarted" },
    });
  });
}
