import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getNotificationCenter,
  listMyNotifications,
  markAllNotificationsRead,
  notify,
  openNotification,
} from "@/modules/platform/notifications.service";
import { emailOutbox, notificationPreferences, notifications, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { NotFoundError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";

let db: Database;

beforeAll(async () => {
  ({ db } = await createTestDatabase());
});

const base = { kind: "test", severity: "info" as const, title: "Alerte", href: "/sites" };

const rowsOf = (userId: string) =>
  db.select().from(notifications).where(eq(notifications.userId, userId));

describe("notify", () => {
  it("écrit une ligne par destinataire, sans doublon sur la même clé", async () => {
    const first = await createTestActor(db, "member");
    const second = await createTestActor(db, "member");
    const input = { ...base, userIds: [first.userId, second.userId], dedupeKey: "cle-1" };
    await notify(db, input);
    await notify(db, input);
    expect(await rowsOf(first.userId)).toHaveLength(1);
    expect(await rowsOf(second.userId)).toHaveLength(1);
    expect((await rowsOf(first.userId))[0]?.href).toBe("/sites");
  });

  it("vise un rôle, sans les comptes désactivés", async () => {
    const active = await createTestActor(db, "contractor");
    const banned = await createTestActor(db, "contractor");
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId));
    await notify(db, { ...base, role: "contractor", dedupeKey: "cle-role" });
    expect(await rowsOf(active.userId)).toHaveLength(1);
    expect(await rowsOf(banned.userId)).toHaveLength(0);
  });

  it("respecte les préférences : ni interne, mais un e-mail, une seule fois", async () => {
    const actor = await createTestActor(db, "member");
    await db
      .insert(notificationPreferences)
      .values({ userId: actor.userId, kind: "test", inApp: false, email: true });
    const input = { ...base, userIds: [actor.userId], dedupeKey: "cle-email" };
    await notify(db, input);
    await notify(db, input);
    expect(await rowsOf(actor.userId)).toHaveLength(0);
    const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, actor.email));
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe("Alerte");
  });

  it("par défaut : dans l'application, pas d'e-mail", async () => {
    const actor = await createTestActor(db, "member");
    await notify(db, { ...base, userIds: [actor.userId], dedupeKey: "cle-defaut" });
    expect(await rowsOf(actor.userId)).toHaveLength(1);
    const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, actor.email));
    expect(mails).toHaveLength(0);
  });

  it("annulée avec la transaction de l'opération", async () => {
    const actor = await createTestActor(db, "member");
    await db
      .transaction(async (tx) => {
        await notify(tx, { ...base, userIds: [actor.userId], dedupeKey: "cle-tx" });
        throw new Error("annulation");
      })
      .catch(() => undefined);
    expect(await rowsOf(actor.userId)).toHaveLength(0);
  });
});

describe("centre de notifications", () => {
  it("ne montre à un compte que les siennes, et les compte", async () => {
    const owner = await createTestContext(db, "member");
    const other = await createTestContext(db, "viewer");
    await notify(db, { ...base, userIds: [owner.actor.userId], dedupeKey: "centre-1" });
    await notify(db, { ...base, userIds: [owner.actor.userId], dedupeKey: "centre-2" });
    const center = await getNotificationCenter(db, owner.actor.userId);
    expect(center.unread).toBe(2);
    expect(center.items).toHaveLength(2);
    expect(center.items[0]?.href).toMatch(/^\/profil\/notifications\//);
    expect((await getNotificationCenter(db, other.actor.userId)).items).toHaveLength(0);
  });

  it("ouvrir marque lue et rend le lien ; celle d'un autre répond 404", async () => {
    const owner = await createTestContext(db, "member");
    const other = await createTestContext(db, "viewer");
    await notify(db, { ...base, userIds: [owner.actor.userId], dedupeKey: "ouvrir" });
    const [row] = await rowsOf(owner.actor.userId);
    if (!row) throw new Error("Notification absente");

    await expect(openNotification(other, row.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await rowsOf(owner.actor.userId))[0]?.readAt).toBeNull();

    expect(await openNotification(owner, row.id)).toEqual({ href: "/sites" });
    expect((await rowsOf(owner.actor.userId))[0]?.readAt).not.toBeNull();
    // Répétable.
    expect(await openNotification(owner, row.id)).toEqual({ href: "/sites" });
  });

  it("ne suit jamais un lien enregistré qui sort de l'application", async () => {
    const owner = await createTestContext(db, "member");
    await notify(db, {
      ...base,
      href: "//exemple.test/phishing",
      userIds: [owner.actor.userId],
      dedupeKey: "externe",
    });
    const [row] = await rowsOf(owner.actor.userId);
    if (!row) throw new Error("Notification absente");
    expect(await openNotification(owner, row.id)).toEqual({ href: null });
  });

  it("tout marquer comme lu, et paginer", async () => {
    const owner = await createTestContext(db, "member");
    for (const key of ["a", "b", "c"]) {
      await notify(db, { ...base, userIds: [owner.actor.userId], dedupeKey: `page-${key}` });
    }
    const page = await listMyNotifications(owner, { page: 2, pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(await markAllNotificationsRead(owner)).toBe(3);
    expect((await listMyNotifications(owner, { unreadOnly: true })).total).toBe(0);
  });
});
