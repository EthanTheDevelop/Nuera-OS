import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completePortalGuide,
  dismissPortalTip,
  getPortalGuide,
  restartPortalGuide,
} from "@/modules/portal/portal-guide.service";
import { getPortalPreferences } from "@/modules/portal/portal.service";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ValidationError } from "@/server/errors";
import { createPortalTestContext } from "../../helpers/factories";
import { createTestDatabase } from "../../helpers/db";

describe("guide du portail", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  const auditCount = async (userId: string) =>
    (await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, userId))).length;

  it("se propose à un compte neuf, sans créer de ligne à la lecture", async () => {
    const ctx = await createPortalTestContext(db);
    expect(await getPortalGuide(ctx)).toEqual({ showGuide: true, dismissedTips: [] });
    const rows = await db
      .select()
      .from(schema.portalPreferences)
      .where(eq(schema.portalPreferences.userId, ctx.actor.userId));
    expect(rows).toHaveLength(0);
  });

  it("reste propre à chaque compte, même dans la même entreprise", async () => {
    const first = await createPortalTestContext(db);
    const other = await createPortalTestContext(db);
    await completePortalGuide(first);
    await dismissPortalTip(first, { tip: "messages" });
    expect(await getPortalGuide(first)).toEqual({ showGuide: false, dismissedTips: ["messages"] });
    expect(await getPortalGuide(other)).toEqual({ showGuide: true, dismissedTips: [] });
  });

  it("garde la première date et une seule trace quand on termine deux fois", async () => {
    const ctx = await createPortalTestContext(db);
    await completePortalGuide(ctx);
    const [before] = await db
      .select()
      .from(schema.portalPreferences)
      .where(eq(schema.portalPreferences.userId, ctx.actor.userId));
    const audits = await auditCount(ctx.actor.userId);
    await completePortalGuide(ctx);
    const [after] = await db
      .select()
      .from(schema.portalPreferences)
      .where(eq(schema.portalPreferences.userId, ctx.actor.userId));
    expect(after?.guideCompletedAt).toEqual(before?.guideCompletedAt);
    expect(await auditCount(ctx.actor.userId)).toBe(audits);
  });

  it("ne double pas un conseil fermé deux fois", async () => {
    const ctx = await createPortalTestContext(db);
    await dismissPortalTip(ctx, { tip: "documents" });
    const audits = await auditCount(ctx.actor.userId);
    await dismissPortalTip(ctx, { tip: "documents" });
    await dismissPortalTip(ctx, { tip: "demandes" });
    expect((await getPortalGuide(ctx)).dismissedTips).toEqual(["documents", "demandes"]);
    expect(await auditCount(ctx.actor.userId)).toBe(audits + 1);
  });

  it("refuse un conseil inconnu", async () => {
    const ctx = await createPortalTestContext(db);
    for (const tip of ["inconnu", "constructor", ""]) {
      await expect(dismissPortalTip(ctx, { tip } as never)).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await getPortalGuide(ctx)).dismissedTips).toEqual([]);
  });

  it("repart de zéro avec « Revoir le guide », sans toucher aux notifications", async () => {
    const ctx = await createPortalTestContext(db);
    await completePortalGuide(ctx);
    await dismissPortalTip(ctx, { tip: "mon-site" });
    await restartPortalGuide(ctx);
    expect(await getPortalGuide(ctx)).toEqual({ showGuide: true, dismissedTips: [] });
    const audits = await auditCount(ctx.actor.userId);
    await restartPortalGuide(ctx);
    expect(await auditCount(ctx.actor.userId)).toBe(audits);
    expect(Object.keys(await getPortalPreferences(db, ctx.actor.userId))).not.toContain(
      "dismissedTips",
    );
  });
});
