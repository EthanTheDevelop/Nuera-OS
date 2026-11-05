import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAgencyPreviewScope,
  getPortalAccessForCompany,
  inviteClientToPortal,
  issuePortalInvitationLink,
  resendPortalInvitation,
  revokePortalAccess,
  type PortalAccessDeps,
} from "@/modules/portal/portal-access.service";
import {
  getPortalPreferences,
  listPortalRecipients,
  updatePortalProfile,
} from "@/modules/portal/portal.service";
import { buildAuth, type Auth } from "@/server/auth/auth";
import { createPortalLinkIssuer } from "@/server/auth/portal-link";
import { resolvePortalContext } from "@/server/auth/portal-context";
import type { ServiceContext } from "@/server/context";
import {
  accounts,
  auditLog,
  emailOutbox,
  portalMemberships,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createPortalTestContext,
  createProject,
} from "../../helpers/factories";

let db: Database;
let close: () => Promise<void>;
let auth: Auth;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;
let deps: PortalAccessDeps;
let counter = 0;

const BASE = "http://localhost:3000";

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  auth = buildAuth({ db, secret: "s".repeat(32), baseURL: BASE });
  admin = await createTestContext(db, "admin");
  member = await createTestContext(db, "member");
  viewer = await createTestContext(db, "viewer");
  deps = {
    host: "app.nuera.test",
    issueLink: createPortalLinkIssuer({ db, secret: "s".repeat(32), baseURL: BASE }),
  };
});
afterAll(async () => close());

async function newContact() {
  counter += 1;
  const company = await createCompany(db, { status: "client", name: `Société ${counter}` });
  const contact = await createContact(db, {
    companyId: company.id,
    firstName: "Claire",
    lastName: `Nom${counter}`,
    email: `Claire.${counter}@client.test`,
  });
  return { company, contact, email: contact.email?.toLowerCase() ?? "" };
}

const emailsTo = (address: string) =>
  db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, address));

async function urlFromOutbox(address: string): Promise<string> {
  const rows = await emailsTo(address);
  const match = rows.at(-1)?.text?.match(/http\S+/);
  if (!match) throw new Error("Aucun lien");
  return match[0];
}

describe("inviteClientToPortal", () => {
  it("crée le compte, l'adhésion et dépose l'e-mail C1, sans mot de passe", async () => {
    const { company, contact, email } = await newContact();
    await createProject(db, { companyId: company.id, name: "Site vitrine" });

    const result = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );

    expect(result.status).toBe("invited");
    expect(result.delivery?.status).toBe("pending");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    expect(user?.role).toBe("client");
    expect(
      await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, user?.id ?? "")),
    ).toEqual([]);

    const [row] = await emailsTo(email);
    expect(row).toMatchObject({
      subject: "Votre espace projet Nuera est prêt",
      template: "portal_invitation",
      status: "pending",
    });
    expect(row?.text).toContain("Bonjour Claire,");
    expect(row?.text).toContain("Site vitrine");
    expect(row?.html).toContain("Accéder à mon espace");
    expect(row?.text).toContain("/magic-link/verify");

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "portal.invitation_sent"),
          eq(auditLog.entityId, result.membershipId),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("est idempotent : ni second compte, ni seconde adhésion, ni second e-mail", async () => {
    const { company, contact, email } = await newContact();
    const input = { companyId: company.id, contactId: contact.id };
    const first = await inviteClientToPortal(member, input, deps);
    const tokensBefore = (await db.select().from(verifications)).length;
    const second = await inviteClientToPortal(member, input, deps);
    expect(second.membershipId).toBe(first.membershipId);
    expect(await emailsTo(email)).toHaveLength(1);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
    expect((await db.select().from(verifications)).length).toBe(tokensBefore);
  });

  it("le lien ouvre une session, puis ne sert plus, et mène à C9", async () => {
    const { company, contact, email } = await newContact();
    const { membershipId } = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    const url = await urlFromOutbox(email);
    expect(url).toContain("callbackURL=%2Fespace");
    expect(url).toContain("errorCallbackURL=%2Fespace%2Flien-expire");

    const first = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`${BASE}/espace`);
    expect(first.headers.get("set-cookie")).toContain("session_token");

    const replay = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("/espace/lien-expire");

    const [row] = await db
      .select()
      .from(portalMemberships)
      .where(eq(portalMemberships.id, membershipId));
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, row?.userId ?? ""));
    const ctx = await resolvePortalContext(db, {
      userId: user?.id ?? "",
      role: "client",
      name: user?.name ?? "",
      email,
    });
    expect(ctx.companyId).toBe(company.id);
    const [active] = await db
      .select()
      .from(portalMemberships)
      .where(eq(portalMemberships.id, membershipId));
    expect(active?.status).toBe("active");

    const again = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    expect(again.alreadyActive).toBe(true);
    expect(await emailsTo(email)).toHaveLength(1);
  });

  it("un lien expiré mène à C9", async () => {
    const { company, contact, email } = await newContact();
    await inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps);
    const url = await urlFromOutbox(email);
    await db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) });
    const response = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(response.headers.get("location")).toContain("/espace/lien-expire");
  });

  it.each([["viewer", () => viewer]] as const)("refuse le rôle %s", async (_role, get) => {
    const { company, contact } = await newContact();
    await expect(
      inviteClientToPortal(get(), { companyId: company.id, contactId: contact.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuse le prestataire", async () => {
    const contractor = await createTestContext(db, "contractor");
    const { company, contact } = await newContact();
    await expect(
      inviteClientToPortal(contractor, { companyId: company.id, contactId: contact.id }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le contact d'un autre client répond 404", async () => {
    const { contact } = await newContact();
    const other = await createCompany(db);
    await expect(
      inviteClientToPortal(member, { companyId: other.id, contactId: contact.id }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuse un contact sans e-mail", async () => {
    const company = await createCompany(db);
    const contact = await createContact(db, { companyId: company.id, email: null });
    await expect(
      inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuse l'adresse d'un membre de l'équipe : le lien contournerait sa double authentification", async () => {
    const { company, contact } = await newContact();
    await db
      .update(users)
      .set({ email: contact.email?.toLowerCase() ?? "" })
      .where(eq(users.id, viewer.actor.userId));
    await expect(
      inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const memberships = await db
      .select()
      .from(portalMemberships)
      .where(eq(portalMemberships.contactId, contact.id));
    expect(memberships).toEqual([]);
  });

  it("une adresse déjà rattachée à un autre client est refusée, sans dire lequel", async () => {
    const first = await newContact();
    await inviteClientToPortal(
      member,
      { companyId: first.company.id, contactId: first.contact.id },
      deps,
    );
    const company = await createCompany(db, { name: "Autre" });
    const contact = await createContact(db, { companyId: company.id, email: first.email });
    const failure = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    ).catch((error: Error) => error);
    expect(failure).toMatchObject({ code: "CONFLICT" });
    expect((failure as Error).message).not.toContain(first.company.name);
  });
});

describe("état honnête et lien à copier", () => {
  it("la fiche dit « en attente », et rien ne présente l'e-mail comme envoyé", async () => {
    const { company, contact } = await newContact();
    await inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps);
    const overview = await getPortalAccessForCompany(viewer, company.id);
    expect(overview.canManage).toBe(false);
    expect(overview.canCopyLink).toBe(false);
    expect(overview.rows[0]?.membership?.delivery?.status).toBe("pending");
    expect(overview.rows[0]?.membership?.delivery?.sentAt).toBeNull();
  });

  it("renvoyer ne double pas une invitation encore en attente", async () => {
    const { company, contact, email } = await newContact();
    const { membershipId } = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    await resendPortalInvitation(member, { membershipId }, deps);
    expect(await emailsTo(email)).toHaveLength(1);

    await db.update(emailOutbox).set({ status: "failed" }).where(eq(emailOutbox.toAddress, email));
    const resent = await resendPortalInvitation(member, { membershipId }, deps);
    expect(await emailsTo(email)).toHaveLength(2);
    expect(resent.delivery?.status).toBe("pending");
  });

  it("copier le lien : réservé à l'associé, journalisé, jamais stocké en boîte", async () => {
    const { company, contact, email } = await newContact();
    const { membershipId } = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    await expect(issuePortalInvitationLink(member, { membershipId }, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    const { url } = await issuePortalInvitationLink(admin, { membershipId }, deps);
    expect(url).toContain("/magic-link/verify");
    const rows = await emailsTo(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).not.toContain(url);

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "portal.invitation_link_issued"),
          eq(auditLog.entityId, membershipId),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.metadata)).not.toContain("token");

    const response = await auth.handler(new Request(url, { redirect: "manual" }));
    expect(response.headers.get("location")).toBe(`${BASE}/espace`);
  });

  it("la route publique ne peut ni capter un lien ni révéler une adresse", async () => {
    const { company, contact, email } = await newContact();
    await inviteClientToPortal(member, { companyId: company.id, contactId: contact.id }, deps);
    const before = (await emailsTo(email)).length;
    const post = (address: string) =>
      auth.handler(
        new Request(`${BASE}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE },
          body: JSON.stringify({ email: address, callbackURL: "/espace" }),
        }),
      );
    const known = await post(email);
    const unknown = await post("personne@inconnu.test");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text());
    // Le lien part dans la boîte, jamais dans la réponse.
    expect((await emailsTo(email)).length).toBe(before + 1);
    expect(await emailsTo("personne@inconnu.test")).toEqual([]);
  });
});

describe("révocation", () => {
  async function invited() {
    const { company, contact, email } = await newContact();
    const { membershipId } = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    const url = await urlFromOutbox(email);
    await auth.handler(new Request(url, { redirect: "manual" }));
    const [row] = await db
      .select()
      .from(portalMemberships)
      .where(eq(portalMemberships.id, membershipId));
    return { company, contact, email, membershipId, userId: row?.userId ?? "" };
  }

  it("ferme les sessions et coupe l'accès à la requête suivante, une seule trace", async () => {
    const { membershipId, userId, email } = await invited();
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1);

    await revokePortalAccess(member, { membershipId });
    await revokePortalAccess(member, { membershipId });

    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toEqual([]);
    await expect(
      resolvePortalContext(db, { userId, role: "client", name: "x", email }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "portal.membership_revoked"), eq(auditLog.entityId, membershipId)),
      );
    expect(audit).toHaveLength(1);
  });

  it("un compte révoqué ne reçoit plus de lien, ni par la route, ni par copie", async () => {
    const { membershipId, email } = await invited();
    await revokePortalAccess(member, { membershipId });
    const before = (await emailsTo(email)).length;
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ email }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await emailsTo(email)).length).toBe(before);
    await expect(issuePortalInvitationLink(admin, { membershipId }, deps)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(resendPortalInvitation(member, { membershipId }, deps)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("inviter à nouveau rétablit l'accès, avec un nouvel e-mail et une trace", async () => {
    const { company, contact, email, membershipId } = await invited();
    await revokePortalAccess(member, { membershipId });
    const before = (await emailsTo(email)).length;
    const result = await inviteClientToPortal(
      member,
      { companyId: company.id, contactId: contact.id },
      deps,
    );
    expect(result.membershipId).toBe(membershipId);
    expect(result.status).toBe("invited");
    expect((await emailsTo(email)).length).toBe(before + 1);
  });

  it("refuse un rôle sans droit", async () => {
    const { membershipId } = await invited();
    await expect(revokePortalAccess(viewer, { membershipId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("préférences", () => {
  it("sans ligne : tout est activé", async () => {
    const actor = await createTestActor(db, "client");
    const preferences = await getPortalPreferences(db, actor.userId);
    expect(Object.values(preferences).every(Boolean)).toBe(true);
  });

  it("enregistre le nom et les préférences, relues par les automatisations", async () => {
    const client = await createPortalTestContext(db);
    await updatePortalProfile(client, {
      name: "  Claire Martin ",
      notifyMessage: true,
      notifyReport: false,
    });
    const preferences = await getPortalPreferences(db, client.actor.userId);
    expect(preferences).toMatchObject({
      notifyMessage: true,
      notifyValidation: false,
      notifyReport: false,
    });
    const [user] = await db.select().from(users).where(eq(users.id, client.actor.userId));
    expect(user?.name).toBe("Claire Martin");

    const recipients = await listPortalRecipients(db, client.companyId);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.preferences.notifyReport).toBe(false);
  });

  it("refuse un nom vide", async () => {
    const client = await createPortalTestContext(db);
    await expect(updatePortalProfile(client, { name: " " })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("un client révoqué ne figure plus parmi les destinataires", async () => {
    const client = await createPortalTestContext(db);
    await db
      .update(portalMemberships)
      .set({ status: "revoked" })
      .where(eq(portalMemberships.id, client.membership.id));
    expect(await listPortalRecipients(db, client.companyId)).toEqual([]);
  });
});

describe("aperçu de l'agence", () => {
  it("donne le client du projet à qui a projects:read", async () => {
    const project = await createProject(db);
    const scope = await getAgencyPreviewScope(viewer, project.id);
    expect(scope.companyId).toBe(project.companyId);
  });

  it("refuse le prestataire", async () => {
    const contractor = await createTestContext(db, "contractor");
    const project = await createProject(db);
    await expect(getAgencyPreviewScope(contractor, project.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("répond 404 sur un projet inexistant", async () => {
    await expect(
      getAgencyPreviewScope(viewer, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
