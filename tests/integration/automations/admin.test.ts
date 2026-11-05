import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  changeUserRole,
  deactivateUser,
  getPermissionMatrix,
  inviteUser,
  listAuditLog,
  listSensitiveActions,
  listUsers,
  reactivateUser,
  revokeUserSessions,
  sendAccessLink,
} from "@/modules/admin/admin.service";
import {
  checkConnection,
  listConnections,
  type ConnectionGateways,
} from "@/modules/platform/connections.service";
import {
  getAgencyProfile,
  isTwoFactorRequired,
  setTwoFactorRequired,
  updateAgencyProfile,
} from "@/modules/platform/settings.service";
import {
  getProfile,
  revokeAllMySessions,
  revokeMySession,
  updateProfile,
  updateTheme,
} from "@/modules/admin/profile.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import { sendPasswordResetMail } from "@/server/auth/reset-link";
import {
  auditLog,
  emailOutbox,
  notificationPreferences,
  sessions,
  userPreferences,
  users,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ServiceUnavailableError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import { createPortalClient, createTeamMember } from "../../helpers/factories";

let db: Database;
let auth: Auth;

beforeAll(async () => {
  ({ db } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: "http://localhost:3000" });
});

const NEW_PASSWORD = "une-nouvelle-phrase-de-passe";
let counter = 0;
const nextEmail = () => `invite-${(counter += 1)}@exemple.test`;

const noSmtp = () => ({ auth, smtpConfigured: false });
const withSmtp = () => ({ auth, smtpConfigured: true });

async function addSession(userId: string) {
  await db.insert(sessions).values({
    userId,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

describe("invitation", () => {
  it("sans SMTP : rend un lien à usage unique qui marche, journalisé", async () => {
    const admin = await createTestContext(db, "admin");
    const email = nextEmail();
    const invitation = await inviteUser(
      admin,
      { name: "Nouvelle Personne", email, role: "member" },
      noSmtp(),
    );
    expect(invitation.link).toContain("/reset-password/");
    // Aucun faux envoi.
    const mails = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, email));
    expect(mails).toHaveLength(0);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, invitation.userId), eq(auditLog.action, "user.created")));
    expect(audit?.metadata).toMatchObject({ delivery: "copy_link", role: "member" });
    expect(JSON.stringify(audit?.metadata)).not.toContain("/reset-password/");

    // Le lien est valable au-delà de l'heure d'une réinitialisation ordinaire, et se consomme.
    const token = new URL(invitation.link ?? "").pathname.split("/").at(-1) ?? "";
    await auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } });
    const signedIn = await auth.api.signInEmail({ body: { email, password: NEW_PASSWORD } });
    expect(signedIn.user.email).toBe(email);
    await expect(
      auth.api.resetPassword({ body: { token, newPassword: `${NEW_PASSWORD}-2` } }),
    ).rejects.toThrow();
  });

  it("avec SMTP : l'e-mail part en boîte, aucun lien à l'écran", async () => {
    const admin = await createTestContext(db, "admin");
    const email = nextEmail();
    const invitation = await inviteUser(
      admin,
      { name: "Autre Personne", email, role: "viewer" },
      withSmtp(),
    );
    expect(invitation.link).toBeNull();
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, email));
    expect(mail?.template).toBe("user_invitation");
    expect(mail?.text).toContain("/reset-password/");
  });

  it("refuse une adresse déjà utilisée, et le rôle client", async () => {
    const admin = await createTestContext(db, "admin");
    const email = nextEmail();
    await inviteUser(admin, { name: "Une Personne", email, role: "member" }, noSmtp());
    await expect(
      inviteUser(admin, { name: "Une Personne", email, role: "member" }, noSmtp()),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      inviteUser(admin, { name: "Une Personne", email: nextEmail(), role: "client" }, noSmtp()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("réservée à users:manage", async () => {
    for (const role of ["member", "viewer", "contractor"] as const) {
      const ctx = await createTestContext(db, role);
      await expect(
        inviteUser(ctx, { name: "Une Personne", email: nextEmail(), role: "member" }, noSmtp()),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("un lien d'accès vise l'équipe, ni un client ni un compte désactivé", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await createTestActor(db, "member");
    const client = await createPortalClient(db);
    const banned = await createTestActor(db, "viewer");
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId));
    await expect(sendAccessLink(admin, client.actor.userId, noSmtp())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(sendAccessLink(admin, banned.userId, noSmtp())).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(sendAccessLink(admin, crypto.randomUUID(), noSmtp())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await sendAccessLink(admin, member.userId, noSmtp())).link).toContain(
      "/reset-password/",
    );
  });
});

describe("réinitialisation du mot de passe", () => {
  it("la demande publique dépose un e-mail, sauf client et compte désactivé", async () => {
    const member = await createTestActor(db, "member");
    const client = await createTestActor(db, "client");
    const banned = await createTestActor(db, "member");
    await db.update(users).set({ banned: true }).where(eq(users.id, banned.userId));
    const url = "http://localhost:3000/api/auth/reset-password/jeton";

    expect(
      await sendPasswordResetMail(db, { userId: member.userId, email: member.email, url }),
    ).toBe(true);
    expect(
      await sendPasswordResetMail(db, { userId: client.userId, email: client.email, url }),
    ).toBe(false);
    expect(
      await sendPasswordResetMail(db, { userId: banned.userId, email: banned.email, url }),
    ).toBe(false);

    const [mail] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, member.email));
    expect(mail?.template).toBe("password_reset");
    expect(mail?.text).toContain(url);
  });

  it("passe par better-auth : la route réelle dépose le lien", async () => {
    const email = nextEmail();
    const admin = await createTestContext(db, "admin");
    await inviteUser(admin, { name: "Une Personne", email, role: "member" }, noSmtp());
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/login/reinitialiser" },
    });
    const [mail] = await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, email));
    expect(mail?.template).toBe("password_reset");
  });
});

describe("rôles", () => {
  it("change le rôle et journalise", async () => {
    const admin = await createTestContext(db, "admin");
    const target = await createTestActor(db, "viewer");
    await changeUserRole(admin, { userId: target.userId, role: "member" });
    const [user] = await db.select().from(users).where(eq(users.id, target.userId));
    expect(user?.role).toBe("member");
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, target.userId), eq(auditLog.action, "user.role_changed")));
    expect(audit?.metadata).toMatchObject({ from: "viewer", to: "member" });
    // Répétable : pas de seconde trace.
    await changeUserRole(admin, { userId: target.userId, role: "member" });
    expect(
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityId, target.userId), eq(auditLog.action, "user.role_changed"))),
    ).toHaveLength(1);
  });

  it("suit la règle de la fiche d'équipe : prestataire et compte vont ensemble", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createTestActor(db, "contractor");
    await createTeamMember(db, { kind: "contractor", userId: contractor.userId });
    await expect(
      changeUserRole(admin, { userId: contractor.userId, role: "member" }),
    ).rejects.toBeInstanceOf(ConflictError);

    const employee = await createTestActor(db, "member");
    await createTeamMember(db, { kind: "employee", userId: employee.userId });
    await expect(
      changeUserRole(admin, { userId: employee.userId, role: "contractor" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await changeUserRole(admin, { userId: employee.userId, role: "viewer" });
  });

  it("un client garde son rôle ; personne ne devient client", async () => {
    const admin = await createTestContext(db, "admin");
    const client = await createPortalClient(db);
    await expect(
      changeUserRole(admin, { userId: client.actor.userId, role: "member" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const member = await createTestActor(db, "member");
    await expect(
      changeUserRole(admin, { userId: member.userId, role: "client" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("réservé à users:manage, et 404 sur un compte absent", async () => {
    const member = await createTestContext(db, "member");
    const target = await createTestActor(db, "viewer");
    await expect(
      changeUserRole(member, { userId: target.userId, role: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const admin = await createTestContext(db, "admin");
    await expect(
      changeUserRole(admin, { userId: crypto.randomUUID(), role: "admin" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("dernier compte de direction", () => {
  it("ne se retire jamais, ni par le rôle, ni par la désactivation", async () => {
    const { db: fresh } = await createTestDatabase();
    const only = await createTestContext(fresh, "admin");
    const other = await createTestActor(fresh, "admin");

    await changeUserRole(only, { userId: other.userId, role: "member" });
    await expect(
      changeUserRole(only, { userId: only.actor.userId, role: "member" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(deactivateUser(only, only.actor.userId)).rejects.toBeInstanceOf(ConflictError);

    // Un second associé désactivé ne compte pas.
    const third = await createTestActor(fresh, "admin");
    await fresh.update(users).set({ banned: true }).where(eq(users.id, third.userId));
    await expect(
      changeUserRole(only, { userId: only.actor.userId, role: "viewer" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const [user] = await fresh.select().from(users).where(eq(users.id, only.actor.userId));
    expect(user?.role).toBe("admin");
  });

  it("ne peut pas retirer le dernier en désactivant celui qui reste", async () => {
    const { db: fresh } = await createTestDatabase();
    const first = await createTestContext(fresh, "admin");
    const second = await createTestContext(fresh, "admin");
    await deactivateUser(first, second.actor.userId);
    // `first` est désormais seul : un tiers n'a pas le droit, et lui-même non plus.
    await expect(deactivateUser(first, first.actor.userId)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("désactivation", () => {
  it("ferme les sessions, journalise, se répète, se réactive", async () => {
    const admin = await createTestContext(db, "admin");
    const target = await createTestActor(db, "member");
    await addSession(target.userId);
    await addSession(target.userId);

    await deactivateUser(admin, target.userId);
    await deactivateUser(admin, target.userId);

    const [user] = await db.select().from(users).where(eq(users.id, target.userId));
    expect(user?.banned).toBe(true);
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.userId))).toHaveLength(
      0,
    );
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, target.userId), eq(auditLog.action, "user.banned")));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ revoked: 2 });

    await reactivateUser(admin, target.userId);
    const [back] = await db.select().from(users).where(eq(users.id, target.userId));
    expect(back?.banned).toBe(false);
    expect(back?.banReason).toBeNull();
  });

  it("une connexion refusée après désactivation : la session réelle disparaît", async () => {
    const admin = await createTestContext(db, "admin");
    const email = nextEmail();
    const invitation = await inviteUser(
      admin,
      { name: "Une Personne", email, role: "member" },
      noSmtp(),
    );
    const token = new URL(invitation.link ?? "").pathname.split("/").at(-1) ?? "";
    await auth.api.resetPassword({ body: { token, newPassword: NEW_PASSWORD } });
    await auth.api.signInEmail({ body: { email, password: NEW_PASSWORD } });

    await deactivateUser(admin, invitation.userId);
    await expect(
      auth.api.signInEmail({ body: { email, password: NEW_PASSWORD } }),
    ).rejects.toThrow();
  });

  it("interdit sur soi-même, réservé à users:manage", async () => {
    const admin = await createTestContext(db, "admin");
    await createTestActor(db, "admin");
    await expect(deactivateUser(admin, admin.actor.userId)).rejects.toBeInstanceOf(ConflictError);
    const member = await createTestContext(db, "member");
    await expect(deactivateUser(member, admin.actor.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokeUserSessions(member, admin.actor.userId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("ferme les sessions d'un compte sur demande", async () => {
    const admin = await createTestContext(db, "admin");
    const target = await createTestActor(db, "member");
    await addSession(target.userId);
    expect(await revokeUserSessions(admin, target.userId)).toBe(1);
  });
});

describe("lectures de l'écran 24", () => {
  it("liste paginée, sans rien de l'authentification", async () => {
    const admin = await createTestContext(db, "admin");
    const page = await listUsers(admin, { pageSize: 2 });
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.total).toBeGreaterThan(0);
    const keys = Object.keys(page.items[0] ?? {});
    expect(keys).not.toContain("password");
    expect(keys).toContain("twoFactorEnabled");
    await expect(listUsers(await createTestContext(db, "member"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("la dernière connexion vient du journal, compte par compte", async () => {
    const { db: fresh } = await createTestDatabase();
    const admin = await createTestContext(fresh, "admin");
    const other = await createTestActor(fresh, "member");
    const at = new Date("2030-02-03T10:00:00Z");
    await fresh.insert(auditLog).values({
      actorId: other.userId,
      action: "auth.signed_in",
      entityType: "user",
      entityId: other.userId,
      occurredAt: at,
    });
    const { items } = await listUsers(admin);
    expect(items.find((row) => row.id === other.userId)?.lastSignInAt).toEqual(at);
    expect(items.find((row) => row.id === admin.actor.userId)?.lastSignInAt).toBeNull();
  });

  it("la matrice lit les vraies permissions", async () => {
    const admin = await createTestContext(db, "admin");
    const matrix = getPermissionMatrix(admin);
    const finance = matrix.find((row) => row.label === "Voir les finances");
    expect(finance?.roles).toMatchObject({ admin: true, member: false, viewer: false });
    const projects = matrix.find((row) => row.label === "Voir les projets et documents");
    expect(projects?.roles).toMatchObject({ contractor: true, viewer: true, client: true });
    expect(() =>
      getPermissionMatrix({ ...admin, actor: { ...admin.actor, role: "viewer" } }),
    ).toThrow(ForbiddenError);
  });

  it("journal : filtres, pagination, permission", async () => {
    const { db: fresh } = await createTestDatabase();
    const admin = await createTestContext(fresh, "admin");
    const target = await createTestActor(fresh, "viewer");
    await changeUserRole(admin, { userId: target.userId, role: "member" });
    await updateAgencyProfile(admin, { name: "Nuera" });

    const all = await listAuditLog(admin, { pageSize: 1 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(1);

    const accounts = await listAuditLog(admin, { group: "comptes" });
    expect(accounts.items.map((row) => row.action)).toEqual(["user.role_changed"]);
    expect(accounts.items[0]?.label).toBe("Rôle modifié");
    expect(accounts.items[0]?.actorName).toBe(admin.actor.name);

    const byActor = await listAuditLog(admin, { actorId: target.userId });
    expect(byActor.total).toBe(0);
    const future = await listAuditLog(admin, { from: "2999-01-01" });
    expect(future.total).toBe(0);

    expect((await listSensitiveActions(admin)).length).toBe(2);
    const member = await createTestContext(fresh, "member");
    await expect(listAuditLog(member)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("double authentification exigée", () => {
  it("par défaut : en production seulement ; le réglage l'emporte", async () => {
    const { db: fresh } = await createTestDatabase();
    expect(await isTwoFactorRequired(fresh, "production")).toBe(true);
    expect(await isTwoFactorRequired(fresh, "development")).toBe(false);
    const admin = await createTestContext(fresh, "admin");
    await fresh
      .update(users)
      .set({ twoFactorEnabled: true })
      .where(eq(users.id, admin.actor.userId));
    await setTwoFactorRequired(admin, true);
    expect(await isTwoFactorRequired(fresh, "development")).toBe(true);
    await setTwoFactorRequired(admin, false);
    expect(await isTwoFactorRequired(fresh, "production")).toBe(false);
    const member = await createTestContext(fresh, "member");
    await expect(setTwoFactorRequired(member, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuse de l'exiger à qui ne l'a pas : son auteur ne pourrait plus revenir en arrière", async () => {
    const { db: fresh } = await createTestDatabase();
    const admin = await createTestContext(fresh, "admin");
    await expect(setTwoFactorRequired(admin, true)).rejects.toBeInstanceOf(ConflictError);
    expect(await isTwoFactorRequired(fresh, "development")).toBe(false);
    await setTwoFactorRequired(admin, false);
    expect(await isTwoFactorRequired(fresh, "development")).toBe(false);
  });
});

describe("fiche de l'agence", () => {
  it("se lit, s'écrit, et se réserve à admin:manage", async () => {
    const { db: fresh } = await createTestDatabase();
    expect((await getAgencyProfile(fresh)).name).toBe("Nuera Studio");
    const admin = await createTestContext(fresh, "admin");
    await updateAgencyProfile(admin, { name: "Nuera", replyTo: "contact@exemple.test" });
    expect((await getAgencyProfile(fresh)).replyTo).toBe("contact@exemple.test");
    await expect(updateAgencyProfile(admin, { name: "" })).rejects.toBeInstanceOf(ValidationError);
    const member = await createTestContext(fresh, "member");
    await expect(updateAgencyProfile(member, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("connexions", () => {
  const unconfigured = {
    isConfigured: false,
    send: async () => ({ messageId: "" }),
    verify: async () => undefined,
  };

  function gateways(overrides: Partial<ConnectionGateways> = {}): ConnectionGateways {
    return {
      crm: { isConfigured: false } as ConnectionGateways["crm"],
      coolify: { isConfigured: false } as ConnectionGateways["coolify"],
      uptimeKuma: { isConfigured: false } as ConnectionGateways["uptimeKuma"],
      docuseal: { isConfigured: false } as ConnectionGateways["docuseal"],
      text: { isConfigured: false } as ConnectionGateways["text"],
      smtp: unconfigured,
      n8n: { isConfigured: false, send: async () => undefined },
      calConfigured: false,
      ...overrides,
    };
  }

  it("Indy reste « API à vérifier », un service sans config n'est jamais connecté", async () => {
    const { db: fresh } = await createTestDatabase();
    const ctx = await createTestContext(fresh, "member");
    const views = await listConnections(ctx, { gateways: gateways() });
    expect(views.find((row) => row.service === "indy")).toMatchObject({
      status: "to_verify",
      label: "API à vérifier",
    });
    expect(views.find((row) => row.service === "n8n")?.label).toBe("Optionnel");
    expect(views.find((row) => row.service === "docuseal")?.status).toBe("not_configured");
    for (const service of ["figma", "google"]) {
      expect(views.some((row) => (row.service as string) === service)).toBe(false);
    }
  });

  it("une vérification est un vrai appel, datée, et son échec est écrit", async () => {
    const { db: fresh } = await createTestDatabase();
    const ctx = await createTestContext(fresh, "admin");
    let up = true;
    const smtp = {
      isConfigured: true,
      send: async () => ({ messageId: "" }),
      verify: async () => {
        if (!up) throw new ServiceUnavailableError("smtp", "unreachable", "Injoignable.");
      },
    };
    const deps = { gateways: gateways({ smtp }) };
    expect(await checkConnection(ctx, "smtp", deps)).toBe("connected");
    let view = (await listConnections(ctx, deps)).find((row) => row.service === "smtp");
    expect(view).toMatchObject({ status: "connected", lastError: null });
    expect(view?.lastCheckAt).toBeInstanceOf(Date);
    const success = view?.lastSuccessAt;

    up = false;
    expect(await checkConnection(ctx, "smtp", deps)).toBe("unavailable");
    view = (await listConnections(ctx, deps)).find((row) => row.service === "smtp");
    expect(view).toMatchObject({ status: "unavailable", lastError: "Injoignable." });
    expect(view?.lastSuccessAt).toEqual(success);

    // La configuration retirée l'emporte sur la dernière valeur écrite.
    view = (await listConnections(ctx, { gateways: gateways() })).find(
      (row) => row.service === "smtp",
    );
    expect(view?.status).toBe("not_configured");
  });

  it("vérifier est réservé à integrations:manage, lire à integrations:read", async () => {
    const member = await createTestContext(db, "member");
    await expect(checkConnection(member, "smtp", { gateways: gateways() })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const viewer = await createTestContext(db, "viewer");
    await expect(listConnections(viewer, { gateways: gateways() })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const admin = await createTestContext(db, "admin");
    await expect(checkConnection(admin, "figma", { gateways: gateways() })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("profil", () => {
  const input = {
    theme: "dark",
    accent: "chatgpt",
    density: "compact",
    homePath: "/projets",
    dailyDigest: true,
    preferences: [
      { kind: "site_down", inApp: true, email: true },
      { kind: "payment", inApp: false, email: true },
    ],
  };
  const options = { allowedHomePaths: ["/", "/projets"] };

  it("le thème choisi au menu est celui que /profil relit, sans toucher au reste", async () => {
    const ctx = await createTestContext(db, "admin");
    await updateProfile(ctx, input, options);
    await updateTheme(ctx, "light");
    const profile = await getProfile(ctx, { currentSessionId: null, nodeEnv: "development" });
    expect(profile.appearance).toMatchObject({
      theme: "light",
      accent: "chatgpt",
      density: "compact",
      homePath: "/projets",
    });

    const fresh = await createTestContext(db, "viewer");
    await updateTheme(fresh, "dark");
    const created = await getProfile(fresh, { currentSessionId: null, nodeEnv: "development" });
    expect(created.appearance.theme).toBe("dark");
    await expect(updateTheme(fresh, "fuchsia")).rejects.toThrow(ValidationError);
  });

  it("enregistre tout, et se relit", async () => {
    const ctx = await createTestContext(db, "admin");
    await updateProfile(ctx, input, options);
    await updateProfile(ctx, input, options);
    const profile = await getProfile(ctx, { currentSessionId: null, nodeEnv: "development" });
    expect(profile.appearance).toMatchObject({
      theme: "dark",
      accent: "chatgpt",
      density: "compact",
      homePath: "/projets",
    });
    expect(profile.dailyDigest).toBe(true);
    expect(profile.notifications.find((row) => row.kind === "payment")).toMatchObject({
      inApp: false,
      email: true,
    });
    expect(
      await db.select().from(userPreferences).where(eq(userPreferences.userId, ctx.actor.userId)),
    ).toHaveLength(1);
  });

  it("refuse une page d'accueil interdite, et un type d'alerte hors de ses droits", async () => {
    const contractor = await createTestContext(db, "contractor");
    await expect(
      updateProfile(contractor, { ...input, homePath: "/finances" }, options),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateProfile(contractor, input, options);
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, contractor.actor.userId));
    expect(rows.some((row) => row.kind === "payment")).toBe(false);
    const profile = await getProfile(contractor, {
      currentSessionId: null,
      nodeEnv: "development",
    });
    expect(profile.notifications.some((row) => row.kind === "payment")).toBe(false);
  });

  it("sessions : les siennes seulement, la courante marquée, fermeture ciblée ou totale", async () => {
    const ctx = await createTestContext(db, "member");
    const other = await createTestContext(db, "member");
    await addSession(ctx.actor.userId);
    await addSession(ctx.actor.userId);
    await addSession(other.actor.userId);
    const [theirs] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, other.actor.userId));
    if (!theirs) throw new Error("Session absente");
    await expect(revokeMySession(ctx, theirs.id)).rejects.toBeInstanceOf(NotFoundError);

    const mine = await db.select().from(sessions).where(eq(sessions.userId, ctx.actor.userId));
    const first = mine[0];
    if (!first) throw new Error("Session absente");
    const profile = await getProfile(ctx, { currentSessionId: first.id, nodeEnv: "development" });
    expect(profile.sessions).toHaveLength(2);
    expect(profile.sessions.filter((row) => row.current).map((row) => row.id)).toEqual([first.id]);

    await revokeMySession(ctx, first.id);
    expect(await revokeAllMySessions(ctx)).toBe(1);
    expect(
      await db.select().from(sessions).where(eq(sessions.userId, other.actor.userId)),
    ).toHaveLength(1);
  });
});
