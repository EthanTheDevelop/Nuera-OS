import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { listContactOptions, listCompanyOptions } from "@/modules/crm/company.lookup";
import { getMembersByIds, listAssignableMembers } from "@/modules/team/team.lookup";
import { assertCan, assertCanAny } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import * as repository from "./appointment.repository";
import type { AppointmentRow } from "./appointment.repository";
import {
  appointmentStatusSchema,
  createAppointmentSchema,
  updateAppointmentSchema,
  type AppointmentScope,
  type CalWebhookEvent,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
} from "./appointment.schema";
import { assertAppointmentTransition, canAppointmentTransition } from "./appointment.status";

/**
 * Rendez-vous : saisie interne et, en option, webhook Cal (A9). Pas de permission dédiée dans la
 * matrice : ils se rangent avec les échanges (`messages:read`, `messages:send`) ; la fiche client
 * et les affaires les lisent aussi avec `crm:read`. Un prestataire n'y a pas accès.
 */
const READ = ["messages:read", "crm:read"] as const;
const MAX_LIMIT = 100;

function toUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new NotFoundError();
  return parsed.data;
}

export interface AppointmentView {
  id: string;
  title: string;
  kind: string | null;
  startsAt: Date;
  durationMinutes: number;
  channel: string | null;
  location: string | null;
  memberIds: string[];
  memberNames: string[];
  source: "manual" | "cal";
  status: "planned" | "done" | "cancelled";
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  projectId: string | null;
  projectName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
}

async function toViews(db: Database, rows: AppointmentRow[]): Promise<AppointmentView[]> {
  const members = await getMembersByIds(db, [...new Set(rows.flatMap((row) => row.memberIds))]);
  const names = new Map(members.map((member) => [member.id, member.fullName]));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    startsAt: row.startsAt,
    durationMinutes: row.durationMinutes,
    channel: row.channel,
    location: row.location,
    memberIds: row.memberIds,
    memberNames: row.memberIds.flatMap((id) => {
      const name = names.get(id);
      return name ? [name] : [];
    }),
    source: row.source,
    status: row.status,
    companyId: row.companyId,
    companyName: row.companyName,
    contactId: row.contactId,
    contactName: [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ") || null,
    projectId: row.projectId,
    projectName: row.projectName,
    opportunityId: row.opportunityId,
    opportunityName: row.opportunityName,
  }));
}

// --- Lecture -----------------------------------------------------------------------------------

export async function listAppointments(
  ctx: ServiceContext,
  query: {
    scope?: AppointmentScope;
    companyId?: string;
    opportunityId?: string;
    page?: unknown;
    pageSize?: unknown;
  } = {},
): Promise<Paginated<AppointmentView>> {
  assertCanAny(ctx.actor, READ);
  const params = parsePagination(query);
  const result = await repository.listAppointments(
    ctx.db,
    {
      scope: query.scope ?? "upcoming",
      companyId: query.companyId ? toUuid(query.companyId) : undefined,
      opportunityId: query.opportunityId ? toUuid(query.opportunityId) : undefined,
      now: new Date(),
    },
    params,
  );
  return { ...result, items: await toViews(ctx.db, result.items) };
}

export async function getAppointmentCounts(
  ctx: ServiceContext,
  filter: { companyId?: string; opportunityId?: string } = {},
) {
  assertCanAny(ctx.actor, READ);
  return repository.countByScope(ctx.db, new Date(), {
    companyId: filter.companyId ? toUuid(filter.companyId) : undefined,
    opportunityId: filter.opportunityId ? toUuid(filter.opportunityId) : undefined,
  });
}

export async function getAppointment(ctx: ServiceContext, id: string): Promise<AppointmentView> {
  assertCanAny(ctx.actor, READ);
  const row = await repository.findAppointment(ctx.db, toUuid(id));
  if (!row) throw new NotFoundError();
  const [view] = await toViews(ctx.db, [row]);
  if (!view) throw new NotFoundError();
  return view;
}

/** Résumé pour la fiche client 360° et l'écran d'une affaire. */
export async function listAppointmentsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<AppointmentView[]> {
  assertCanAny(ctx.actor, READ);
  const rows = await repository.listForCompany(
    ctx.db,
    toUuid(companyId),
    Math.min(options.limit ?? 5, MAX_LIMIT),
  );
  return toViews(ctx.db, rows);
}

/** Réunions liées à une affaire (03.03.02) : l'écran d'une affaire et sa vue filtrée. */
export async function listAppointmentsForOpportunity(
  ctx: ServiceContext,
  opportunityId: string,
  options: { limit?: number } = {},
): Promise<AppointmentView[]> {
  assertCanAny(ctx.actor, READ);
  const rows = await repository.listForOpportunity(
    ctx.db,
    toUuid(opportunityId),
    Math.min(options.limit ?? 5, MAX_LIMIT),
  );
  return toViews(ctx.db, rows);
}

/**
 * Tuile « Prochains rendez-vous » du tableau de bord.
 * Sans contrôle d'accès : l'appelant est un service qui a déjà vérifié ses droits.
 */
export async function listUpcomingAppointments(
  db: Database,
  options: { limit?: number } = {},
): Promise<AppointmentView[]> {
  const rows = await repository.listUpcoming(
    db,
    Math.min(options.limit ?? 2, MAX_LIMIT),
    new Date(),
  );
  return toViews(db, rows);
}

/** Prochain rendez-vous affiché dans le panneau d'une conversation. */
export async function getNextAppointment(
  ctx: ServiceContext,
  scope: { companyId: string; projectId?: string | null },
): Promise<AppointmentView | null> {
  assertCanAny(ctx.actor, READ);
  const row = await repository.findNext(ctx.db, scope, new Date());
  if (!row) return null;
  const [view] = await toViews(ctx.db, [row]);
  return view ?? null;
}

export interface PortalAppointment {
  id: string;
  title: string;
  kind: string | null;
  startsAt: Date;
  durationMinutes: number;
  channel: string | null;
  location: string | null;
  status: "planned" | "done" | "cancelled";
  memberNames: string[];
}

/** Rendez-vous de son client, sans annulés, du plus récent au plus ancien. */
export async function listAppointmentsForPortal(
  ctx: PortalContext,
  options: { limit?: number } = {},
): Promise<PortalAppointment[]> {
  const rows = await repository.listForPortal(
    ctx.db,
    ctx.companyId,
    Math.min(options.limit ?? 20, MAX_LIMIT),
  );
  const members = await getMembersByIds(ctx.db, [...new Set(rows.flatMap((row) => row.memberIds))]);
  const names = new Map(members.map((member) => [member.id, member.fullName]));
  return rows.map(({ memberIds, ...row }) => ({
    ...row,
    memberNames: memberIds.flatMap((id) => {
      const name = names.get(id);
      return name ? [name] : [];
    }),
  }));
}

// --- Listes de choix du formulaire ---------------------------------------------------------------

export async function searchAppointmentCompanies(ctx: ServiceContext, search?: string) {
  assertCan(ctx.actor, "messages:send");
  return listCompanyOptions(ctx.db, { search, limit: 50 });
}

/** Contacts, projets et affaires d'un client, pour un formulaire de rattachement. */
export async function getCompanyLinkOptions(ctx: ServiceContext, companyId: string) {
  assertCan(ctx.actor, "messages:send");
  const id = toUuid(companyId);
  const [contacts, projects, opportunities] = await Promise.all([
    listContactOptions(ctx.db, id),
    repository.listProjectOptions(ctx.db, id),
    repository.listOpportunityOptions(ctx.db, id),
  ]);
  return { contacts, projects, opportunities };
}

export async function listAppointmentMemberOptions(ctx: ServiceContext) {
  assertCan(ctx.actor, "messages:send");
  const members = await listAssignableMembers(ctx.db);
  return members.map((member) => ({ id: member.id, name: member.fullName }));
}

// --- Écriture ----------------------------------------------------------------------------------

/**
 * Déduit le client du rattachement et refuse tout lien croisé, avant que la clé composite ne le
 * fasse : un rendez-vous doit être relié à un client, une affaire ou un projet.
 */
async function resolveLinks(
  db: Database,
  input: { companyId?: string; contactId?: string; projectId?: string; opportunityId?: string },
) {
  let companyId = input.companyId ?? null;
  // Sans client dans Twenty : acceptable seul, impossible à côté d'un client (clé composite).
  const unattached: { field: string; label: string }[] = [];

  const claim = (owner: string | null, field: string, label: string) => {
    if (!owner) {
      unattached.push({ field, label });
      return;
    }
    if (companyId && companyId !== owner) {
      throw new ValidationError(`${label} appartient à un autre client.`, {
        [field]: [`${label} d'un autre client.`],
      });
    }
    companyId = owner;
  };

  if (input.projectId) {
    const project = await repository.findProjectCompany(db, input.projectId);
    if (!project) throw new ValidationError("Projet introuvable.", { projectId: ["Introuvable."] });
    claim(project.companyId, "projectId", "Ce projet");
  }
  if (input.opportunityId) {
    const opportunity = await repository.findOpportunityCompany(db, input.opportunityId);
    if (!opportunity) {
      throw new ValidationError("Affaire introuvable.", { opportunityId: ["Introuvable."] });
    }
    claim(opportunity.companyId, "opportunityId", "Cette affaire");
  }
  if (input.contactId) {
    const contact = await repository.findContactCompany(db, input.contactId);
    if (!contact)
      throw new ValidationError("Contact introuvable.", { contactId: ["Introuvable."] });
    claim(contact.companyId, "contactId", "Ce contact");
  }

  if (input.companyId && !(await repository.findCompanyActive(db, input.companyId))) {
    throw new ValidationError("Ce client n'existe pas ou a été archivé.", {
      companyId: ["Client introuvable."],
    });
  }
  const orphan = unattached[0];
  if (companyId && orphan) {
    throw new ValidationError(`${orphan.label} n'est rattaché à aucun client.`, {
      [orphan.field]: [`${orphan.label} n'est rattaché à aucun client.`],
    });
  }
  if (!companyId && !input.opportunityId) {
    throw new ValidationError("Reliez ce rendez-vous à un client, une affaire ou un projet.", {
      companyId: ["Choisissez un client."],
    });
  }
  return companyId;
}

async function assertMembersExist(db: Database, memberIds: string[]): Promise<void> {
  const unique = [...new Set(memberIds)];
  const found = await getMembersByIds(db, unique);
  if (found.length !== unique.length) {
    throw new ValidationError("Un participant n'existe pas.", {
      memberIds: ["Participant introuvable."],
    });
  }
}

export async function createAppointment(
  ctx: ServiceContext,
  rawInput: CreateAppointmentInput,
): Promise<{ id: string }> {
  assertCan(ctx.actor, "messages:send");
  const input = parseInput(createAppointmentSchema, rawInput);
  const companyId = await resolveLinks(ctx.db, input);
  await assertMembersExist(ctx.db, input.memberIds);

  return ctx.db.transaction(async (tx) => {
    const created = await repository.insertAppointment(tx, {
      ...(input.clientRequestId ? { id: input.clientRequestId } : {}),
      companyId,
      contactId: input.contactId ?? null,
      projectId: input.projectId ?? null,
      opportunityId: input.opportunityId ?? null,
      title: input.title,
      kind: input.kind ?? null,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      channel: input.channel ?? null,
      location: input.location ?? null,
      memberIds: input.memberIds,
      source: "manual",
    });
    if (!created) return { id: input.clientRequestId ?? "" };

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "appointment.created",
      entityType: "appointment",
      entityId: created.id,
      metadata: { companyId, source: "manual" },
    });
    return created;
  });
}

export async function updateAppointment(
  ctx: ServiceContext,
  id: string,
  rawInput: UpdateAppointmentInput,
): Promise<void> {
  assertCan(ctx.actor, "messages:send");
  const appointmentId = toUuid(id);
  const input = parseInput(updateAppointmentSchema, rawInput);

  const existing = await repository.findAppointment(ctx.db, appointmentId);
  if (!existing) throw new NotFoundError();
  if (existing.status !== "planned") {
    throw new ConflictError("Seul un rendez-vous prévu peut être modifié.");
  }
  if (
    existing.source === "cal" &&
    (input.startsAt.getTime() !== existing.startsAt.getTime() ||
      input.durationMinutes !== existing.durationMinutes)
  ) {
    throw new ConflictError("Ce rendez-vous vient de Cal.diy : déplacez-le depuis Cal.diy.");
  }

  const companyId = await resolveLinks(ctx.db, input);
  await assertMembersExist(ctx.db, input.memberIds);

  await ctx.db.transaction(async (tx) => {
    const written = await repository.updateAppointmentIfStatus(tx, appointmentId, "planned", {
      companyId,
      contactId: input.contactId ?? null,
      projectId: input.projectId ?? null,
      opportunityId: input.opportunityId ?? null,
      title: input.title,
      kind: input.kind ?? null,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      channel: input.channel ?? null,
      location: input.location ?? null,
      memberIds: input.memberIds,
    });
    if (!written) throw new ConflictError("Seul un rendez-vous prévu peut être modifié.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "appointment.updated",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { companyId },
    });
  });
}

/** Tenu, annulé, rétabli. Redemander le statut courant ne fait rien. */
export async function changeAppointmentStatus(
  ctx: ServiceContext,
  id: string,
  status: "planned" | "done" | "cancelled",
): Promise<void> {
  assertCan(ctx.actor, "messages:send");
  const appointmentId = toUuid(id);
  const next = parseInput(appointmentStatusSchema, status);
  const existing = await repository.findAppointment(ctx.db, appointmentId);
  if (!existing) throw new NotFoundError();
  if (existing.status === next) return;
  assertAppointmentTransition(existing.status, next);

  await ctx.db.transaction(async (tx) => {
    const written = await repository.updateAppointmentIfStatus(tx, appointmentId, existing.status, {
      status: next,
    });
    if (!written) throw new ConflictError("Ce rendez-vous vient de changer : rechargez la page.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: next === "cancelled" ? "appointment.cancelled" : "appointment.updated",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { from: existing.status, to: next },
    });
  });
}

// --- Webhook Cal -------------------------------------------------------------------------------

function durationFrom(startTime: string, endTime: string | undefined): number {
  if (!endTime) return 30;
  const minutes = Math.round((Date.parse(endTime) - Date.parse(startTime)) / 60_000);
  return minutes > 0 ? minutes : 30;
}

/** `integrations:…` désigne un lien de visio généré par Cal, pas une adresse à afficher. */
function placeFrom(location: string | null | undefined): {
  channel: string | null;
  location: string | null;
} {
  if (!location) return { channel: null, location: null };
  if (location.startsWith("integrations:")) return { channel: "Visio", location: null };
  return { channel: null, location: location.slice(0, 300) };
}

export type CalWebhookOutcome = "created" | "updated" | "cancelled" | "duplicate" | "ignored";

/**
 * Applique un événement Cal, déjà authentifié par sa signature. Action système : pas d'acteur.
 * Idempotent : `webhook_receipts` absorbe une relivraison, `external_id` (l'`uid` de Cal) empêche
 * un second rendez-vous. Le client et les participants sont retrouvés par e-mail ; un prospect
 * inconnu donne un rendez-vous sans client, jamais une fiche créée d'office.
 */
export async function applyCalWebhook(
  db: Database,
  event: CalWebhookEvent,
): Promise<CalWebhookOutcome> {
  const { triggerEvent, payload } = event;
  const uid = payload.uid;
  if (
    !uid ||
    !["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"].includes(triggerEvent)
  ) {
    return "ignored";
  }

  return db.transaction(async (tx) => {
    const fresh = await repository.recordReceipt(tx, `${triggerEvent}:${uid}`);
    if (!fresh) return "duplicate";

    if (triggerEvent === "BOOKING_CANCELLED") {
      const existing = await repository.findByExternalId(tx, uid);
      if (!existing || !canAppointmentTransition(existing.status, "cancelled")) return "ignored";
      const written = await repository.updateAppointmentIfStatus(tx, existing.id, existing.status, {
        status: "cancelled",
      });
      if (!written) return "ignored";
      await recordAudit(tx, {
        actorId: null,
        action: "appointment.cancelled",
        entityType: "appointment",
        entityId: existing.id,
        metadata: { source: "cal" },
      });
      return "cancelled";
    }

    if (!payload.startTime) return "ignored";
    const startsAt = new Date(payload.startTime);
    const durationMinutes = durationFrom(payload.startTime, payload.endTime);
    const place = placeFrom(payload.location);

    // Un déplacement crée un nouvel `uid` et rappelle l'ancien dans `rescheduleUid`.
    const previous =
      (payload.rescheduleUid
        ? await repository.findByExternalId(tx, payload.rescheduleUid)
        : null) ?? (await repository.findByExternalId(tx, uid));

    if (previous) {
      await repository.updateAppointment(tx, previous.id, {
        externalId: uid,
        startsAt,
        durationMinutes,
        ...place,
        ...(payload.title ? { title: payload.title.slice(0, 200) } : {}),
      });
      await recordAudit(tx, {
        actorId: null,
        action: "appointment.updated",
        entityType: "appointment",
        entityId: previous.id,
        metadata: { source: "cal" },
      });
      return "updated";
    }

    const attendeeEmails = (payload.attendees ?? []).flatMap((item) =>
      item.email ? [item.email] : [],
    );
    let contact: { id: string; companyId: string | null } | null = null;
    for (const email of attendeeEmails) {
      contact = await repository.findContactByEmail(tx, email);
      if (contact) break;
    }
    const memberIds = await repository.findMemberIdsByEmail(
      tx,
      payload.organizer?.email ? [payload.organizer.email] : [],
    );

    const created = await repository.insertAppointment(tx, {
      companyId: contact?.companyId ?? null,
      contactId: contact?.companyId ? contact.id : null,
      title: (payload.title ?? "Rendez-vous").slice(0, 200),
      startsAt,
      durationMinutes,
      ...place,
      memberIds,
      source: "cal",
      externalId: uid,
    });
    if (!created) return "duplicate";
    await recordAudit(tx, {
      actorId: null,
      action: "appointment.created",
      entityType: "appointment",
      entityId: created.id,
      metadata: { source: "cal", matchedContact: Boolean(contact) },
    });
    return "created";
  });
}
