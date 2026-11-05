import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDocumentReadable,
  listDocumentsForCompany,
  listDocumentsForPortal,
  openDocumentDownload,
  uploadClientFile,
  uploadDocument,
} from "@/modules/documents/document.service";
import {
  getConversation,
  listConversations,
  listMessages,
  sendPortalMessage,
} from "@/modules/messaging/message.service";
import { dispatchPendingEvents } from "@/modules/platform/automation.service";
import { revokePortalAccess } from "@/modules/portal/portal-access.service";
import { openPortalArchive } from "@/modules/portal/portal-archive";
import {
  getPortalDocumentsPage,
  getPortalHome,
  openPortalTicket,
  submitDeliverableReview,
} from "@/modules/portal/portal.service";
import { getProjectForPortal } from "@/modules/projects/project.portal";
import {
  createDeliverable,
  createRequirement,
  submitDeliverable,
} from "@/modules/projects/production.service";
import { markRequirementReceived } from "@/modules/projects/production.service";
import { changeProjectStatus, getProjectDetail } from "@/modules/projects/project.service";
import {
  addPortalTicketMessage,
  addTicketMessage,
  getTicketDetail,
  getTicketForPortal,
  listTickets,
  listTicketsForPortal,
} from "@/modules/support/ticket.service";
import { resolvePortalContext } from "@/server/auth/portal-context";
import type { PortalContext } from "@/server/context";
import type * as s from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createPortalClient } from "../helpers/factories";
import { createTempStorage, pdfWith, readAll, streamOf } from "../integration/documents/helpers";
import { createJourneyWorld, notificationsOf, sellProject, type JourneyWorld } from "./world";

describe("parcours 6 : client connecté → validation et support → agence, sans accès croisé", () => {
  let world: JourneyWorld;
  let storage: Awaited<ReturnType<typeof createTempStorage>>;
  let alpha: { ctx: PortalContext; project: s.Project; company: s.Company; userId: string };
  let beta: { ctx: PortalContext; project: s.Project; company: s.Company; userId: string };
  let deliverableId: string;
  let ticketId: string;
  let clientFileId: string;
  let internalFileId: string;
  let sharedFileId: string;

  const deps = () => ({ storage: storage.storage, maxBytes: 1024 * 1024 });

  /** Le vrai contexte du portail, résolu depuis `portal_memberships` comme à chaque requête. */
  async function connect(name: string) {
    const sold = await sellProject(world, name);
    const client = await createPortalClient(world.db, {
      company: sold.company,
      contact: undefined,
    });
    const ctx = await resolvePortalContext(world.db, client.actor);
    return { ctx, project: sold.project, company: sold.company, userId: client.actor.userId };
  }

  beforeAll(async () => {
    world = await createJourneyWorld();
    storage = await createTempStorage();
    alpha = await connect("Alpha Parcours");
    beta = await connect("Beta Parcours");
    await changeProjectStatus(world.member, { projectId: alpha.project.id, status: "active" });
    await changeProjectStatus(world.member, { projectId: beta.project.id, status: "active" });

    const deliverable = await createDeliverable(world.member, {
      projectId: alpha.project.id,
      title: "Maquette Alpha",
      requiresClientValidation: true,
      feedbackRoundsIncluded: 1,
    });
    deliverableId = deliverable.id;
    await submitDeliverable(world.member, { deliverableId });
  });
  afterAll(async () => {
    await storage.cleanup();
    await world.close();
  });

  it("une validation du client se lit côté agence", async () => {
    const { member, admin, db } = world;
    const home = await getPortalHome(alpha.ctx, { selectedProjectId: alpha.project.id });
    expect(home.home?.deliverables.map((row) => row.id)).toContain(deliverableId);

    await submitDeliverableReview(alpha.ctx, {
      deliverableId,
      decision: "validated",
      seen: { projectId: alpha.project.id, version: 1 },
    });

    const seen = (await getProjectDetail(member, alpha.project.id)).deliverables.find(
      (row) => row.id === deliverableId,
    );
    expect(seen?.status).toBe("validated");
    expect(seen?.reviews[0]).toMatchObject({ decision: "validated" });

    await dispatchPendingEvents(db);
    const notified = (await notificationsOf(db, admin.actor.userId)).filter(
      (row) => row.entityId === deliverableId && row.title.includes("validé"),
    );
    expect(notified).toHaveLength(1);
  });

  it("une demande du client se lit côté agence, et la réponse lui revient sans la note interne", async () => {
    const { member, admin, db } = world;
    const opened = await openPortalTicket(alpha.ctx, {
      subject: "Le formulaire ne part plus",
      description: "Depuis ce matin.",
      category: "bug",
    });
    ticketId = opened.id;

    const listed = await listTickets(member, { client: alpha.company.id });
    expect(listed.items.map((row) => row.id)).toContain(ticketId);
    const detail = await getTicketDetail(member, ticketId);
    expect(detail.ticket).toMatchObject({
      channel: "portal",
      companyId: alpha.company.id,
    });

    await addTicketMessage(member, {
      ticketId,
      body: "Nous regardons cela aujourd'hui.",
      internal: false,
    });
    await addTicketMessage(member, {
      ticketId,
      body: "Note interne : facturer si hors contrat.",
      internal: true,
    });
    const seen = await getTicketForPortal(alpha.ctx, ticketId);
    const bodies = seen.messages.map((row) => row.body);
    expect(bodies).toContain("Nous regardons cela aujourd'hui.");
    expect(JSON.stringify(seen)).not.toContain("Note interne");

    await addPortalTicketMessage(alpha.ctx, { ticketId, body: "Merci, c'est urgent." });
    const agency = await getTicketDetail(member, ticketId);
    expect(agency.messages.map((row) => row.body)).toContain("Merci, c'est urgent.");

    await dispatchPendingEvents(db);
    await dispatchPendingEvents(db);
    const replies = (await notificationsOf(db, admin.actor.userId)).filter(
      (row) => row.entityId === ticketId && row.kind === "client_message",
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.href).toBe(`/support/${ticketId}`);
  });

  it("un message du client arrive dans la boîte de l'agence", async () => {
    const { member } = world;
    await sendPortalMessage(alpha.ctx, { body: "Bonjour, où en est-on ?" });
    const conversations = await listConversations(member, {});
    const conversation = conversations.items.find((row) => row.companyId === alpha.company.id);
    expect(conversation).toBeDefined();
    const id = conversation?.id ?? "";
    expect((await getConversation(member, id)).companyId).toBe(alpha.company.id);
    const { items } = await listMessages(member, id);
    expect(items.map((row) => row.body)).toContain("Bonjour, où en est-on ?");
  });

  it("un fichier déposé par le client se lit côté agence", async () => {
    const { member } = world;
    const uploaded = await uploadClientFile(
      alpha.ctx,
      { filename: "photos-alpha.pdf", projectId: alpha.project.id },
      streamOf(pdfWith("photos alpha")),
      deps(),
    );
    clientFileId = uploaded.document.id;

    const shared = await uploadDocument(
      member,
      {
        title: "Charte Alpha",
        filename: "charte-alpha.pdf",
        kind: "brief",
        visibility: "client",
        companyId: alpha.company.id,
        projectId: alpha.project.id,
      },
      streamOf(pdfWith("charte alpha")),
      deps(),
    );
    sharedFileId = shared.document.id;
    const internal = await uploadDocument(
      member,
      {
        title: "Notes internes Alpha",
        filename: "notes-alpha.pdf",
        kind: "other",
        visibility: "internal",
        companyId: alpha.company.id,
      },
      streamOf(pdfWith("notes alpha")),
      deps(),
    );
    internalFileId = internal.document.id;

    const agency = await listDocumentsForCompany(member, alpha.company.id);
    expect(agency.map((row) => row.id)).toEqual(
      expect.arrayContaining([clientFileId, sharedFileId, internalFileId]),
    );
    const download = await openDocumentDownload(member, clientFileId, {}, deps());
    expect(new TextDecoder().decode(await readAll(download.stream))).toContain("photos alpha");

    // Le client lit ce qui est partagé et ce qu'il a déposé, jamais le document interne.
    const mine = await listDocumentsForPortal(alpha.ctx);
    expect(mine.items.map((row) => row.id).sort()).toEqual([clientFileId, sharedFileId].sort());
    await expect(assertDocumentReadable(alpha.ctx, internalFileId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  describe("le client Beta face aux objets d'Alpha : 404 partout", () => {
    const cases: [string, () => Promise<unknown>][] = [
      ["projet", () => getProjectForPortal(beta.ctx, alpha.project.id)],
      ["demande", () => getTicketForPortal(beta.ctx, ticketId)],
      [
        "message sur la demande",
        () => addPortalTicketMessage(beta.ctx, { ticketId, body: "Intrusion" }),
      ],
      [
        "validation du livrable",
        () =>
          submitDeliverableReview(beta.ctx, {
            deliverableId,
            decision: "validated",
          }),
      ],
      ["fichier du client", () => openDocumentDownload(beta.ctx, clientFileId, {}, deps())],
      ["fichier partagé", () => openDocumentDownload(beta.ctx, sharedFileId, {}, deps())],
      ["fichier interne", () => openDocumentDownload(beta.ctx, internalFileId, {}, deps())],
      ["lecture de fichier", () => assertDocumentReadable(beta.ctx, sharedFileId)],
      [
        "dépôt dans le projet",
        () =>
          uploadClientFile(
            beta.ctx,
            { filename: "piege.pdf", projectId: alpha.project.id },
            streamOf(pdfWith("piège")),
            deps(),
          ),
      ],
      [
        "dépôt sur la demande",
        () =>
          uploadClientFile(
            beta.ctx,
            { filename: "piege.pdf", ticketId },
            streamOf(pdfWith("piège 2")),
            deps(),
          ),
      ],
    ];

    it.each(cases)("%s", async (_name, call) => {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    });

    it("aucune liste de Beta ne contient rien d'Alpha, l'archive comprise", async () => {
      const home = await getPortalHome(beta.ctx);
      const tickets = await listTicketsForPortal(beta.ctx);
      const documents = await getPortalDocumentsPage(beta.ctx, { filter: "tous" });
      const dump = JSON.stringify({ home, tickets, documents });
      for (const leaked of [
        alpha.project.id,
        ticketId,
        clientFileId,
        sharedFileId,
        internalFileId,
        "Maquette Alpha",
        "photos-alpha",
      ]) {
        expect(dump).not.toContain(leaked);
      }
      expect(tickets).toEqual([]);
      await expect(openPortalArchive(beta.ctx, deps())).rejects.toBeInstanceOf(NotFoundError);

      const archive = await openPortalArchive(alpha.ctx, deps());
      expect(archive.fileCount).toBe(2);
    });

    it("le contenu attendu d'Alpha reste hors de portée", async () => {
      const requirement = await createRequirement(world.member, {
        projectId: alpha.project.id,
        label: "Textes Alpha",
      });
      await expect(
        markRequirementReceived(beta.ctx, { requirementId: requirement.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("une adhésion révoquée ferme aussitôt l'espace", async () => {
    const { admin, db } = world;
    const client = await createPortalClient(db, { company: beta.company });
    const ctx = await resolvePortalContext(db, client.actor);
    expect(ctx.companyId).toBe(beta.company.id);
    await revokePortalAccess(admin, { membershipId: client.membership.id });
    await expect(resolvePortalContext(db, client.actor)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
