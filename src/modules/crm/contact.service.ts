import { randomUUID } from "node:crypto";
import {
  CrmDuplicateError,
  type CrmPerson,
  type UpdatePersonInput,
} from "@/integrations/twenty/crm-gateway";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import { requireCrm, type ServiceContext } from "@/server/context";
import type { Contact } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parsePagination, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { getCompanyRef } from "./company.lookup";
import * as repository from "./contact.repository";
import {
  contactDirectoryFiltersSchema,
  createContactSchema,
  mergeSchema,
  updateContactSchema,
} from "./crm.schema";
import { assertCrmWritable, DuplicateRecordError } from "./crm.shared";

/** Colonnes (T) d'un contact, telles que Twenty les renvoie (hors client, résolu à part). */
export function contactTwentyColumns(record: CrmPerson) {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.emails.primary,
    phone: record.phones.primary,
    jobTitle: record.jobTitle,
    archivedAt: record.deletedAt ? new Date(record.deletedAt) : null,
    twentySyncedAt: new Date(record.updatedAt),
  };
}

function duplicateContactError(contact: Contact) {
  const suffix = contact.archivedAt ? " (fiche archivée)" : "";
  const message = `Un contact utilise déjà cette adresse e-mail${suffix}.`;
  return new DuplicateRecordError(
    message,
    { email: [message] },
    {
      entity: "contact",
      field: "email",
      id: contact.id,
      twentyId: contact.twentyId,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      companyId: contact.companyId,
      archived: contact.archivedAt !== null,
      soft: false,
    },
  );
}

async function toDuplicateError(
  ctx: ServiceContext,
  error: CrmDuplicateError,
): Promise<DuplicateRecordError | CrmDuplicateError> {
  if (error.field !== "email" || !error.existing) return error;
  const local = await repository.findContactByTwentyId(ctx.db, error.existing.id);
  if (local) return duplicateContactError(local);
  const message = error.message;
  return new DuplicateRecordError(
    message,
    { email: [message] },
    {
      entity: "contact",
      field: "email",
      id: null,
      twentyId: error.existing.id,
      name: null,
      companyId: null,
      archived: error.existing.deleted,
      soft: false,
    },
  );
}

async function resolveCompany(ctx: ServiceContext, companyId: string | null | undefined) {
  if (!companyId) return null;
  const company = await getCompanyRef(ctx.db, companyId);
  if (!company || company.mergedIntoId) throw new NotFoundError("Client introuvable.");
  if (company.archivedAt) throw new ConflictError("Ce client est archivé.");
  return company;
}

export async function createContact(ctx: ServiceContext, input: unknown): Promise<Contact> {
  assertCan(ctx.actor, "crm:create");
  const data = parseInput(createContactSchema, input);
  const id = data.id ?? randomUUID();

  const existing = await repository.findContactById(ctx.db, id);
  if (existing) return existing;

  const company = await resolveCompany(ctx, data.companyId);
  if (company) assertCrmWritable(company.twentyId);
  if (data.email) {
    const [match] = await repository.findContactsByEmail(ctx.db, data.email);
    if (match) throw duplicateContactError(match);
  }

  const crm = requireCrm(ctx);
  let record: CrmPerson;
  try {
    record = await crm.createPerson({
      id,
      firstName: data.firstName,
      lastName: data.lastName,
      emails: data.email ? { primary: data.email, additional: [] } : undefined,
      phones: data.phone ? { primary: data.phone, additional: [] } : undefined,
      jobTitle: data.jobTitle ?? null,
      companyId: company?.twentyId ?? null,
    });
  } catch (error) {
    if (error instanceof CrmDuplicateError) throw await toDuplicateError(ctx, error);
    throw error;
  }

  const local = {
    roles: data.roles ?? [],
    isPrimary: Boolean(data.isPrimary),
    notes: data.notes ?? null,
  };
  return ctx.db.transaction(async (tx) => {
    const row = await repository.insertContact(tx, {
      id,
      twentyId: record.id,
      companyId: company?.id ?? null,
      ...contactTwentyColumns(record),
      ...local,
    });
    if (!row) {
      const projected = await repository.findContactByTwentyId(tx, record.id);
      if (!projected) throw new Error("Contact introuvable après un conflit d'insertion");
      return repository.updateContactRow(tx, projected.id, local);
    }
    if (row.isPrimary && row.companyId) {
      await repository.clearPrimaryContact(tx, row.companyId, row.id);
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contact.created",
      entityType: "contact",
      entityId: row.id,
      metadata: { companyId: row.companyId, roles: row.roles },
    });
    return row;
  });
}

export async function updateContact(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Contact> {
  assertCan(ctx.actor, "crm:update");
  const data = parseInput(updateContactSchema, input);
  const contact = await repository.findContactById(ctx.db, id);
  if (!contact) throw new NotFoundError("Contact introuvable.");
  if (contact.archivedAt) {
    throw new ConflictError("Ce contact est archivé : restaurez-le pour le modifier.");
  }

  const companyChanged = data.companyId !== undefined && data.companyId !== contact.companyId;
  const newCompany = companyChanged ? await resolveCompany(ctx, data.companyId) : null;
  if (companyChanged && (await repository.findPortalMembershipForContact(ctx.db, id))) {
    throw new ConflictError(
      "Ce contact a un accès à l'espace client : révoquez-le avant de changer son client.",
    );
  }
  if (data.email && data.email !== contact.email) {
    const [match] = await repository.findContactsByEmail(ctx.db, data.email, id);
    if (match) throw duplicateContactError(match);
  }

  const patch: UpdatePersonInput = {};
  if (data.firstName !== undefined && data.firstName !== contact.firstName) {
    patch.firstName = data.firstName;
  }
  if (data.lastName !== undefined && data.lastName !== contact.lastName) {
    patch.lastName = data.lastName;
  }
  if (data.jobTitle !== undefined && data.jobTitle !== contact.jobTitle) {
    patch.jobTitle = data.jobTitle;
  }
  if (companyChanged) patch.companyId = newCompany?.twentyId ?? null;
  const emailChanged = data.email !== undefined && data.email !== contact.email;
  const phoneChanged = data.phone !== undefined && data.phone !== contact.phone;

  let record: CrmPerson | null = null;
  if (Object.keys(patch).length > 0 || emailChanged || phoneChanged) {
    assertCrmWritable(contact.twentyId);
    if (newCompany) assertCrmWritable(newCompany.twentyId);
    const crm = requireCrm(ctx);
    if (emailChanged || phoneChanged) {
      // `emails` et `phones` se remplacent en entier : les valeurs secondaires sont reprises.
      const current = await crm.getPerson(contact.twentyId);
      if (emailChanged) {
        patch.emails = { primary: data.email ?? null, additional: current.emails.additional };
      }
      if (phoneChanged) {
        patch.phones = {
          primary: data.phone ?? null,
          // Twenty efface les secondaires quand le numéro principal est vidé.
          additional: data.phone ? current.phones.additional : [],
        };
      }
    }
    try {
      record = await crm.updatePerson(contact.twentyId, patch);
    } catch (error) {
      if (error instanceof CrmDuplicateError) throw await toDuplicateError(ctx, error);
      throw error;
    }
  }

  const local = { roles: data.roles, isPrimary: data.isPrimary, notes: data.notes };
  return ctx.db.transaction(async (tx) => {
    if (companyChanged) await repository.moveContactToCompany(tx, id, newCompany?.id ?? null);
    const row = await repository.updateContactRow(tx, id, {
      ...(record ? { ...contactTwentyColumns(record), archivedAt: contact.archivedAt } : {}),
      ...local,
    });
    if (row.isPrimary && row.companyId) {
      await repository.clearPrimaryContact(tx, row.companyId, row.id);
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contact.updated",
      entityType: "contact",
      entityId: id,
      metadata: { fields: Object.keys({ ...patch, ...definedOnly(local) }) },
    });
    return row;
  });
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export async function archiveContact(ctx: ServiceContext, id: string): Promise<Contact> {
  assertCan(ctx.actor, "crm:archive");
  const contact = await repository.findContactById(ctx.db, id);
  if (!contact) throw new NotFoundError("Contact introuvable.");
  if (contact.archivedAt) return contact;
  assertCrmWritable(contact.twentyId);
  try {
    await requireCrm(ctx).deletePerson(contact.twentyId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateContactRow(tx, id, {
      archivedAt: new Date(),
      isPrimary: false,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contact.archived",
      entityType: "contact",
      entityId: id,
      metadata: { companyId: contact.companyId },
    });
    return row;
  });
}

export async function restoreContact(ctx: ServiceContext, id: string): Promise<Contact> {
  assertCan(ctx.actor, "crm:archive");
  const contact = await repository.findContactById(ctx.db, id);
  if (!contact) throw new NotFoundError("Contact introuvable.");
  if (!contact.archivedAt) return contact;
  assertCrmWritable(contact.twentyId);
  const record = await requireCrm(ctx).restorePerson(contact.twentyId);
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateContactRow(tx, id, {
      ...contactTwentyColumns(record),
      archivedAt: null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contact.restored",
      entityType: "contact",
      entityId: id,
      metadata: { companyId: contact.companyId },
    });
    return row;
  });
}

/**
 * Fusionne deux contacts d'un même client. Deux clients différents sont refusés : les clés
 * composites l'interdisent, et ce serait rattacher l'historique d'un client à un autre.
 */
export async function mergeContacts(ctx: ServiceContext, input: unknown): Promise<Contact> {
  assertCan(ctx.actor, "crm:merge");
  const { winnerId, loserId } = parseInput(mergeSchema, input);
  const [winner, loser] = await Promise.all([
    repository.findContactById(ctx.db, winnerId),
    repository.findContactById(ctx.db, loserId),
  ]);
  if (!winner || !loser) throw new NotFoundError("Contact introuvable.");
  if (loser.archivedAt) {
    throw new ConflictError("Cette fiche est archivée : restaurez-la avant de la fusionner.");
  }
  if (winner.archivedAt) throw new ConflictError("Restaurez d'abord la fiche à conserver.");
  if (winner.companyId !== loser.companyId) {
    throw new ConflictError("Ces contacts appartiennent à deux clients différents.");
  }
  const memberships = await repository.countActivePortalMemberships(ctx.db, [winnerId, loserId]);
  if (memberships > 1) {
    throw new ConflictError(
      "Les deux contacts ont un accès à l'espace client : révoquez-en un avant de fusionner.",
    );
  }
  assertCrmWritable(winner.twentyId);
  assertCrmWritable(loser.twentyId);

  const crm = requireCrm(ctx);
  let merged: CrmPerson;
  try {
    ({ merged } = await crm.mergePeople({ winnerId: winner.twentyId, loserIds: [loser.twentyId] }));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    merged = await crm.getPerson(winner.twentyId);
  }

  return ctx.db.transaction(async (tx) => {
    await repository.moveContactChildren(tx, loser.id, winner.id);
    const row = await repository.updateContactRow(tx, winner.id, {
      ...contactTwentyColumns(merged),
      roles: [...new Set([...winner.roles, ...loser.roles])],
      isPrimary: winner.isPrimary || loser.isPrimary,
      notes: [winner.notes, loser.notes].filter(Boolean).join("\n\n") || null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "contact.merged",
      entityType: "contact",
      entityId: winner.id,
      metadata: { loserId: loser.id, loserTwentyId: loser.twentyId, companyId: winner.companyId },
    });
    return row;
  });
}

// --- Lectures ---------------------------------------------------------------------------------

export interface ContactSummary {
  id: string;
  companyId: string | null;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  roles: Contact["roles"];
  isPrimary: boolean;
  notes: string | null;
}

function toSummary(contact: Contact): ContactSummary {
  return {
    id: contact.id,
    companyId: contact.companyId,
    fullName: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    jobTitle: contact.jobTitle,
    roles: contact.roles,
    isPrimary: contact.isPrimary,
    notes: contact.notes,
  };
}

/** Lecture de la fiche 360° : contacts actifs d'un client, le principal en tête. */
export async function listContactsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<ContactSummary[]> {
  assertCan(ctx.actor, "crm:read");
  const rows = await repository.listContactsOfCompany(ctx.db, companyId, options);
  return rows.map(toSummary);
}

export async function getContact(
  ctx: ServiceContext,
  id: string,
): Promise<ContactSummary & { archivedAt: Date | null }> {
  assertCan(ctx.actor, "crm:read");
  const contact = await repository.findContactById(ctx.db, id);
  if (!contact) throw new NotFoundError("Contact introuvable.");
  return { ...toSummary(contact), archivedAt: contact.archivedAt };
}

export interface ContactDirectoryRow extends ContactSummary {
  companyName: string | null;
  archivedAt: Date | null;
}

export async function listContactDirectory(
  ctx: ServiceContext,
  rawFilters: unknown,
): Promise<Paginated<ContactDirectoryRow>> {
  assertCan(ctx.actor, "crm:read");
  const filters = contactDirectoryFiltersSchema.parse(rawFilters ?? {});
  const page = await repository.listContactDirectoryPage(
    ctx.db,
    filters,
    parsePagination(rawFilters as { page?: unknown }),
  );
  return {
    ...page,
    items: page.items.map((row) => ({
      ...toSummary(row.contact),
      companyName: row.companyName,
      archivedAt: row.contact.archivedAt,
    })),
  };
}

export interface ContactDuplicateGroup {
  reason: "email" | "phone" | "name";
  key: string;
  members: ContactDirectoryRow[];
}

export async function listContactDuplicates(
  ctx: ServiceContext,
  options: { limit?: number } = {},
): Promise<ContactDuplicateGroup[]> {
  assertCan(ctx.actor, "crm:read");
  const groups = await repository.findContactDuplicateGroups(ctx.db, options.limit ?? 50);
  const rows = await repository.listContactsByIds(
    ctx.db,
    groups.flatMap((group) => group.ids),
  );
  const byId = new Map(rows.map((row) => [row.contact.id, row]));
  return groups.map((group) => ({
    reason: group.reason,
    key: group.key,
    members: group.ids.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [
            {
              ...toSummary(row.contact),
              companyName: row.companyName,
              archivedAt: row.contact.archivedAt,
            },
          ]
        : [];
    }),
  }));
}
