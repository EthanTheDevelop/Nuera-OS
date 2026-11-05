import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { APPOINTMENT_TRANSITIONS } from "@/modules/appointments/appointment.status";
import {
  changeAppointmentStatus,
  createAppointment,
  getAppointment,
  getAppointmentCounts,
  getCompanyLinkOptions,
  getNextAppointment,
  listAppointments,
  listAppointmentsForCompany,
  listAppointmentsForPortal,
  listUpcomingAppointments,
  updateAppointment,
} from "@/modules/appointments/appointment.service";
import { processCalWebhook, signCalBody } from "@/modules/appointments/cal-webhook";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContact,
  createMemberContext,
  createOpportunity,
  createPortalTestContext,
  createProject,
} from "../../helpers/factories";

const SECRET = "secret-de-webhook-de-test";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

describe("rendez-vous", () => {
  let db: Database;
  let admin: Awaited<ReturnType<typeof createMemberContext>>;
  let viewer: ServiceContext;
  let contractor: ServiceContext;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    admin = await createMemberContext(db, "admin");
    viewer = await createTestContext(db, "viewer");
    contractor = await createMemberContext(db, "contractor");
  });

  const base = (overrides: Record<string, unknown> = {}) => ({
    title: "Point",
    startsAt: inDays(2),
    durationMinutes: 30,
    ...overrides,
  });

  describe("création manuelle", () => {
    it("crée, relie au client et journalise", async () => {
      const company = await createCompany(db);
      const contact = await createContact(db, { companyId: company.id });
      const { id } = await createAppointment(
        admin,
        base({
          companyId: company.id,
          contactId: contact.id,
          memberIds: [admin.member.id],
          channel: "Visio",
        }),
      );
      const view = await getAppointment(admin, id);
      expect(view).toMatchObject({
        source: "manual",
        status: "planned",
        companyId: company.id,
        contactId: contact.id,
        memberNames: [admin.member.fullName],
      });
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
      expect(audit.map((row) => row.action)).toEqual(["appointment.created"]);
    });

    it("déduit le client d'un projet ou d'une affaire", async () => {
      const company = await createCompany(db);
      const project = await createProject(db, { companyId: company.id });
      const opportunity = await createOpportunity(db, { companyId: company.id });
      const a = await createAppointment(admin, base({ projectId: project.id }));
      const b = await createAppointment(admin, base({ opportunityId: opportunity.id }));
      expect((await getAppointment(admin, a.id)).companyId).toBe(company.id);
      expect((await getAppointment(admin, b.id)).companyId).toBe(company.id);
    });

    it("accepte une affaire sans client", async () => {
      const opportunity = await createOpportunity(db, { companyId: null });
      const { id } = await createAppointment(admin, base({ opportunityId: opportunity.id }));
      expect((await getAppointment(admin, id)).companyId).toBeNull();
    });

    it("exige un rattachement", async () => {
      await expect(createAppointment(admin, base())).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuse tout lien vers un autre client", async () => {
      const company = await createCompany(db);
      const other = await createCompany(db);
      const project = await createProject(db, { companyId: other.id });
      const contact = await createContact(db, { companyId: other.id });
      const opportunity = await createOpportunity(db, { companyId: other.id });
      for (const link of [
        { projectId: project.id },
        { contactId: contact.id },
        { opportunityId: opportunity.id },
      ]) {
        await expect(
          createAppointment(admin, base({ companyId: company.id, ...link })),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it("refuse un participant inconnu, une durée ou une date invalide", async () => {
      const company = await createCompany(db);
      const companyId = company.id;
      await expect(
        createAppointment(admin, base({ companyId, memberIds: [crypto.randomUUID()] })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createAppointment(admin, base({ companyId, durationMinutes: 0 })),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createAppointment(admin, base({ companyId, startsAt: "pas une date" })),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("idempotence : un double envoi ne crée qu'un rendez-vous", async () => {
      const company = await createCompany(db);
      const clientRequestId = crypto.randomUUID();
      const input = base({ companyId: company.id, clientRequestId });
      const first = await createAppointment(admin, input);
      const second = await createAppointment(admin, input);
      expect(second.id).toBe(first.id);
      const rows = await db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.companyId, company.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("modification", () => {
    it("modifie un rendez-vous prévu", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await updateAppointment(
        admin,
        id,
        base({ companyId: company.id, title: "Point déplacé", durationMinutes: 45 }),
      );
      expect(await getAppointment(admin, id)).toMatchObject({
        title: "Point déplacé",
        durationMinutes: 45,
      });
    });

    it("refuse de modifier un rendez-vous terminé, et de déplacer un rendez-vous Cal", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, id, "done");
      await expect(
        updateAppointment(admin, id, base({ companyId: company.id })),
      ).rejects.toBeInstanceOf(ConflictError);

      const startsAt = inDays(3);
      const [cal] = await db
        .insert(schema.appointments)
        .values({
          companyId: company.id,
          title: "Pris en ligne",
          startsAt,
          source: "cal",
          externalId: `cal-${crypto.randomUUID()}`,
        })
        .returning();
      await expect(
        updateAppointment(admin, cal?.id ?? "", base({ companyId: company.id })),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        updateAppointment(
          admin,
          cal?.id ?? "",
          base({ companyId: company.id, startsAt, title: "Renommé" }),
        ),
      ).resolves.toBeUndefined();
    });

    it("répond 404 pour un rendez-vous inconnu", async () => {
      await expect(getAppointment(admin, crypto.randomUUID())).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getAppointment(admin, "abc")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("machine à états", () => {
    it("décrit tous les passages autorisés", () => {
      expect(APPOINTMENT_TRANSITIONS).toEqual({
        planned: ["done", "cancelled"],
        done: [],
        cancelled: ["planned"],
      });
    });

    it.each([
      ["planned", "done"],
      ["planned", "cancelled"],
    ] as const)("%s → %s", async (_from, to) => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, id, to);
      expect((await getAppointment(admin, id)).status).toBe(to);
    });

    it("cancelled → planned, avec la bonne trace", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, id, "cancelled");
      await changeAppointmentStatus(admin, id, "planned");
      expect((await getAppointment(admin, id)).status).toBe("planned");
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
      expect(audit.map((row) => row.action)).toEqual([
        "appointment.created",
        "appointment.cancelled",
        "appointment.updated",
      ]);
    });

    it("refuse done → planned, done → cancelled et cancelled → done", async () => {
      const company = await createCompany(db);
      const a = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, a.id, "done");
      await expect(changeAppointmentStatus(admin, a.id, "planned")).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(changeAppointmentStatus(admin, a.id, "cancelled")).rejects.toBeInstanceOf(
        ConflictError,
      );
      const b = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, b.id, "cancelled");
      await expect(changeAppointmentStatus(admin, b.id, "done")).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("redemander le statut courant ne fait rien", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, id, "done");
      await changeAppointmentStatus(admin, id, "done");
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
      expect(audit).toHaveLength(2);
    });
  });

  describe("lecture", () => {
    it("sépare à venir, passés et annulés, avec pagination et compteurs", async () => {
      const company = await createCompany(db);
      const companyId = company.id;
      const upcoming = await createAppointment(admin, base({ companyId, title: "Bientôt" }));
      const past = await createAppointment(admin, base({ companyId, startsAt: inDays(-3) }));
      const cancelled = await createAppointment(admin, base({ companyId }));
      await changeAppointmentStatus(admin, cancelled.id, "cancelled");

      const ids = async (scope: "upcoming" | "past" | "cancelled") =>
        (await listAppointments(admin, { scope, companyId })).items.map((item) => item.id);
      expect(await ids("upcoming")).toEqual([upcoming.id]);
      expect(await ids("past")).toEqual([past.id]);
      expect(await ids("cancelled")).toEqual([cancelled.id]);

      const counts = await getAppointmentCounts(admin);
      expect(counts.upcoming).toBeGreaterThan(0);

      const page = await listAppointments(admin, { scope: "upcoming", pageSize: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.pageSize).toBe(1);
    });

    it("donne les prochains rendez-vous dans l'ordre, sans les passés ni les annulés", async () => {
      const company = await createCompany(db);
      const companyId = company.id;
      const later = await createAppointment(admin, base({ companyId, startsAt: inDays(1) }));
      const sooner = await createAppointment(
        admin,
        base({ companyId, startsAt: new Date(Date.now() + 60_000) }),
      );
      await createAppointment(admin, base({ companyId, startsAt: inDays(-1) }));

      const rows = await listUpcomingAppointments(db, { limit: 100 });
      const ids = rows.map((row) => row.id);
      expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));
      expect(rows.every((row) => row.status === "planned")).toBe(true);
      expect(await listUpcomingAppointments(db, { limit: 1 })).toHaveLength(1);
    });

    it("trouve le prochain rendez-vous d'un projet, sans ceux d'un autre projet", async () => {
      const company = await createCompany(db);
      const a = await createProject(db, { companyId: company.id });
      const b = await createProject(db, { companyId: company.id });
      const other = await createAppointment(
        admin,
        base({ projectId: b.id, startsAt: inDays(1), title: "Autre projet" }),
      );
      const next = await createAppointment(
        admin,
        base({ projectId: a.id, startsAt: inDays(2), title: "Ce projet" }),
      );
      const found = await getNextAppointment(admin, { companyId: company.id, projectId: a.id });
      expect(found?.id).toBe(next.id);
      expect(found?.id).not.toBe(other.id);
    });

    it("résume les rendez-vous d'un client, sans les annulés", async () => {
      const company = await createCompany(db);
      const kept = await createAppointment(admin, base({ companyId: company.id }));
      const cancelled = await createAppointment(admin, base({ companyId: company.id }));
      await changeAppointmentStatus(admin, cancelled.id, "cancelled");
      const rows = await listAppointmentsForCompany(admin, company.id, { limit: 5 });
      expect(rows.map((row) => row.id)).toEqual([kept.id]);
    });

    it("donne les options de rattachement d'un client", async () => {
      const company = await createCompany(db);
      await createProject(db, { companyId: company.id, name: "Projet choisi" });
      await createOpportunity(db, { companyId: company.id, name: "Affaire choisie" });
      const options = await getCompanyLinkOptions(admin, company.id);
      expect(options.projects.map((item) => item.name)).toEqual(["Projet choisi"]);
      expect(options.opportunities.map((item) => item.name)).toEqual(["Affaire choisie"]);
    });
  });

  describe("portail", () => {
    it("ne donne que les rendez-vous visibles de son client, sans les annulés", async () => {
      const company = await createCompany(db);
      const portal = await createPortalTestContext(db, { company });
      const other = await createCompany(db);
      const mine = await createAppointment(
        admin,
        base({ companyId: company.id, memberIds: [admin.member.id], clientVisible: "on" }),
      );
      const cancelled = await createAppointment(
        admin,
        base({ companyId: company.id, clientVisible: "on" }),
      );
      // La case est décochée par défaut : un rendez-vous interne reste invisible.
      await createAppointment(admin, base({ companyId: company.id, title: "Interne" }));
      await changeAppointmentStatus(admin, cancelled.id, "cancelled");
      await createAppointment(
        admin,
        base({ companyId: other.id, title: "Autre client", clientVisible: "on" }),
      );

      const rows = await listAppointmentsForPortal(portal);
      expect(rows.map((row) => row.id)).toEqual([mine.id]);
      expect(rows[0]?.memberNames).toEqual([admin.member.fullName]);
      expect(rows[0]).not.toHaveProperty("memberIds");
      expect(rows[0]).not.toHaveProperty("externalId");
    });
  });

  describe("permissions", () => {
    it("lecture seule : lit, n'écrit pas", async () => {
      const company = await createCompany(db);
      const { id } = await createAppointment(admin, base({ companyId: company.id }));
      await expect(getAppointment(viewer, id)).resolves.toBeTruthy();
      await expect(
        createAppointment(viewer, base({ companyId: company.id })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(changeAppointmentStatus(viewer, id, "done")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(getCompanyLinkOptions(viewer, company.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("prestataire et client : aucun accès", async () => {
      const client = await createTestContext(db, "client");
      for (const ctx of [contractor, client]) {
        await expect(listAppointments(ctx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(getAppointmentCounts(ctx)).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("webhook Cal", () => {
    const bookingBody = (overrides: Record<string, unknown> = {}, trigger = "BOOKING_CREATED") =>
      JSON.stringify({
        triggerEvent: trigger,
        createdAt: "2026-11-04T10:00:00.000Z",
        payload: {
          uid: `uid-${crypto.randomUUID()}`,
          title: "Découverte",
          startTime: "2026-12-01T09:00:00.000Z",
          endTime: "2026-12-01T09:45:00.000Z",
          location: "integrations:daily",
          attendees: [{ email: "inconnu@test.local", name: "Inconnu" }],
          organizer: { email: "personne@test.local" },
          ...overrides,
        },
      });

    const send = (body: string, secret: string = SECRET, signature?: string | null) =>
      processCalWebhook(
        db,
        secret,
        body,
        signature === undefined ? signCalBody(SECRET, body) : signature,
      );

    const byExternalId = async (externalId: string) => {
      const [row] = await db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.externalId, externalId));
      return row;
    };

    it("sans secret, la route n'existe pas", async () => {
      const body = bookingBody();
      const result = await processCalWebhook(db, undefined, body, signCalBody(SECRET, body));
      expect(result).toMatchObject({ status: 404 });
    });

    it("refuse une signature absente, fausse, ou « no-secret-provided »", async () => {
      const body = bookingBody();
      expect(await send(body, SECRET, null)).toMatchObject({ status: 401 });
      expect(await send(body, SECRET, "abc")).toMatchObject({ status: 401 });
      expect(await send(body, SECRET, "no-secret-provided")).toMatchObject({ status: 401 });
      expect(await send(body, SECRET, signCalBody("autre-secret-de-test", body))).toMatchObject({
        status: 401,
      });
      expect(await send(`${body} `, SECRET, signCalBody(SECRET, body))).toMatchObject({
        status: 401,
      });
    });

    it("refuse un corps illisible, même bien signé", async () => {
      expect(await send("pas du json")).toMatchObject({ status: 400 });
      expect(await send(JSON.stringify({ payload: {} }))).toMatchObject({ status: 400 });
    });

    it("ignore un événement sans rapport", async () => {
      const body = bookingBody({}, "MEETING_ENDED");
      expect(await send(body)).toEqual({ status: 200, body: { outcome: "ignored" } });
    });

    it("crée un rendez-vous sans fiche pour un inconnu, avec durée et visio", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      expect(await send(bookingBody({ uid }))).toEqual({
        status: 200,
        body: { outcome: "created" },
      });
      const row = await byExternalId(uid);
      expect(row).toMatchObject({
        source: "cal",
        title: "Découverte",
        clientVisible: false,
        durationMinutes: 45,
        channel: "Visio",
        location: null,
        companyId: null,
        contactId: null,
      });
      const audit = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.entityId, row?.id ?? ""));
      expect(audit[0]).toMatchObject({ action: "appointment.created", actorId: null });
    });

    it("retrouve le contact et le participant par e-mail", async () => {
      const company = await createCompany(db);
      const contact = await createContact(db, {
        companyId: company.id,
        email: "claire.cal@test.local",
      });
      const uid = `uid-${crypto.randomUUID()}`;
      await send(
        bookingBody({
          uid,
          attendees: [{ email: "CLAIRE.CAL@test.local" }],
          organizer: { email: admin.actor.email },
          location: "12 rue de la Paix",
        }),
      );
      const row = await byExternalId(uid);
      expect(row).toMatchObject({
        companyId: company.id,
        contactId: contact.id,
        memberIds: [admin.member.id],
        location: "12 rue de la Paix",
        channel: null,
      });
    });

    it("idempotence : une relivraison ne crée rien", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      const body = bookingBody({ uid });
      await send(body);
      expect(await send(body)).toEqual({ status: 200, body: { outcome: "duplicate" } });
      const rows = await db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.externalId, uid));
      expect(rows).toHaveLength(1);
    });

    it("un déplacement met à jour le même rendez-vous et son identifiant", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      await send(bookingBody({ uid }));
      const original = await byExternalId(uid);

      const nextUid = `uid-${crypto.randomUUID()}`;
      const moved = await send(
        bookingBody(
          {
            uid: nextUid,
            rescheduleUid: uid,
            startTime: "2026-12-03T14:00:00.000Z",
            endTime: "2026-12-03T14:30:00.000Z",
          },
          "BOOKING_RESCHEDULED",
        ),
      );
      expect(moved.body).toEqual({ outcome: "updated" });
      const row = await byExternalId(nextUid);
      expect(row?.id).toBe(original?.id);
      expect(row?.durationMinutes).toBe(30);
      expect(row?.startsAt.toISOString()).toBe("2026-12-03T14:00:00.000Z");
      expect(await byExternalId(uid)).toBeUndefined();
    });

    it("un déplacement dont l'origine est inconnue crée le rendez-vous", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      const result = await send(
        bookingBody({ uid, rescheduleUid: "uid-inconnu" }, "BOOKING_RESCHEDULED"),
      );
      expect(result.body).toEqual({ outcome: "created" });
      expect(await byExternalId(uid)).toBeTruthy();
    });

    it("une annulation annule, se répète sans effet, et ignore un inconnu", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      await send(bookingBody({ uid }));
      const body = bookingBody({ uid }, "BOOKING_CANCELLED");
      expect((await send(body)).body).toEqual({ outcome: "cancelled" });
      expect((await byExternalId(uid))?.status).toBe("cancelled");
      expect((await send(body)).body).toEqual({ outcome: "duplicate" });
      const unknown = bookingBody({}, "BOOKING_CANCELLED");
      expect((await send(unknown)).body).toEqual({ outcome: "ignored" });
    });

    it("n'annule pas un rendez-vous déjà tenu", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      await send(bookingBody({ uid }));
      const row = await byExternalId(uid);
      await changeAppointmentStatus(admin, row?.id ?? "", "done");
      const result = await send(bookingBody({ uid }, "BOOKING_CANCELLED"));
      expect(result.body).toEqual({ outcome: "ignored" });
      expect((await byExternalId(uid))?.status).toBe("done");
    });

    it("un échec interne répond 500 et n'enregistre pas l'accusé : Cal peut relivrer", async () => {
      const uid = `uid-${crypto.randomUUID()}`;
      const body = bookingBody({ uid });
      const broken = {
        transaction: () => Promise.reject(new Error("base indisponible")),
      } as unknown as Database;
      const failed = await processCalWebhook(broken, SECRET, body, signCalBody(SECRET, body));
      expect(failed.status).toBe(500);
      expect((await send(body)).body).toEqual({ outcome: "created" });
    });
  });
});
