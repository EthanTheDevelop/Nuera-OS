import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCatalogItem,
  getCatalogItem,
  listActiveCatalogItems,
  listCatalogItems,
  setCatalogItemActive,
  updateCatalogItem,
} from "@/modules/catalog/catalog.service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { auditLog } from "@/server/db/schema";
import { createTestDatabase } from "../../helpers/db";
import { createFixture, type Fixture } from "./helpers";

const ITEM = {
  kind: "project",
  activity: "vitrine",
  name: "Vitrine de test",
  priceCents: 650_000,
  estimatedCostCents: 240_000,
  estimatedMinutes: 5040,
  scope: "5 pages",
  exclusions: "photos",
  conditions: "2 retours",
  validityDays: 30,
  depositPercent: 30,
};

describe("catalogue", () => {
  let close: () => Promise<void>;
  let fixture: Fixture;

  beforeAll(async () => {
    const database = await createTestDatabase();
    close = database.close;
    fixture = await createFixture(database.db);
  });
  afterAll(() => close());

  it("crée une prestation, journalisée, et la relit", async () => {
    const item = await createCatalogItem(fixture.admin, ITEM);
    expect(item).toMatchObject({ name: "Vitrine de test", priceCents: 650_000, active: true });
    expect(await getCatalogItem(fixture.viewer, item.id)).toMatchObject({ id: item.id });

    const audit = await fixture.db.select().from(auditLog);
    expect(audit.some((row) => row.action === "catalog_item.created")).toBe(true);
  });

  it("accepte les valeurs d'un formulaire et refuse un acompte hors bornes", async () => {
    const item = await createCatalogItem(fixture.admin, {
      ...ITEM,
      name: "Depuis un formulaire",
      priceCents: "120000",
      estimatedCostCents: "50000",
      estimatedMinutes: "60",
      validityDays: "",
      depositPercent: "",
      scope: "",
    });
    expect(item).toMatchObject({ priceCents: 120_000, validityDays: null, depositPercent: null });
    expect(item.scope).toBeNull();

    await expect(
      createCatalogItem(fixture.admin, { ...ITEM, depositPercent: 120 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCatalogItem(fixture.admin, { ...ITEM, priceCents: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("réserve la gestion à un associé, ouvre la lecture à member et viewer", async () => {
    await expect(createCatalogItem(fixture.member, ITEM)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCatalogItem(fixture.viewer, ITEM)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalogItems(fixture.contractor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalogItems(fixture.client)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalogItems(fixture.member)).resolves.toBeDefined();
    await expect(listCatalogItems(fixture.viewer)).resolves.toBeDefined();
  });

  it("modifie une prestation, 404 sur un identifiant inconnu ou mal formé", async () => {
    const item = await createCatalogItem(fixture.admin, { ...ITEM, name: "À modifier" });
    const updated = await updateCatalogItem(fixture.admin, item.id, {
      ...ITEM,
      name: "Modifiée",
      priceCents: 700_000,
    });
    expect(updated).toMatchObject({ name: "Modifiée", priceCents: 700_000 });

    await expect(
      updateCatalogItem(fixture.admin, "9f2b6a0e-0000-4000-8000-000000000000", ITEM),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCatalogItem(fixture.admin, "pas-un-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("retire de la vente sans supprimer, de façon idempotente", async () => {
    const item = await createCatalogItem(fixture.admin, { ...ITEM, name: "À retirer" });
    await setCatalogItemActive(fixture.admin, item.id, false);
    const countAudit = async () =>
      (await fixture.db.select().from(auditLog)).filter(
        (row) => row.action === "catalog_item.deactivated" && row.entityId === item.id,
      ).length;
    expect(await countAudit()).toBe(1);

    // Répéter ne journalise pas une seconde fois.
    await setCatalogItemActive(fixture.admin, item.id, false);
    expect(await countAudit()).toBe(1);

    const options = await listActiveCatalogItems(fixture.member);
    expect(options.some((option) => option.id === item.id)).toBe(false);

    const retired = await listCatalogItems(fixture.member, { state: "inactive" });
    expect(retired.items.some((row) => row.id === item.id)).toBe(true);
    await expect(setCatalogItemActive(fixture.member, item.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("pagine et filtre côté serveur sur plusieurs centaines de lignes", async () => {
    for (let index = 0; index < 120; index += 1) {
      await createCatalogItem(fixture.admin, {
        ...ITEM,
        kind: "option",
        name: `Option ${String(index).padStart(3, "0")}`,
      });
    }
    const first = await listCatalogItems(fixture.viewer, { kind: "option", pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(120);
    const last = await listCatalogItems(fixture.viewer, { kind: "option", pageSize: 50, page: 3 });
    expect(last.items).toHaveLength(20);

    const found = await listCatalogItems(fixture.viewer, { search: "Option 007" });
    expect(found.items.map((row) => row.name)).toEqual(["Option 007"]);
    const wildcard = await listCatalogItems(fixture.viewer, { search: "%" });
    expect(wildcard.total).toBe(0);
  });
});
