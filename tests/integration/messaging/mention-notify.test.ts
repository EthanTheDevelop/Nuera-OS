import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addComment } from "@/modules/messaging/comment.service";
import { sendMessage } from "@/modules/messaging/message.service";
import { notify } from "@/modules/platform/notifications.service";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import {
  createConversation,
  createMemberContext,
  createProject,
  createTask,
} from "../../helpers/factories";

// `notify` appartient au lot Automatisations : ce test contrôle ce que ce lot lui transmet.
vi.mock("@/modules/platform/notifications.service", () => ({ notify: vi.fn() }));

describe("notification des personnes mentionnées", () => {
  let db: Database;
  let admin: Awaited<ReturnType<typeof createMemberContext>>;
  let member: Awaited<ReturnType<typeof createMemberContext>>;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    admin = await createMemberContext(db, "admin");
    member = await createMemberContext(db, "member");
  });

  beforeEach(() => vi.mocked(notify).mockClear());

  it("un message prévient la personne, sans l'auteur, avec un lien vers la conversation", async () => {
    const conversation = await createConversation(db);
    const message = await sendMessage(admin, {
      conversationId: conversation.id,
      body: "@Quelqu'un tu peux regarder ?",
      direction: "internal",
      mentions: [member.actor.userId, admin.actor.userId],
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0]?.[1]).toMatchObject({
      userIds: [member.actor.userId],
      kind: "mention",
      href: `/messages/${conversation.id}`,
      dedupeKey: `mention:message:${message.id}`,
    });
  });

  it("un double envoi ne prévient qu'une fois", async () => {
    const conversation = await createConversation(db);
    const input = {
      conversationId: conversation.id,
      body: "Une fois",
      direction: "internal" as const,
      mentions: [member.actor.userId],
      clientRequestId: crypto.randomUUID(),
    };
    await sendMessage(admin, input);
    await sendMessage(admin, input);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("sans mention, ou en se mentionnant soi-même, personne n'est prévenu", async () => {
    const conversation = await createConversation(db);
    await sendMessage(admin, { conversationId: conversation.id, body: "Rien" });
    await sendMessage(admin, {
      conversationId: conversation.id,
      body: "Moi",
      mentions: [admin.actor.userId],
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("un commentaire reprend le lien de l'objet commenté", async () => {
    const project = await createProject(db);
    const task = await createTask(db, { projectId: project.id });
    const comment = await addComment(admin, {
      entityType: "task",
      entityId: task.id,
      companyId: project.companyId,
      body: "À toi",
      mentions: [member.actor.userId],
      href: `/projets/${project.id}`,
    });
    expect(vi.mocked(notify).mock.calls[0]?.[1]).toMatchObject({
      userIds: [member.actor.userId],
      href: `/projets/${project.id}`,
      dedupeKey: `mention:comment:${comment.id}`,
    });
  });
});
