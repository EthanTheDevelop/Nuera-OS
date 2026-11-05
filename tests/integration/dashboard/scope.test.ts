import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDashboard,
  getDashboardNotifications,
  saveDashboardLayout,
} from "@/modules/dashboard/dashboard.service";
import { TILE_CATALOG } from "@/modules/dashboard/dashboard.tiles";
import type { TileView } from "@/modules/dashboard/dashboard.types";
import { hasPermission } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createCompany, createContract } from "../../helpers/factories";

const NOW = new Date("2026-11-15T11:00:00Z");
const INVOICE_REF = "IMPAYE-SECRET-1";
const FINANCE_KEYS = TILE_CATALOG.filter((tile) =>
  tile.permissions.some((permission) => permission.startsWith("finance:")),
).map((tile) => tile.key);

function readyView(state: { status: string } | undefined): TileView {
  if (state?.status !== "ready") throw new Error(`Tuile non prête : ${state?.status}`);
  return (state as unknown as { view: TileView }).view;
}

describe("ce qu'un rôle voit sur le tableau de bord", () => {
  let db: Database;
  let client: Awaited<ReturnType<typeof createTestDatabase>>["client"];
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;

  beforeAll(async () => {
    ({ db, client, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    const company = await createCompany(db, { status: "client", name: "Client Impayé" });
    await db.insert(schema.financialDocuments).values({
      companyId: company.id,
      source: "manual",
      externalRef: INVOICE_REF,
      issuedOn: "2026-09-01",
      dueOn: "2026-10-01",
      amountCents: 7_654_300,
    });
    const interventionOn = async (
      status: schema.Contract["status"],
      title: string,
      archived = false,
    ) => {
      const contract = await createContract(db, {
        companyId: company.id,
        status,
        archivedAt: archived ? NOW : null,
      });
      await db.insert(schema.maintenanceInterventions).values({
        contractId: contract.id,
        companyId: company.id,
        title,
        plannedOn: "2026-11-17",
      });
    };
    await interventionOn("active", "Intervention à mener");
    await interventionOn("terminated", "Intervention contrat résilié");
    await interventionOn("active", "Intervention contrat archivé", true);
  });
  afterAll(() => close());

  it.each(["member", "viewer"] as const)(
    "%s : aucun chiffre des finances, même avec une disposition d'un ancien rôle",
    async (role) => {
      const ctx = role === "member" ? member : viewer;
      expect(hasPermission(role, "finance:read")).toBe(false);
      await db.insert(schema.userPreferences).values({
        userId: ctx.actor.userId,
        dashboardLayout: { tiles: FINANCE_KEYS.map((key) => ({ key, size: "2x2" })) },
      });
      const data = await getDashboard(ctx, { now: NOW, editing: true });
      expect(data.layout.tiles).toEqual([]);
      for (const key of FINANCE_KEYS) {
        expect(data.gallery.map((tile) => tile.key)).not.toContain(key);
        expect(data.tiles[key], key).toBeUndefined();
      }
      const everything = JSON.stringify(data);
      expect(everything).not.toContain(INVOICE_REF);
      expect(everything).not.toMatch(/76\s*543/);
      await db.delete(schema.userPreferences);

      await expect(
        saveDashboardLayout(ctx, { tiles: [{ key: "revenue", size: "2x2" }] }),
      ).rejects.toThrow(/pas accessible/);

      const alerts = readyView((await getDashboard(ctx, { now: NOW })).tiles.alerts);
      expect(JSON.stringify(alerts)).not.toContain(INVOICE_REF);
    },
  );

  it("l'associé voit bien l'impayé : le test précédent n'est pas vide de sens", async () => {
    const alerts = readyView((await getDashboard(admin, { now: NOW })).tiles.alerts);
    expect(JSON.stringify(alerts)).toContain(INVOICE_REF);
    expect(JSON.stringify(alerts)).toMatch(/76\s*543/);
  });

  it("une intervention à venir ne vaut que sur un contrat vivant", async () => {
    const priorities = readyView((await getDashboard(admin, { now: NOW })).tiles.priorities);
    const labels = priorities.rows?.map((row) => row.label) ?? [];
    expect(labels).toContain("Intervention à mener");
    expect(labels).not.toContain("Intervention contrat résilié");
    expect(labels).not.toContain("Intervention contrat archivé");
  });

  it("un état vide ne propose pas une action que le rôle ne peut pas faire", async () => {
    const asAdmin = (await getDashboard(admin, { now: NOW })).tiles;
    expect(readyView(asAdmin.pipeline).empty?.actionHref).toBe("/pipeline?nouvelle=NEW");
    expect(readyView(asAdmin.appointments).empty?.actionHref).toBe("/messages/rendez-vous");

    const asViewer = (await getDashboard(viewer, { now: NOW })).tiles;
    expect(readyView(asViewer.pipeline).empty?.title).toBeDefined();
    expect(readyView(asViewer.pipeline).empty?.actionHref).toBeUndefined();
    expect(readyView(asViewer.appointments).empty?.actionHref).toBeUndefined();
  });

  it("une cloche en panne ne fait pas tomber la page", async () => {
    await client.exec("alter table notifications rename to notifications_hs");
    try {
      await expect(getDashboardNotifications(admin)).resolves.toBeNull();
    } finally {
      await client.exec("alter table notifications_hs rename to notifications");
    }
    await expect(getDashboardNotifications(admin)).resolves.toMatchObject({ unread: 0 });
  });
});
