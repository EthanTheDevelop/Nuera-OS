import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addComment,
  archiveComment,
  listComments,
  listMentionCandidates,
} from "@/modules/messaging/comment.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createPhase,
  createProject,
  createTask,
  createTicket,
} from "../../helpers/factories";

describe("commentaires", () => {
  let db: Database;
  let admin: Awaited<ReturnType<typeof createMemberContext>>;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let project: schema.Project;
  let task: schema.Task;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    admin = await createMemberContext(db, "admin");
    member = await createMemberContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    project = await createProject(db);
    task = await createTask(db, { projectId: project.id });
  });

  const input = (overrides: Partial<Parameters<typeof addComment>[1]> = {}) => ({
    entityType: "task" as const,
    entityId: task.id,
    companyId: project.companyId,
    body: "Un commentaire",
    href: `/projets/${project.id}`,
    ...overrides,
  });

  it("ajoute puis liste un commentaire, avec son auteur, et le journalise", async () => {
    const comment = await addComment(admin, input());
    expect(comment.authorName).toBe(admin.actor.name);

    const list = await listComments(admin, { entityType: "task", entityId: task.id });
    expect(list.map((item) => item.id)).toContain(comment.id);

    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, comment.id));
    expect(audit.map((row) => row.action)).toEqual(["comment.created"]);
  });

  it("refuse un corps vide", async () => {
    await expect(addComment(admin, input({ body: "   " }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse le mauvais client : le companyId transmis n'est jamais cru", async () => {
    const other = await createCompany(db);
    await expect(addComment(admin, input({ companyId: other.id }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("répond 404 pour un objet qui n'existe pas", async () => {
    await expect(
      addComment(admin, input({ entityId: crypto.randomUUID() })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listComments(admin, { entityType: "task", entityId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  describe("mentions", () => {
    it("accepte un compte réel de l'équipe", async () => {
      const comment = await addComment(admin, input({ mentions: [member.actor.userId] }));
      expect(comment.mentions).toEqual([member.actor.userId]);
    });

    it("refuse un identifiant inconnu et un compte client", async () => {
      await expect(
        addComment(admin, input({ mentions: [crypto.randomUUID()] })),
      ).rejects.toBeInstanceOf(ValidationError);

      const client = await createTestContext(db, "client");
      await expect(
        addComment(admin, input({ mentions: [client.actor.userId] })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuse un compte désactivé", async () => {
      const banned = await createTestContext(db, "member");
      await db
        .update(schema.users)
        .set({ banned: true })
        .where(eq(schema.users.id, banned.actor.userId));
      await expect(
        addComment(admin, input({ mentions: [banned.actor.userId] })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("ne perd pas le commentaire si la notification échoue", async () => {
      // `notify` est livré par le lot Automatisations : tant qu'il échoue, le commentaire reste.
      const comment = await addComment(
        admin,
        input({ body: "Avec mention", mentions: [member.actor.userId] }),
      );
      const [row] = await db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.id, comment.id));
      expect(row?.body).toBe("Avec mention");
    });

    it("propose les membres qui ont un compte, sans coût ni tarif", async () => {
      const candidates = await listMentionCandidates(admin);
      expect(candidates.map((item) => item.id)).toContain(admin.actor.userId);
      expect(Object.keys(candidates[0] ?? {}).join()).not.toMatch(/cost|rate/i);
    });
  });

  describe("réponses", () => {
    it("ramène une réponse à une réponse au fil d'origine", async () => {
      const root = await addComment(admin, input({ body: "Racine" }));
      const reply = await addComment(admin, input({ body: "Réponse", parentId: root.id }));
      const nested = await addComment(admin, input({ body: "Encore", parentId: reply.id }));
      expect(reply.parentId).toBe(root.id);
      expect(nested.parentId).toBe(root.id);
    });

    it("refuse un parent qui porte sur un autre objet", async () => {
      const elsewhere = await createTask(db, { projectId: project.id });
      const parent = await addComment(admin, input({ entityId: elsewhere.id }));
      await expect(addComment(admin, input({ parentId: parent.id }))).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  it("idempotence : un double envoi ne crée qu'un commentaire", async () => {
    const clientRequestId = crypto.randomUUID();
    const first = await addComment(admin, input({ body: "Unique", clientRequestId }));
    const second = await addComment(admin, input({ body: "Unique", clientRequestId }));
    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, clientRequestId));
    expect(rows).toHaveLength(1);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, first.id));
    expect(audit).toHaveLength(1);
  });

  describe("permissions et périmètre", () => {
    it("un compte en lecture lit mais ne commente pas", async () => {
      await expect(
        listComments(viewer, { entityType: "task", entityId: task.id }),
      ).resolves.toEqual(expect.any(Array));
      await expect(addComment(viewer, input())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("un client n'a aucun accès interne", async () => {
      const client = await createTestContext(db, "client");
      await expect(
        listComments(client, { entityType: "task", entityId: task.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(addComment(client, input())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("un prestataire ne voit que ce qui lui est confié : le reste répond 404", async () => {
      const contractor = await createMemberContext(db, "contractor");
      await expect(
        listComments(contractor, { entityType: "task", entityId: task.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(addComment(contractor, input())).rejects.toBeInstanceOf(NotFoundError);

      const mine = await createTask(db, {
        projectId: project.id,
        assigneeMemberId: contractor.member.id,
      });
      const comment = await addComment(contractor, input({ entityId: mine.id }));
      expect(comment.authorUserId).toBe(contractor.actor.userId);
    });

    it("un prestataire commente un ticket qui lui est attribué, pas un autre", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const company = await createCompany(db);
      const assigned = await createTicket(db, {
        companyId: company.id,
        assigneeMemberId: contractor.member.id,
      });
      const other = await createTicket(db, { companyId: company.id });
      const target = {
        entityType: "ticket" as const,
        companyId: company.id,
        body: "Pris en charge",
        href: "/support",
      };
      await expect(
        addComment(contractor, { ...target, entityId: assigned.id }),
      ).resolves.toBeTruthy();
      await expect(
        addComment(contractor, { ...target, entityId: other.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("résout le client d'un projet et d'un livrable", async () => {
      const phase = await createPhase(db, { projectId: project.id });
      const [deliverable] = await db
        .insert(schema.deliverables)
        .values({ projectId: project.id, phaseId: phase.id, title: "Maquette" })
        .returning();
      await expect(
        addComment(admin, input({ entityType: "project", entityId: project.id })),
      ).resolves.toBeTruthy();
      await expect(
        addComment(admin, input({ entityType: "deliverable", entityId: deliverable?.id ?? "" })),
      ).resolves.toBeTruthy();
    });
  });

  describe("archivage", () => {
    it("retire le commentaire de la liste sans le supprimer, de façon répétable", async () => {
      const comment = await addComment(admin, input({ body: "À retirer" }));
      await archiveComment(admin, comment.id);
      await archiveComment(admin, comment.id);

      const list = await listComments(admin, { entityType: "task", entityId: task.id });
      expect(list.map((item) => item.id)).not.toContain(comment.id);
      const [row] = await db
        .select()
        .from(schema.comments)
        .where(eq(schema.comments.id, comment.id));
      expect(row?.archivedAt).not.toBeNull();
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.entityId, comment.id));
      expect(audit.filter((entry) => entry.action === "comment.archived")).toHaveLength(1);
    });

    it("réservé à l'auteur et aux associés", async () => {
      const comment = await addComment(admin, input({ body: "De l'associé" }));
      await expect(archiveComment(member, comment.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
