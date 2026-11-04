import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  archiveConversation,
  createConversation,
  getConversation,
  getInboxCounts,
  getMessagesToHandle,
  getPortalUnreadCount,
  getUnreadCount,
  listConversations,
  listConversationsForCompany,
  listMessages,
  listPortalConversation,
  markConversationRead,
  markPortalRead,
  sendMessage,
  sendPortalMessage,
} from "@/modules/messaging/message.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createConversation as insertConversation,
  createDocument,
  createMemberContext,
  createPortalTestContext,
  createProject,
} from "../../helpers/factories";

describe("messages", () => {
  let db: Database;
  let admin: Awaited<ReturnType<typeof createMemberContext>>;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let contractor: ServiceContext;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    admin = await createMemberContext(db, "admin");
    member = await createMemberContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    contractor = await createMemberContext(db, "contractor");
  });

  async function setup() {
    const company = await createCompany(db, { status: "client" });
    const contact = await createContact(db, { companyId: company.id, firstName: "Claire" });
    const conversation = await insertConversation(db, {
      companyId: company.id,
      contactId: contact.id,
    });
    return { company, contact, conversation };
  }

  describe("créer une conversation", () => {
    it("relie client, contact et projet, et journalise", async () => {
      const company = await createCompany(db);
      const contact = await createContact(db, { companyId: company.id });
      const project = await createProject(db, { companyId: company.id });
      const { id } = await createConversation(admin, {
        companyId: company.id,
        contactId: contact.id,
        projectId: project.id,
        subject: "Lancement",
      });
      const view = await getConversation(admin, id);
      expect(view).toMatchObject({
        companyId: company.id,
        contactId: contact.id,
        projectId: project.id,
        subject: "Lancement",
      });
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
      expect(audit.map((row) => row.action)).toEqual(["conversation.created"]);
    });

    it("refuse un contact ou un projet d'un autre client", async () => {
      const company = await createCompany(db);
      const other = await createCompany(db);
      const foreignContact = await createContact(db, { companyId: other.id });
      const foreignProject = await createProject(db, { companyId: other.id });
      await expect(
        createConversation(admin, { companyId: company.id, contactId: foreignContact.id }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createConversation(admin, { companyId: company.id, projectId: foreignProject.id }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuse un client archivé", async () => {
      const company = await createCompany(db, { archivedAt: new Date() });
      await expect(createConversation(admin, { companyId: company.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("idempotence : un double envoi du formulaire ne crée qu'une conversation", async () => {
      const company = await createCompany(db);
      const clientRequestId = crypto.randomUUID();
      const input = { companyId: company.id, clientRequestId, firstMessage: "Bonjour" };
      const first = await createConversation(admin, input);
      const second = await createConversation(admin, input);
      expect(second.id).toBe(first.id);
      const { items } = await listMessages(admin, first.id);
      expect(items).toHaveLength(1);
    });

    it("consigne un message reçu : non lu pour l'équipe et événement", async () => {
      const company = await createCompany(db);
      const contact = await createContact(db, { companyId: company.id });
      const { id } = await createConversation(admin, {
        companyId: company.id,
        contactId: contact.id,
        firstMessage: "Appel reçu",
        firstDirection: "inbound",
      });
      const view = await getConversation(admin, id);
      expect(view.unread).toBe(1);
      const { items } = await listMessages(admin, id);
      expect(items[0]).toMatchObject({ direction: "inbound", own: false });
      const events = await db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.entityId, items[0]?.id ?? ""));
      expect(events.map((event) => event.type)).toEqual(["message.received"]);
    });

    it("exige le contact pour un message reçu", async () => {
      const company = await createCompany(db);
      await expect(
        createConversation(admin, {
          companyId: company.id,
          firstMessage: "Appel",
          firstDirection: "inbound",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("envoyer", () => {
    it("ajoute le message, met à jour la conversation et compte un non-lu client", async () => {
      const { conversation } = await setup();
      const message = await sendMessage(admin, {
        conversationId: conversation.id,
        body: "Bonjour Claire",
      });
      expect(message).toMatchObject({ direction: "outbound", own: true });
      const [row] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversation.id));
      expect(row?.unreadClient).toBe(1);
      expect(row?.lastMessageAt).not.toBeNull();
    });

    it("une note interne ne compte pas de non-lu client", async () => {
      const { conversation } = await setup();
      await sendMessage(admin, {
        conversationId: conversation.id,
        body: "Pour nous",
        direction: "internal",
      });
      const [row] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversation.id));
      expect(row?.unreadClient).toBe(0);
    });

    it("refuse un message vide, et une mention invalide", async () => {
      const { conversation } = await setup();
      await expect(
        sendMessage(admin, { conversationId: conversation.id, body: "  " }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        sendMessage(admin, {
          conversationId: conversation.id,
          body: "Salut",
          mentions: [crypto.randomUUID()],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("idempotence : un double envoi ne crée qu'un message et un non-lu", async () => {
      const { conversation } = await setup();
      const clientRequestId = crypto.randomUUID();
      const input = { conversationId: conversation.id, body: "Une fois", clientRequestId };
      const first = await sendMessage(admin, input);
      const second = await sendMessage(admin, input);
      expect(second.id).toBe(first.id);
      const { items } = await listMessages(admin, conversation.id);
      expect(items).toHaveLength(1);
      const [row] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversation.id));
      expect(row?.unreadClient).toBe(1);
    });

    it("n'accepte pas l'identifiant d'un message d'une autre conversation", async () => {
      const a = await setup();
      const b = await setup();
      const clientRequestId = crypto.randomUUID();
      await sendMessage(admin, {
        conversationId: a.conversation.id,
        body: "A",
        clientRequestId,
      });
      await expect(
        sendMessage(admin, { conversationId: b.conversation.id, body: "B", clientRequestId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuse d'écrire dans une conversation archivée", async () => {
      const { conversation } = await setup();
      await archiveConversation(admin, conversation.id);
      await expect(
        sendMessage(admin, { conversationId: conversation.id, body: "Encore" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("répond 404 pour une conversation inconnue", async () => {
      await expect(
        sendMessage(admin, { conversationId: crypto.randomUUID(), body: "Salut" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(getConversation(admin, "pas-un-uuid")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("pièce jointe", () => {
    it("joint un document partagé du même client", async () => {
      const { company, conversation } = await setup();
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "client",
      });
      const message = await sendMessage(admin, {
        conversationId: conversation.id,
        body: "Ci-joint",
        documentId: document.id,
      });
      expect(message.attachment?.documentId).toBe(document.id);
    });

    it("accepte un fichier seul, sans texte", async () => {
      const { company, conversation } = await setup();
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "client",
      });
      const message = await sendMessage(admin, {
        conversationId: conversation.id,
        body: "",
        documentId: document.id,
      });
      expect(message.body).toBe("");
    });

    it("refuse le document d'un autre client", async () => {
      const { conversation } = await setup();
      const other = await createCompany(db);
      const { document } = await createDocument(db, { companyId: other.id, visibility: "client" });
      await expect(
        sendMessage(admin, {
          conversationId: conversation.id,
          body: "Mauvais",
          documentId: document.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("refuse un document interne dans un message au client, l'accepte dans une note", async () => {
      const { company, conversation } = await setup();
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "internal",
      });
      await expect(
        sendMessage(admin, {
          conversationId: conversation.id,
          body: "Interne",
          documentId: document.id,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        sendMessage(admin, {
          conversationId: conversation.id,
          body: "Interne",
          documentId: document.id,
          direction: "internal",
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("lecture et filtres", () => {
    it("filtre clients, prospects et recherche, sur un jeu paginé", async () => {
      const client = await createCompany(db, { status: "client", name: "Atelier Filtre" });
      const prospect = await createCompany(db, { status: "prospect", name: "Prospect Filtre" });
      const a = await insertConversation(db, { companyId: client.id });
      const b = await insertConversation(db, { companyId: prospect.id });
      await sendMessage(admin, { conversationId: b.id, body: "Mot-singulier-recherché" });

      const clients = await listConversations(admin, { filter: "clients", pageSize: 100 });
      expect(clients.items.map((item) => item.id)).toContain(a.id);
      expect(clients.items.map((item) => item.id)).not.toContain(b.id);

      const prospects = await listConversations(admin, { filter: "prospects", pageSize: 100 });
      expect(prospects.items.map((item) => item.id)).toContain(b.id);

      const byCompany = await listConversations(admin, { search: "Atelier Filtre" });
      expect(byCompany.items.map((item) => item.id)).toEqual([a.id]);

      const byMessage = await listConversations(admin, { search: "singulier" });
      expect(byMessage.items.map((item) => item.id)).toEqual([b.id]);

      const page = await listConversations(admin, { pageSize: 1, page: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(1);
    });

    it("une recherche n'interprète ni % ni _", async () => {
      const result = await listConversations(admin, { search: "%_%" });
      expect(result.items).toEqual([]);
    });

    it("classe par dernier message, et donne l'extrait", async () => {
      const a = await setup();
      const b = await setup();
      await sendMessage(admin, { conversationId: a.conversation.id, body: "Ancien" });
      await sendMessage(admin, { conversationId: b.conversation.id, body: "Récent" });
      await sendMessage(admin, { conversationId: a.conversation.id, body: "Le plus récent" });
      const { items } = await listConversations(admin, { pageSize: 100 });
      const ids = items.map((item) => item.id);
      expect(ids.indexOf(a.conversation.id)).toBeLessThan(ids.indexOf(b.conversation.id));
      expect(items.find((item) => item.id === a.conversation.id)?.lastExcerpt).toBe(
        "Le plus récent",
      );
    });

    it("exclut les archivées, de façon répétable et journalisée une fois", async () => {
      const { conversation } = await setup();
      await archiveConversation(admin, conversation.id);
      await archiveConversation(admin, conversation.id);
      const { items } = await listConversations(admin, { pageSize: 100 });
      expect(items.map((item) => item.id)).not.toContain(conversation.id);
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.entityId, conversation.id));
      expect(audit.filter((row) => row.action === "conversation.archived")).toHaveLength(1);
    });

    it("fait remonter en tête la conversation qui reçoit un message", async () => {
      const first = await setup();
      const second = await setup();
      const order = async () => {
        const { items } = await listConversations(admin, { pageSize: 100 });
        return items
          .map((item) => item.id)
          .filter((id) => id === first.conversation.id || id === second.conversation.id);
      };
      const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

      await sendMessage(admin, { conversationId: first.conversation.id, body: "Premier" });
      await tick();
      await sendMessage(admin, { conversationId: second.conversation.id, body: "Second" });
      expect(await order()).toEqual([second.conversation.id, first.conversation.id]);

      await tick();
      await sendMessage(admin, { conversationId: first.conversation.id, body: "Encore" });
      expect(await order()).toEqual([first.conversation.id, second.conversation.id]);
    });

    it("pagine le fil par curseur, du plus ancien au plus récent", async () => {
      const { conversation } = await setup();
      for (const body of ["un", "deux", "trois"]) {
        await sendMessage(admin, { conversationId: conversation.id, body });
      }
      const last = await listMessages(admin, conversation.id, { limit: 2 });
      expect(last.items.map((item) => item.body)).toEqual(["deux", "trois"]);
      expect(last.hasMore).toBe(true);
      const first = last.items[0];
      if (!first) throw new Error("Message attendu");
      const older = await listMessages(admin, conversation.id, {
        before: { at: first.at, id: first.id },
        limit: 2,
      });
      expect(older.items.map((item) => item.body)).toEqual(["un"]);
      expect(older.hasMore).toBe(false);
    });

    it("donne les compteurs et les conversations d'un client", async () => {
      const { company, conversation } = await setup();
      const counts = await getInboxCounts(admin);
      expect(counts.all).toBeGreaterThan(0);
      const rows = await listConversationsForCompany(admin, company.id, { limit: 3 });
      expect(rows.map((row) => row.id)).toEqual([conversation.id]);
    });
  });

  describe("non-lus", () => {
    it("un message du portail augmente le compteur, la lecture le remet à zéro", async () => {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      const before = await getUnreadCount(db, admin.actor.userId);

      await sendPortalMessage(portal, { body: "Bonjour" });
      expect(await getUnreadCount(db, admin.actor.userId)).toBe(before + 1);

      const { conversationId } = await listPortalConversation(portal);
      if (!conversationId) throw new Error("Conversation attendue");
      expect(await markConversationRead(admin, conversationId)).toBe(true);
      expect(await getUnreadCount(db, admin.actor.userId)).toBe(before);
      // Répétable : plus rien à écrire.
      expect(await markConversationRead(admin, conversationId)).toBe(false);
    });

    it("un compte en lecture seule ne fait pas baisser le compteur de l'équipe", async () => {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      await sendPortalMessage(portal, { body: "Bonjour" });
      const { conversationId } = await listPortalConversation(portal);
      if (!conversationId) throw new Error("Conversation attendue");
      expect(await markConversationRead(viewer, conversationId)).toBe(false);
      expect((await getConversation(admin, conversationId)).unread).toBe(1);
    });

    it("un compte sans accès aux messages ne voit aucun non-lu", async () => {
      expect(await getUnreadCount(db, contractor.actor.userId)).toBe(0);
      expect(await getUnreadCount(db, crypto.randomUUID())).toBe(0);
    });
  });

  describe("messages à traiter", () => {
    it("liste les conversations dont le dernier message vient du client", async () => {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      await sendPortalMessage(portal, { body: "Une question" });
      const { conversationId } = await listPortalConversation(portal);
      if (!conversationId) throw new Error("Conversation attendue");

      let rows = await getMessagesToHandle(db, { limit: 100 });
      const row = rows.find((item) => item.conversationId === conversationId);
      expect(row).toMatchObject({
        excerpt: "Une question",
        href: `/messages/${conversationId}`,
      });

      await sendMessage(admin, { conversationId, body: "Voici la réponse" });
      rows = await getMessagesToHandle(db, { limit: 100 });
      expect(rows.map((item) => item.conversationId)).not.toContain(conversationId);
    });
  });

  describe("permissions", () => {
    it("lecture : équipe et lecture seule ; ni prestataire ni client", async () => {
      await expect(listConversations(member)).resolves.toBeTruthy();
      await expect(listConversations(viewer)).resolves.toBeTruthy();
      await expect(listConversations(contractor)).rejects.toBeInstanceOf(ForbiddenError);
      const client = await createTestContext(db, "client");
      await expect(listConversations(client)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("écriture : refusée en lecture seule et au prestataire", async () => {
      const { company, conversation } = await setup();
      const input = { conversationId: conversation.id, body: "Non" };
      await expect(sendMessage(member, input)).resolves.toBeTruthy();
      await expect(sendMessage(viewer, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(sendMessage(contractor, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createConversation(viewer, { companyId: company.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(archiveConversation(viewer, conversation.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });

  describe("portail", () => {
    let company: schema.Company;
    let portal: Awaited<ReturnType<typeof createPortalTestContext>>;

    beforeEach(async () => {
      company = await createCompany(db, { status: "client" });
      portal = await createPortalTestContext(db, { company });
    });

    it("ouvre une conversation au premier message et émet message.received une fois", async () => {
      const clientRequestId = crypto.randomUUID();
      const message = await sendPortalMessage(portal, { body: "Bonjour", clientRequestId });
      const again = await sendPortalMessage(portal, { body: "Bonjour", clientRequestId });
      expect(again.id).toBe(message.id);
      expect(message).toMatchObject({ direction: "inbound", own: true });

      const view = await listPortalConversation(portal);
      expect(view.messages).toHaveLength(1);
      const events = await db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.entityId, message.id));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "message.received",
        companyId: company.id,
        actorId: portal.actor.userId,
      });
      expect(events[0]?.payload).toEqual({
        conversationId: view.conversationId,
        direction: "inbound",
      });
    });

    it("ne montre jamais une note interne ni un document non partagé", async () => {
      const conversation = await insertConversation(db, {
        companyId: company.id,
        contactId: portal.contactId,
      });
      const { document: internal } = await createDocument(db, {
        companyId: company.id,
        visibility: "internal",
      });
      await sendMessage(admin, {
        conversationId: conversation.id,
        body: "Note secrète",
        direction: "internal",
        documentId: internal.id,
        mentions: [member.actor.userId],
      });
      await sendMessage(admin, { conversationId: conversation.id, body: "Bonjour Claire" });

      const view = await listPortalConversation(portal);
      expect(view.messages.map((item) => item.body)).toEqual(["Bonjour Claire"]);
      expect(JSON.stringify(view)).not.toContain("Note secrète");
      expect(JSON.stringify(view)).not.toContain(member.actor.userId);
      expect(view.unread).toBe(1);
    });

    it("ne donne jamais accès aux échanges d'un autre client", async () => {
      const other = await createPortalTestContext(db);
      const conversation = await insertConversation(db, {
        companyId: other.companyId,
        contactId: other.contactId,
      });
      await sendMessage(admin, { conversationId: conversation.id, body: "Pour l'autre client" });

      const view = await listPortalConversation(portal);
      expect(view.messages).toEqual([]);
      expect(view.conversationId).toBeNull();
    });

    it("n'accepte pas le document d'un autre client", async () => {
      const other = await createCompany(db);
      const { document } = await createDocument(db, { companyId: other.id, visibility: "client" });
      await expect(
        sendPortalMessage(portal, { body: "Vol", documentId: document.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("ne détourne pas un message d'un autre compte par son identifiant", async () => {
      const other = await createPortalTestContext(db);
      const clientRequestId = crypto.randomUUID();
      await sendPortalMessage(other, { body: "À l'autre", clientRequestId });
      await expect(
        sendPortalMessage(portal, { body: "À moi", clientRequestId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("ne voit pas les conversations d'un autre contact du même client", async () => {
      const colleague = await createContact(db, { companyId: company.id });
      const conversation = await insertConversation(db, {
        companyId: company.id,
        contactId: colleague.id,
      });
      await sendMessage(admin, { conversationId: conversation.id, body: "À un collègue" });
      const view = await listPortalConversation(portal);
      expect(view.messages).toEqual([]);
    });

    it("marque comme lu sur son seul périmètre, de façon répétable", async () => {
      const mine = await insertConversation(db, {
        companyId: company.id,
        contactId: portal.contactId,
      });
      const other = await createPortalTestContext(db);
      const theirs = await insertConversation(db, {
        companyId: other.companyId,
        contactId: other.contactId,
      });
      await sendMessage(admin, { conversationId: mine.id, body: "Pour vous" });
      await sendMessage(admin, { conversationId: theirs.id, body: "Pour l'autre" });

      expect(await getPortalUnreadCount(portal)).toBe(1);
      await markPortalRead(portal);
      await markPortalRead(portal);
      expect(await getPortalUnreadCount(portal)).toBe(0);
      expect(await getPortalUnreadCount(other)).toBe(1);
    });

    it("n'écrit plus dans une conversation archivée : en ouvre une nouvelle", async () => {
      const conversation = await insertConversation(db, {
        companyId: company.id,
        contactId: portal.contactId,
      });
      await archiveConversation(admin, conversation.id);
      const message = await sendPortalMessage(portal, { body: "Reprise" });
      expect(message.conversationId).not.toBe(conversation.id);
    });
  });
});
