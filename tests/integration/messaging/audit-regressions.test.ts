import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OpenAiClient,
  type GenerateTextInput,
  type TextGenerator,
} from "@/integrations/openai/openai.client";
import {
  changeAppointmentStatus,
  createAppointment,
  getAppointmentCounts,
  listAppointments,
  listAppointmentsForOpportunity,
} from "@/modules/appointments/appointment.service";
import { updateAppointmentIfStatus } from "@/modules/appointments/appointment.repository";
import {
  addComment,
  listComments,
  listMentionCandidates,
} from "@/modules/messaging/comment.service";
import {
  archiveConversation,
  getInboxCounts,
  getMessagesToHandle,
  listConversations,
  listPortalConversation,
  listMessageMentionCandidates,
  restoreConversation,
  sendMessage,
  sendPortalMessage,
} from "@/modules/messaging/message.service";
import {
  applyReplySuggestion,
  dismissReplySuggestion,
  getSuggestionPanel,
  requestReplySuggestion,
} from "@/modules/messaging/suggestion.service";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  IntegrationError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createConversation,
  createMemberContext,
  createOpportunity,
  createPortalTestContext,
  createProject,
  createTask,
  createTicket,
} from "../../helpers/factories";
import { responsesApiBody, startOpenAiStub, type OpenAiStubReply } from "../../helpers/openai-stub";

/** Défauts prouvés par l'audit du lot : chaque test échouait avant la correction. */
describe("audit du lot Messages", () => {
  let db: Database;
  let admin: Awaited<ReturnType<typeof createMemberContext>>;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    admin = await createMemberContext(db, "admin");
  });

  describe("périmètre du prestataire sur les commentaires", () => {
    it("une tâche assignée n'ouvre pas les commentaires des autres tâches du projet", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const project = await createProject(db);
      const mine = await createTask(db, {
        projectId: project.id,
        assigneeMemberId: contractor.member.id,
      });
      const other = await createTask(db, { projectId: project.id });
      await addComment(admin, {
        entityType: "task",
        entityId: other.id,
        companyId: project.companyId,
        body: "Note réservée à l'équipe",
        href: `/projets/${project.id}`,
      });

      await expect(
        listComments(contractor, { entityType: "task", entityId: mine.id }),
      ).resolves.toEqual([]);
      await expect(
        listComments(contractor, { entityType: "task", entityId: other.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        addComment(contractor, {
          entityType: "task",
          entityId: other.id,
          companyId: project.companyId,
          body: "Intrusion",
          href: `/projets/${project.id}`,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("un rattachement au projet n'ouvre pas les demandes de ce projet", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const project = await createProject(db);
      await createTask(db, { projectId: project.id, assigneeMemberId: contractor.member.id });
      const ticket = await createTicket(db, {
        companyId: project.companyId,
        projectId: project.id,
      });
      await expect(
        listComments(contractor, { entityType: "ticket", entityId: ticket.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("mentions d'une personne qui n'a pas accès", () => {
    it("un prestataire n'est ni proposé ni mentionnable dans un message", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const member = await createMemberContext(db, "member");
      const conversation = await createConversation(db);

      const candidates = await listMessageMentionCandidates(admin);
      const ids = candidates.map((item) => item.id);
      expect(ids).toContain(member.actor.userId);
      expect(ids).not.toContain(contractor.actor.userId);

      await expect(
        sendMessage(admin, {
          conversationId: conversation.id,
          body: "Regarde ça",
          direction: "internal",
          mentions: [contractor.actor.userId],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("un prestataire n'est mentionnable sur un commentaire que dans son périmètre", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const project = await createProject(db);
      const mine = await createTask(db, {
        projectId: project.id,
        assigneeMemberId: contractor.member.id,
      });
      const other = await createTask(db, { projectId: project.id });
      const base = {
        entityType: "task" as const,
        companyId: project.companyId,
        body: "Avis ?",
        mentions: [contractor.actor.userId],
        href: `/projets/${project.id}`,
      };

      await expect(addComment(admin, { ...base, entityId: other.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(addComment(admin, { ...base, entityId: mine.id })).resolves.toBeTruthy();
      // La liste générale reste celle du contrat, utilisée par les écrans Projets et Support.
      expect((await listMentionCandidates(admin)).map((item) => item.id)).toContain(
        contractor.actor.userId,
      );
    });

    it("refuse un lien de notification qui sort de l'application", async () => {
      const project = await createProject(db);
      const task = await createTask(db, { projectId: project.id });
      await expect(
        addComment(admin, {
          entityType: "task",
          entityId: task.id,
          companyId: project.companyId,
          body: "Lien",
          href: "//exemple.invalid/piege",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("messages à traiter", () => {
    it("une note interne ne fait pas passer un message du client pour traité", async () => {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      const { conversationId } = await sendPortalMessage(portal, { body: "Une question" });
      const isListed = async () =>
        (await getMessagesToHandle(db, { limit: 100 })).some(
          (item) => item.conversationId === conversationId,
        );
      expect(await isListed()).toBe(true);

      await sendMessage(admin, {
        conversationId,
        body: "Je regarde ça demain",
        direction: "internal",
      });
      expect(await isListed()).toBe(true);
      // L'extrait du tableau de bord reste le message du client, pas la note.
      const handled = await getMessagesToHandle(db, { limit: 100 });
      expect(handled.find((item) => item.conversationId === conversationId)?.excerpt).toBe(
        "Une question",
      );

      await sendMessage(admin, { conversationId, body: "Voici la réponse" });
      expect(await isListed()).toBe(false);
    });
  });

  describe("réponses suggérées", () => {
    let stub: Awaited<ReturnType<typeof startOpenAiStub>>;
    let nextReply: () => OpenAiStubReply;
    let generator: TextGenerator;

    beforeAll(async () => {
      stub = await startOpenAiStub(() => nextReply());
      generator = new OpenAiClient({
        apiKey: "cle-de-test",
        model: "modele-de-test",
        baseUrl: stub.baseUrl,
        timeoutMs: 500,
      });
    });
    afterAll(() => stub.close());
    beforeEach(() => {
      nextReply = () => ({ json: responsesApiBody("Bonjour, c'est noté.") });
    });

    async function inbound() {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      const message = await sendPortalMessage(portal, { body: "Peut-on décaler ?" });
      return { portal, conversationId: message.conversationId };
    }

    it("après l'échec de « Reformuler », la proposition reste affichée", async () => {
      const { conversationId } = await inbound();
      const first = await requestReplySuggestion(admin, { conversationId }, { generator });
      nextReply = () => ({ status: 500, json: {} });
      await expect(
        requestReplySuggestion(admin, { conversationId, mode: "rephrase" }, { generator }),
      ).rejects.toThrow();

      const panel = await getSuggestionPanel(admin, conversationId, { generator });
      expect(panel.current?.id).toBe(first.id);
      expect(panel.current?.status).toBe("ready");

      // Une fois utilisée, l'échec ancien ne réapparaît pas à sa place.
      await applyReplySuggestion(admin, first.id);
      expect((await getSuggestionPanel(admin, conversationId, { generator })).current).toBeNull();
    });

    it("écarter la proposition n'affiche pas l'échec de « Reformuler » à sa place", async () => {
      const { conversationId } = await inbound();
      const first = await requestReplySuggestion(admin, { conversationId }, { generator });
      nextReply = () => ({ status: 500, json: {} });
      await expect(
        requestReplySuggestion(admin, { conversationId, mode: "shorter" }, { generator }),
      ).rejects.toThrow();
      await dismissReplySuggestion(admin, first.id);
      expect((await getSuggestionPanel(admin, conversationId, { generator })).current).toBeNull();
    });

    it("un échec sans proposition en cours reste affiché, et « Réessayer » le remplace", async () => {
      const { conversationId } = await inbound();
      nextReply = () => ({ status: 500, json: {} });
      await expect(
        requestReplySuggestion(admin, { conversationId }, { generator }),
      ).rejects.toThrow();
      expect((await getSuggestionPanel(admin, conversationId, { generator })).current?.status).toBe(
        "failed",
      );

      nextReply = () => ({ json: responsesApiBody("Deuxième essai") });
      const second = await requestReplySuggestion(admin, { conversationId }, { generator });
      const panel = await getSuggestionPanel(admin, conversationId, { generator });
      expect(panel.current?.id).toBe(second.id);
      expect(panel.current?.body).toBe("Deuxième essai");
    });

    /** Le fil bouge pendant que le modèle travaille. */
    function generatorDuring(act: () => Promise<unknown>): TextGenerator {
      return {
        isConfigured: true,
        generate: async (_input: GenerateTextInput) => {
          await act();
          return { text: "Réponse à la question précédente", model: "faux" };
        },
      };
    }

    it("une réponse envoyée pendant la génération n'est pas suivie d'une proposition périmée", async () => {
      const { conversationId } = await inbound();
      await expect(
        requestReplySuggestion(
          admin,
          { conversationId },
          {
            generator: generatorDuring(() =>
              sendMessage(admin, { conversationId, body: "Répondu à la main" }),
            ),
          },
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      const ready = await db
        .select()
        .from(schema.replySuggestions)
        .where(
          and(
            eq(schema.replySuggestions.conversationId, conversationId),
            eq(schema.replySuggestions.status, "ready"),
          ),
        );
      expect(ready).toEqual([]);
    });

    it("un message reçu pendant la génération écarte la proposition sur l'ancien message", async () => {
      const { portal, conversationId } = await inbound();
      await expect(
        requestReplySuggestion(
          admin,
          { conversationId },
          {
            generator: generatorDuring(() =>
              sendPortalMessage(portal, { body: "En fait, autre chose" }),
            ),
          },
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      const panel = await getSuggestionPanel(admin, conversationId, { generator });
      expect(panel.current).toBeNull();
    });

    it("une conversation archivée pendant la génération ne reçoit pas de proposition", async () => {
      const { conversationId } = await inbound();
      await expect(
        requestReplySuggestion(
          admin,
          { conversationId },
          { generator: generatorDuring(() => archiveConversation(admin, conversationId)) },
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("une note interne pendant la génération ne périme pas la proposition", async () => {
      const { conversationId } = await inbound();
      const suggestion = await requestReplySuggestion(
        admin,
        { conversationId },
        {
          generator: generatorDuring(() =>
            sendMessage(admin, { conversationId, body: "Note", direction: "internal" }),
          ),
        },
      );
      expect(suggestion.status).toBe("ready");
    });

    it("une réponse tronquée par le modèle n'est pas présentée comme une proposition", async () => {
      nextReply = () => ({ json: { ...responsesApiBody("Bonjour, nous"), status: "incomplete" } });
      await expect(
        generator.generate({ instructions: "Consigne", input: "Texte", maxOutputTokens: 10 }),
      ).rejects.toBeInstanceOf(IntegrationError);
    });
  });

  describe("conversations archivées", () => {
    it("restent consultables et se rétablissent, avec audit, de façon répétable", async () => {
      const company = await createCompany(db, { status: "client" });
      const contact = await createContact(db, { companyId: company.id });
      const conversation = await createConversation(db, {
        companyId: company.id,
        contactId: contact.id,
        subject: `Archivée ${company.id}`,
      });
      await archiveConversation(admin, conversation.id);

      const search = company.id;
      const archived = await listConversations(admin, { filter: "archivees", search });
      expect(archived.items.map((item) => item.id)).toEqual([conversation.id]);
      expect((await listConversations(admin, { search })).items).toEqual([]);
      expect((await getInboxCounts(admin)).archived).toBeGreaterThan(0);

      await restoreConversation(admin, conversation.id);
      await restoreConversation(admin, conversation.id);
      expect((await listConversations(admin, { search })).items.map((item) => item.id)).toEqual([
        conversation.id,
      ]);
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.entityId, conversation.id),
            eq(schema.auditLog.action, "conversation.restored"),
          ),
        );
      expect(audit).toHaveLength(1);

      await sendMessage(admin, { conversationId: conversation.id, body: "De retour" });
    });

    it("le rétablissement est refusé à la lecture seule et rend le fil au portail", async () => {
      const viewer = await createTestContext(db, "viewer");
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      const { conversationId } = await sendPortalMessage(portal, { body: "Bonjour" });
      await archiveConversation(admin, conversationId);
      expect((await listPortalConversation(portal)).messages).toEqual([]);

      await expect(restoreConversation(viewer, conversationId)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await restoreConversation(admin, conversationId);
      expect((await listPortalConversation(portal)).messages).toHaveLength(1);
    });
  });

  describe("rendez-vous", () => {
    it("refuse clairement un contact ou une affaire sans client rattachés à un client", async () => {
      const company = await createCompany(db);
      const orphanContact = await createContact(db, { companyId: null });
      const orphanDeal = await createOpportunity(db, { companyId: null });
      const base = {
        title: "Point",
        startsAt: "2030-01-15T10:00:00.000Z",
        durationMinutes: 30,
        companyId: company.id,
      };
      await expect(
        createAppointment(admin, { ...base, contactId: orphanContact.id }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createAppointment(admin, { ...base, opportunityId: orphanDeal.id }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("retrouve les réunions d'une affaire et de son client, sans les autres", async () => {
      const company = await createCompany(db);
      const deal = await createOpportunity(db, { companyId: company.id });
      const base = { startsAt: "2030-02-01T10:00:00.000Z", durationMinutes: 30 };
      const linked = await createAppointment(admin, {
        ...base,
        title: "Découverte",
        opportunityId: deal.id,
      });
      const cancelled = await createAppointment(admin, {
        ...base,
        title: "Annulé",
        opportunityId: deal.id,
      });
      await changeAppointmentStatus(admin, cancelled.id, "cancelled");
      await createAppointment(admin, { ...base, title: "Sans affaire", companyId: company.id });

      const forDeal = await listAppointmentsForOpportunity(admin, deal.id);
      expect(forDeal.map((item) => item.id)).toEqual([linked.id]);

      const filtered = await listAppointments(admin, {
        scope: "upcoming",
        opportunityId: deal.id,
      });
      expect(filtered.items.map((item) => item.title)).toEqual(["Découverte"]);
      expect(await getAppointmentCounts(admin, { opportunityId: deal.id })).toMatchObject({
        upcoming: 1,
        cancelled: 1,
      });
      expect(await getAppointmentCounts(admin, { companyId: company.id })).toMatchObject({
        upcoming: 2,
      });

      const contractor = await createMemberContext(db, "contractor");
      await expect(listAppointmentsForOpportunity(contractor, deal.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("refuse une date hors de portée au lieu de la stocker", async () => {
      const company = await createCompany(db);
      await expect(
        createAppointment(admin, {
          title: "Point",
          startsAt: "+123456-01-01T10:00:00.000Z",
          durationMinutes: 30,
          companyId: company.id,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("deux changements simultanés : le second, parti d'un état périmé, n'écrit rien", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, {
        title: "Point",
        startsAt: "2030-01-15T10:00:00.000Z",
        durationMinutes: 30,
        companyId: company.id,
      });
      await changeAppointmentStatus(admin, id, "done");
      // Lecture faite avant le passage à `done` : l'écriture conditionnelle ne s'applique plus.
      expect(await updateAppointmentIfStatus(db, id, "planned", { status: "cancelled" })).toBe(
        false,
      );
      const [row] = await db
        .select({ status: schema.appointments.status })
        .from(schema.appointments)
        .where(eq(schema.appointments.id, id));
      expect(row?.status).toBe("done");
    });
  });
});
