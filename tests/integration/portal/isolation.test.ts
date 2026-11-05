import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDocumentReadable,
  listDocumentsForPortal,
  openDocumentDownload,
} from "@/modules/documents/document.service";
import { sendPortalMessage } from "@/modules/messaging/message.service";
import { getProjectForPortal } from "@/modules/projects/project.portal";
import {
  assertPortalProject,
  getPortalAppointment,
  getPortalDocumentsPage,
  getPortalHome,
  getPortalSitePage,
  loadProjectHome,
  requestSiteChange,
  submitDeliverableReview,
  submitRequirementDocument,
  submitRequirementText,
} from "@/modules/portal/portal.service";
import { getProjectPaymentsForPortal } from "@/modules/finance/finance.portal";
import { listSitesForPortal } from "@/modules/sites/site.portal";
import {
  addPortalTicketMessage,
  createTicketFromPortal,
  getTicketForPortal,
  listTicketsForPortal,
} from "@/modules/support/ticket.service";
import { deliverables, messages } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { NotFoundError } from "@/server/errors";
import { createTestDatabase } from "../../helpers/db";
import { createClientWorld, INTERNAL, type ClientWorld } from "./helpers";

let db: Database;
let close: () => Promise<void>;
let a: ClientWorld;
let b: ClientWorld;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  a = await createClientWorld(db, "Alpha");
  b = await createClientWorld(db, "Beta");
});
afterAll(async () => close());

const dump = (value: unknown) => JSON.stringify(value);

function expectNothingInternal(json: string) {
  for (const marker of Object.values(INTERNAL)) expect(json).not.toContain(marker);
  expect(json).not.toMatch(/hourlyCost|dayRate|estimatedCost|marginCents|consumedCents/);
}

describe("client A face aux objets du client B : 404 partout", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["projet", () => getProjectForPortal(a.ctx, b.project.id)],
    ["projet, garde du sélecteur", () => assertPortalProject(a.ctx, b.project.id)],
    ["écran C3", () => loadProjectHome(a.ctx, b.project.id)],
    [
      "validation de livrable",
      () =>
        submitDeliverableReview(a.ctx, {
          deliverableId: b.deliverable.id,
          decision: "validated",
        }),
    ],
    [
      "retours sur un livrable",
      () =>
        submitDeliverableReview(a.ctx, {
          deliverableId: b.deliverable.id,
          decision: "changes_requested",
          comment: "non",
        }),
    ],
    [
      "contenu attendu par fichier",
      () =>
        submitRequirementDocument(a.ctx, {
          requirementId: b.requirement.id,
          documentId: a.sharedDocument.id,
        }),
    ],
    [
      "document de B rattaché à un contenu de A",
      () =>
        submitRequirementDocument(a.ctx, {
          requirementId: a.requirement.id,
          documentId: b.sharedDocument.id,
        }),
    ],
    [
      "contenu attendu par écrit",
      () => submitRequirementText(a.ctx, { requirementId: b.requirement.id, text: "Texte" }),
    ],
    ["document par identifiant", () => assertDocumentReadable(a.ctx, b.sharedDocument.id)],
    ["fichier par identifiant", () => openDocumentDownload(a.ctx, b.sharedDocument.id)],
    [
      "pièce jointe d'un message",
      () => sendPortalMessage(a.ctx, { body: "voir", documentId: b.sharedDocument.id }),
    ],
    ["demande", () => getTicketForPortal(a.ctx, b.ticket.id)],
    [
      "réponse à une demande",
      () => addPortalTicketMessage(a.ctx, { ticketId: b.ticket.id, body: "bonjour" }),
    ],
    [
      "demande sur le site de B",
      () => createTicketFromPortal(a.ctx, { subject: "Panne", siteId: b.site.id }),
    ],
    [
      "changement sur le site de B",
      () =>
        requestSiteChange(a.ctx, {
          siteId: b.site.id,
          current: "Horaires du dimanche",
          next: "Ouvert le dimanche",
        }),
    ],
    ["rendez-vous", () => getPortalAppointment(a.ctx, b.appointment.id)],
  ];

  it.each(cases)("%s", async (_label, read) => {
    await expect(read()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("aucune de ces tentatives n'a modifié B", async () => {
    const [row] = await db.select().from(deliverables).where(eq(deliverables.id, b.deliverable.id));
    expect(row?.status).toBe("to_validate");
    const home = await loadProjectHome(b.ctx, b.project.id);
    expect(home.project.requirements[0]?.status).toBe("expected");
  });

  it("une écriture refusée n'envoie aucun message", async () => {
    const rows = await db.select().from(messages).where(eq(messages.companyId, a.ctx.companyId));
    expect(rows.filter((row) => row.direction === "inbound")).toHaveLength(0);
  });

  it("un identifiant de B dans le sélecteur retombe sur un projet de A", async () => {
    const home = await getPortalHome(a.ctx, { selectedProjectId: b.project.id });
    expect(home.home?.project.id).toBe(a.project.id);
  });

  it("un site de B demandé dans l'URL retombe sur un site de A", async () => {
    const page = await getPortalSitePage(a.ctx, b.site.id);
    expect(page.site?.id).toBe(a.site.id);
    expect(dump(page)).not.toContain(b.site.name);
  });

  it("les paiements filtrent sur le client, même avec un projet de B", async () => {
    const payments = await getProjectPaymentsForPortal(a.ctx, b.project.id, { soldCents: null });
    expect(payments.paidCents).toBe(0);
    expect(payments.items).toEqual([]);
  });
});

describe("rien d'interne ne sort, ni d'un autre client", () => {
  it("écran C3 et capsule", async () => {
    const home = await getPortalHome(a.ctx);
    const json = dump(home);
    expectNothingInternal(json);
    expect(json).not.toContain(b.companyName);
    expect(json).not.toContain("Projet Beta");
    expect(json).not.toContain('"blocked"');
    expect(home.home?.project.interlocutors.map((row) => row.fullName)).toEqual([
      "Responsable Alpha",
    ]);
  });

  it("un jalon non visible et un brouillon n'existent pas", async () => {
    const home = await loadProjectHome(a.ctx, a.project.id);
    expect(home.project.phases.map((phase) => phase.name)).toEqual(["On démarre"]);
    expect(home.deliverables.map((item) => item.title)).toEqual(["Maquette Alpha"]);
  });

  it("un document interne lié à un livrable n'est pas donné au client", async () => {
    await db
      .update(deliverables)
      .set({ documentId: a.internalDocument.id })
      .where(eq(deliverables.id, a.deliverable.id));
    const home = await loadProjectHome(a.ctx, a.project.id);
    expect(home.deliverables[0]?.document).toBeNull();
    await db
      .update(deliverables)
      .set({ documentId: a.sharedDocument.id })
      .where(eq(deliverables.id, a.deliverable.id));
  });

  it("documents et factures", async () => {
    const page = await getPortalDocumentsPage(a.ctx, { filter: "tous" });
    const json = dump(page);
    expectNothingInternal(json);
    expect(json).not.toContain("F-Beta");
    expect(page.invoices.map((row) => row.label)).toEqual(["Projet Alpha"]);
    await expect(assertDocumentReadable(a.ctx, a.internalDocument.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("le filtre « Vos fichiers » ne rend que les dépôts du client", async () => {
    const list = await listDocumentsForPortal(a.ctx, { uploadedByClient: true });
    expect(list.total).toBe(0);
  });

  it("sites : aucune donnée d'infrastructure", async () => {
    const [site] = await listSitesForPortal(a.ctx);
    expect(Object.keys(site ?? {}).sort()).toEqual(
      ["id", "liveOn", "name", "primaryDomain", "projectId", "status", "url"].sort(),
    );
  });

  it("demandes : pas de message interne, pas de demande de B", async () => {
    const detail = await getTicketForPortal(a.ctx, a.ticket.id);
    expectNothingInternal(dump(detail));
    const list = await listTicketsForPortal(a.ctx);
    expect(list.map((row) => row.id)).toEqual([a.ticket.id]);
  });
});

describe("règles du client", () => {
  it("des retours sans commentaire sont refusés", async () => {
    await expect(
      submitDeliverableReview(a.ctx, {
        deliverableId: a.deliverable.id,
        decision: "changes_requested",
        comment: "  ",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("valider deux fois garde une seule décision", async () => {
    const first = await submitDeliverableReview(a.ctx, {
      deliverableId: a.deliverable.id,
      decision: "validated",
    });
    const second = await submitDeliverableReview(a.ctx, {
      deliverableId: a.deliverable.id,
      decision: "validated",
    });
    expect(first.overIncludedRounds).toBe(false);
    expect(second.overIncludedRounds).toBe(false);
    const home = await loadProjectHome(a.ctx, a.project.id);
    expect(home.deliverables[0]?.status).toBe("validated");
    expect(home.deliverables[0]?.decidedAt).not.toBeNull();
  });

  it("un contenu transmis par écrit passe à reçu et arrive dans la conversation", async () => {
    await submitRequirementText(a.ctx, {
      requirementId: a.requirement.id,
      text: "Ouvert du mardi au samedi",
    });
    const home = await loadProjectHome(a.ctx, a.project.id);
    expect(home.project.requirements[0]?.status).toBe("received");
    const rows = await db.select().from(messages).where(eq(messages.companyId, a.ctx.companyId));
    const inbound = rows.filter((row) => row.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.body).toContain("Photos Alpha");
    expect(inbound[0]?.body).toContain("Ouvert du mardi au samedi");
  });

  it("un changement de site devient une demande « évolution » reçue, sans doublon", async () => {
    const input = {
      siteId: a.site.id,
      current: "Horaires du dimanche",
      next: "Ouvert le dimanche",
    };
    const first = await requestSiteChange(a.ctx, input);
    const second = await requestSiteChange(a.ctx, input);
    expect(second.id).toBe(first.id);
    const detail = await getTicketForPortal(a.ctx, first.id);
    expect(detail.category).toBe("change");
    expect(detail.status).toBe("received");
    expect(detail.description).toContain("Ouvert le dimanche");
  });

  it("le prochain rendez-vous est le plus proche à venir", async () => {
    const home = await loadProjectHome(a.ctx, a.project.id, new Date("2099-01-01T00:00:00Z"));
    expect(home.nextAppointment?.title).toBe("Rendez-vous Alpha");
    const later = await loadProjectHome(a.ctx, a.project.id, new Date("2099-02-01T00:00:00Z"));
    expect(later.nextAppointment).toBeNull();
  });

  it("paiements : réglé, total vendu, reste à régler", async () => {
    const home = await loadProjectHome(a.ctx, a.project.id);
    expect(home.payments).toMatchObject({
      paidCents: 117_000,
      totalCents: 780_000,
      remainingCents: 663_000,
    });
  });

  it("un compte sans projet a un état vide, sans erreur", async () => {
    const { createPortalTestContext } = await import("../../helpers/factories");
    const lone = await createPortalTestContext(db);
    const home = await getPortalHome(lone);
    expect(home.home).toBeNull();
    expect(home.nextAction).toBeNull();
    expect(home.projects).toEqual([]);
  });
});
