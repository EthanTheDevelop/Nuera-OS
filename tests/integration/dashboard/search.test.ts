import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { likePattern } from "@/modules/dashboard/search.repository";
import { globalSearch, type SearchGroup } from "@/modules/dashboard/search.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createContract,
  createDocument,
  createMemberContext,
  createOpportunity,
  createProject,
  createQuote,
  createSite,
  createTask,
  createTicket,
} from "../../helpers/factories";

const labels = (groups: SearchGroup[], group: string) =>
  groups.find((entry) => entry.label === group)?.items.map((item) => item.label) ?? [];

describe("recherche globale", () => {
  let db: Database;
  let client: Awaited<ReturnType<typeof createTestDatabase>>["client"];
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let contractor: Awaited<ReturnType<typeof createMemberContext>>;

  beforeAll(async () => {
    ({ db, client, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    contractor = await createMemberContext(db, "contractor");

    const company = await createCompany(db, { name: "Zéphyr Atelier" });
    await createContact(db, { companyId: company.id, firstName: "Zélie", lastName: "Zéphyr" });
    await createOpportunity(db, { companyId: company.id, name: "Zéphyr refonte" });
    await createQuote(db, { companyId: company.id, title: "Zéphyr devis" });
    const mine = await createProject(db, { companyId: company.id, name: "Zéphyr vitrine" });
    const other = await createProject(db, { companyId: company.id, name: "Zéphyr boutique" });
    await db.insert(schema.projectMembers).values({
      projectId: mine.id,
      memberId: contractor.member.id,
    });
    await createTask(db, {
      projectId: mine.id,
      title: "Zéphyr tâche confiée",
      assigneeMemberId: contractor.member.id,
    });
    await createTask(db, { projectId: mine.id, title: "Zéphyr tâche d'un autre" });
    await createTask(db, { projectId: other.id, title: "Zéphyr tâche ailleurs" });
    await createSite(db, { companyId: company.id, name: "Zéphyr site" });
    await createContract(db, { companyId: company.id, name: "Zéphyr contrat" });
    await createTicket(db, {
      companyId: company.id,
      subject: "Zéphyr demande confiée",
      assigneeMemberId: contractor.member.id,
    });
    await createTicket(db, { companyId: company.id, subject: "Zéphyr demande autre" });
    await createDocument(db, {
      companyId: company.id,
      projectId: mine.id,
      title: "Zephyr brief",
      kind: "brief",
    });
    await createDocument(db, {
      companyId: company.id,
      title: "Zephyr facture",
      kind: "invoice",
    });
    await createCompany(db, { name: "Archivé Zéphyr", archivedAt: new Date() });
  });
  afterAll(() => close());

  it("cherche dans toutes les sources pour un associé", async () => {
    const groups = await globalSearch(admin, "zéphyr");
    expect(groups.map((group) => group.label)).toEqual([
      "Clients",
      "Contacts",
      "Affaires",
      "Devis",
      "Projets",
      "Tâches",
      "Sites",
      "Contrats",
      "Demandes",
      "Documents",
    ]);
    expect(labels(groups, "Clients")).toEqual(["Zéphyr Atelier"]);
    const link = groups.find((group) => group.label === "Tâches")?.items[0]?.href;
    expect(link).toMatch(/^\/projets\/[\w-]+\?tache=[\w-]+$/);
    const documents = await globalSearch(admin, "zephyr");
    expect(labels(documents, "Documents")).toEqual(
      expect.arrayContaining(["Zephyr brief", "Zephyr facture"]),
    );
  });

  it("ignore les accents et la casse, comme une saisie rapide", async () => {
    const groups = await globalSearch(admin, "ZEPHYR atelier");
    expect(labels(groups, "Clients")).toEqual(["Zéphyr Atelier"]);
  });

  it("une facture n'apparaît pas sans finance:read", async () => {
    for (const ctx of [member, viewer]) {
      const groups = await globalSearch(ctx, "zephyr");
      expect(labels(groups, "Documents")).toEqual(["Zephyr brief"]);
    }
  });

  it("le prestataire ne voit que son périmètre, et ni clients ni contrats", async () => {
    const groups = await globalSearch(contractor, "zéphyr");
    expect(groups.map((group) => group.label)).toEqual([
      "Projets",
      "Tâches",
      "Demandes",
      "Documents",
    ]);
    expect(labels(groups, "Projets")).toEqual(["Zéphyr vitrine"]);
    expect(labels(groups, "Tâches")).toEqual(["Zéphyr tâche confiée"]);
    expect(labels(groups, "Demandes")[0]).toContain("Zéphyr demande confiée");
    expect(labels(groups, "Demandes")).toHaveLength(1);
    const documents = await globalSearch(contractor, "zephyr");
    expect(labels(documents, "Documents")).toEqual(["Zephyr brief"]);
  });

  it("un prestataire sans fiche ne voit rien", async () => {
    const orphan = await createTestContext(db, "contractor");
    expect(await globalSearch(orphan, "zéphyr")).toEqual([]);
  });

  it("% et _ sont des caractères, pas des jokers", async () => {
    expect(likePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
    expect(await globalSearch(admin, "%%")).toEqual([]);
    expect(await globalSearch(admin, "__")).toEqual([]);
    await createCompany(db, { name: "Remise 50%_ spéciale" });
    const groups = await globalSearch(admin, "50%_");
    expect(labels(groups, "Clients")).toEqual(["Remise 50%_ spéciale"]);
  });

  it("ignore une saisie trop courte, plafonne chaque source", async () => {
    expect(await globalSearch(admin, "z")).toEqual([]);
    expect(await globalSearch(admin, "   ")).toEqual([]);
    for (let index = 0; index < 8; index += 1) {
      await createCompany(db, { name: `Lotplafond ${index}` });
    }
    const groups = await globalSearch(admin, "lotplafond");
    expect(labels(groups, "Clients")).toHaveLength(5);
  });

  it("reste rapide sur plusieurs centaines de lignes", async () => {
    await db.insert(schema.companies).values(
      Array.from({ length: 600 }, (_, index) => ({
        twentyId: `bulk-${index}`,
        name: `Volumineux ${index}`,
      })),
    );
    const started = performance.now();
    const groups = await globalSearch(admin, "volumineux");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(labels(groups, "Clients")).toHaveLength(5);
  });

  it("une source qui échoue n'efface pas les autres", async () => {
    await client.exec("alter table sites rename to sites_hs");
    try {
      const groups = await globalSearch(admin, "zéphyr");
      expect(labels(groups, "Sites")).toEqual([]);
      expect(labels(groups, "Clients")).toEqual(["Zéphyr Atelier"]);
    } finally {
      await client.exec("alter table sites_hs rename to sites");
    }
  });
});
