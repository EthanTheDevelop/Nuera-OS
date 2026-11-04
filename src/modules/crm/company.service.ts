import { randomUUID } from "node:crypto";
import {
  CrmDuplicateError,
  type CrmCompany,
  type UpdateCompanyInput as CrmUpdateCompany,
} from "@/integrations/twenty/crm-gateway";
import { COMPANY_STATUS_LABELS, type CompanyStatus } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { getMembersByIds, listAssignableMembers } from "@/modules/team/team.lookup";
import { assertCan } from "@/server/auth/permissions";
import { requireCrm, type ServiceContext } from "@/server/context";
import type { Company } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import * as repository from "./company.repository";
import {
  companyListFiltersSchema,
  createCompanySchema,
  mergeSchema,
  updateCompanySchema,
  type CompanyListFilters,
  type CreateCompanyInput,
} from "./crm.schema";
import {
  assertCrmWritable,
  DuplicateRecordError,
  normalizeName,
  type DuplicateField,
} from "./crm.shared";

export { listActivitiesForCompany } from "./activity.service";
export { listContactsForCompany } from "./contact.service";

/** Colonnes (T) d'une fiche, telles que Twenty les renvoie. */
export function companyTwentyColumns(record: CrmCompany) {
  return {
    name: record.name,
    domain: record.domains.primary,
    addressLine: record.address.street1,
    city: record.address.city,
    postalCode: record.address.postcode,
    country: record.address.country,
    archivedAt: record.deletedAt ? new Date(record.deletedAt) : null,
    twentySyncedAt: new Date(record.updatedAt),
  };
}

export interface CompanyListRow {
  company: Company;
  contactName: string | null;
  ownerName: string | null;
  leadOpportunity: { name: string; stage: string; amountCents: number | null } | null;
}

export async function listCompanies(
  ctx: ServiceContext,
  rawFilters: unknown,
  params?: PageParams,
): Promise<Paginated<CompanyListRow>> {
  assertCan(ctx.actor, "crm:read");
  const filters: CompanyListFilters = companyListFiltersSchema.parse(rawFilters ?? {});
  const page = await repository.listCompanyPage(
    ctx.db,
    filters,
    params ?? parsePagination(rawFilters as { page?: unknown }),
  );
  const ids = page.items.map((company) => company.id);
  const ownerIds = [...new Set(page.items.flatMap((company) => company.ownerMemberId ?? []))];
  const [contacts, leads, owners] = await Promise.all([
    repository.listPrimaryContacts(ctx.db, ids),
    repository.listLeadOpportunities(ctx.db, ids),
    getMembersByIds(ctx.db, ownerIds),
  ]);
  const contactOf = new Map(contacts.map((row) => [row.companyId, row]));
  const leadOf = new Map(leads.map((row) => [row.companyId, row]));
  const ownerOf = new Map(owners.map((owner) => [owner.id, owner.fullName]));

  return {
    ...page,
    items: page.items.map((company) => {
      const contact = contactOf.get(company.id);
      const lead = leadOf.get(company.id);
      return {
        company,
        contactName: contact
          ? [contact.firstName, contact.lastName].filter(Boolean).join(" ")
          : null,
        ownerName: company.ownerMemberId ? (ownerOf.get(company.ownerMemberId) ?? null) : null,
        leadOpportunity: lead
          ? { name: lead.name, stage: lead.stage, amountCents: lead.amountCents }
          : null,
      };
    }),
  };
}

export interface CompanySummary {
  total: number;
  clients: number;
  activeProspects: number;
  subscribers: number;
}

/** Résumé de l'en-tête de l'écran 07. */
export async function getCompanySummary(ctx: ServiceContext): Promise<CompanySummary> {
  assertCan(ctx.actor, "crm:read");
  const { byStatus, activeProspects } = await repository.countCompaniesByStatus(ctx.db);
  const of = (status: CompanyStatus) => byStatus.find((row) => row.status === status)?.total ?? 0;
  return {
    total: byStatus.reduce((sum, row) => sum + row.total, 0),
    clients: of("client"),
    activeProspects,
    subscribers: of("subscriber"),
  };
}

export async function getCompanyFilterOptions(ctx: ServiceContext) {
  assertCan(ctx.actor, "crm:read");
  return repository.listDistinctCompanyFilters(ctx.db);
}

export interface CompanyRecord {
  company: Company;
  ownerName: string | null;
}

/** Fiche d'un client. Inconnu : 404, y compris pour une fiche absorbée (`mergedIntoId` le dit). */
export async function getCompany(ctx: ServiceContext, id: string): Promise<CompanyRecord> {
  assertCan(ctx.actor, "crm:read");
  const company = await repository.findCompanyById(ctx.db, id);
  if (!company) throw new NotFoundError("Client introuvable.");
  const [owner] = company.ownerMemberId
    ? await getMembersByIds(ctx.db, [company.ownerMemberId])
    : [];
  return { company, ownerName: owner?.fullName ?? null };
}

export async function listMemberOptions(ctx: ServiceContext) {
  assertCan(ctx.actor, "crm:read");
  return listAssignableMembers(ctx.db);
}

// --- Règles -----------------------------------------------------------------------------------

function duplicateError(company: Company, field: DuplicateField, soft = false) {
  const messages: Record<DuplicateField, string> = {
    domain: "Un client utilise déjà ce domaine.",
    siren: "Un client porte déjà ce SIREN.",
    name: "Un client porte déjà ce nom.",
    email: "Un contact utilise déjà cette adresse.",
    phone: "Un contact utilise déjà ce numéro.",
  };
  const suffix = company.archivedAt ? " (fiche archivée)" : "";
  const message = `${messages[field]}${suffix}`;
  return new DuplicateRecordError(
    message,
    { [field]: [message] },
    {
      entity: "company",
      field,
      id: company.id,
      twentyId: company.twentyId,
      name: company.name,
      companyId: company.id,
      archived: company.archivedAt !== null,
      soft,
    },
  );
}

async function assertNoDuplicate(
  db: Database,
  data: { domain?: string | null; siren?: string | null; name?: string; allowSameName?: boolean },
  excludeId?: string,
): Promise<void> {
  const normalizedName = data.name ? normalizeName(data.name) : null;
  const matches = await repository.findCompaniesMatching(db, {
    domain: data.domain,
    siren: data.siren,
    normalizedName,
    excludeId,
  });
  const byDomain = matches.find((row) => data.domain && row.domain?.toLowerCase() === data.domain);
  if (byDomain) throw duplicateError(byDomain, "domain");
  const bySiren = matches.find((row) => data.siren && row.siren === data.siren);
  if (bySiren) throw duplicateError(bySiren, "siren");
  if (!data.allowSameName) {
    const byName = matches.find(
      (row) => normalizedName && !row.archivedAt && normalizeName(row.name) === normalizedName,
    );
    if (byName) throw duplicateError(byName, "name", true);
  }
}

async function assertOwnerExists(db: Database, ownerMemberId: string | null | undefined) {
  if (!ownerMemberId) return;
  const [owner] = await getMembersByIds(db, [ownerMemberId]);
  if (!owner) {
    throw new ValidationError("Responsable inconnu.", { ownerMemberId: ["Responsable inconnu."] });
  }
}

/**
 * Twenty refuse le domaine : on cherche la fiche, on la projette si besoin, et on propose de la
 * restaurer ou de fusionner. Une fiche archivée dans Twenty garde son domaine, jamais de recréation.
 */
async function toDuplicateRecordError(
  ctx: ServiceContext,
  error: CrmDuplicateError,
): Promise<DuplicateRecordError | CrmDuplicateError> {
  if (error.field !== "domain" || !error.existing) return error;
  const local = await repository.findCompanyByTwentyId(ctx.db, error.existing.id);
  if (local) return duplicateError(local, "domain");

  const message = error.message;
  const duplicate = {
    entity: "company" as const,
    field: "domain" as const,
    twentyId: error.existing.id,
    companyId: null,
    soft: false,
  };
  if (error.existing.deleted) {
    return new DuplicateRecordError(
      message,
      { domain: [message] },
      { ...duplicate, id: null, name: null, archived: true },
    );
  }
  const record = await requireCrm(ctx).getCompany(error.existing.id);
  const projected = await ctx.db.transaction((tx) =>
    repository.insertCompany(tx, {
      twentyId: record.id,
      ...companyTwentyColumns(record),
    }),
  );
  return new DuplicateRecordError(
    message,
    { domain: [message] },
    {
      ...duplicate,
      id: projected?.id ?? null,
      name: record.name,
      companyId: projected?.id ?? null,
      archived: false,
    },
  );
}

function localCompanyColumns(data: CreateCompanyInput) {
  return {
    status: data.status ?? ("prospect" as const),
    activity: data.activity ?? null,
    siren: data.siren ?? null,
    phone: data.phone ?? null,
    source: data.source ?? null,
    tags: data.tags ?? [],
    ownerMemberId: data.ownerMemberId ?? null,
    notes: data.notes ?? null,
  };
}

// --- Écritures --------------------------------------------------------------------------------

/**
 * Crée le client dans Twenty puis dans la projection. L'identifiant vient de l'appelant : après une
 * coupure, la même requête retrouve la même fiche et ne journalise rien de plus.
 */
export async function createCompany(ctx: ServiceContext, input: unknown): Promise<Company> {
  assertCan(ctx.actor, "crm:create");
  const data = parseInput(createCompanySchema, input);
  const id = data.id ?? randomUUID();

  const existing = await repository.findCompanyById(ctx.db, id);
  if (existing) return existing;

  await assertOwnerExists(ctx.db, data.ownerMemberId);
  await assertNoDuplicate(ctx.db, data);

  const crm = requireCrm(ctx);
  let record: CrmCompany;
  try {
    record = await crm.createCompany({
      id,
      name: data.name,
      domains: data.domain ? { primary: data.domain, additional: [] } : undefined,
      address: {
        street1: data.addressLine ?? null,
        city: data.city ?? null,
        postcode: data.postalCode ?? null,
        country: data.country ?? null,
      },
    });
  } catch (error) {
    if (error instanceof CrmDuplicateError) throw await toDuplicateRecordError(ctx, error);
    throw error;
  }

  return ctx.db.transaction(async (tx) => {
    const row = await repository.insertCompany(tx, {
      id,
      twentyId: record.id,
      ...companyTwentyColumns(record),
      ...localCompanyColumns(data),
    });
    if (!row) {
      // Le webhook de cette création est passé avant : on complète les colonnes de Nuera.
      const projected = await repository.findCompanyByTwentyId(tx, record.id);
      if (!projected) throw new ConflictError("Ce SIREN vient d'être attribué à une autre fiche.");
      return repository.updateCompanyRow(tx, projected.id, localCompanyColumns(data));
    }
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "company.created",
      entityType: "company",
      entityId: row.id,
      metadata: { name: row.name, status: row.status, twentyId: row.twentyId },
    });
    return row;
  });
}

function changedKeys<T extends object>(before: T, after: Partial<T>): string[] {
  return (Object.keys(after) as (keyof T)[]).flatMap((key) => {
    const value = after[key];
    if (value === undefined) return [];
    return JSON.stringify(value) === JSON.stringify(before[key]) ? [] : [String(key)];
  });
}

export async function updateCompany(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<Company> {
  assertCan(ctx.actor, "crm:update");
  const data = parseInput(updateCompanySchema, input);
  const company = await repository.findCompanyById(ctx.db, id);
  if (!company) throw new NotFoundError("Client introuvable.");
  if (company.mergedIntoId) throw new ConflictError("Cette fiche a été fusionnée dans une autre.");
  if (company.archivedAt) {
    throw new ConflictError("Cette fiche est archivée : restaurez-la pour la modifier.");
  }

  await assertOwnerExists(ctx.db, data.ownerMemberId);
  await assertNoDuplicate(
    ctx.db,
    {
      domain: data.domain && data.domain !== company.domain ? data.domain : null,
      siren: data.siren && data.siren !== company.siren ? data.siren : null,
      allowSameName: true,
    },
    id,
  );

  const twentyPatch: CrmUpdateCompany = {};
  const crmChanged = changedKeys(company, {
    name: data.name,
    domain: data.domain,
    addressLine: data.addressLine,
    city: data.city,
    postalCode: data.postalCode,
    country: data.country,
  });

  let record: CrmCompany | null = null;
  if (crmChanged.length > 0) {
    assertCrmWritable(company.twentyId);
    const crm = requireCrm(ctx);
    if (crmChanged.includes("name")) twentyPatch.name = data.name;
    if (crmChanged.includes("domain")) {
      // `domains` se remplace en entier : les domaines secondaires de Twenty sont repris tels quels.
      const current = await crm.getCompany(company.twentyId);
      twentyPatch.domains = {
        primary: data.domain ?? null,
        additional: current.domains.additional,
      };
    }
    const address = {
      ...(crmChanged.includes("addressLine") ? { street1: data.addressLine ?? null } : {}),
      ...(crmChanged.includes("city") ? { city: data.city ?? null } : {}),
      ...(crmChanged.includes("postalCode") ? { postcode: data.postalCode ?? null } : {}),
      ...(crmChanged.includes("country") ? { country: data.country ?? null } : {}),
    };
    if (Object.keys(address).length > 0) twentyPatch.address = address;
    try {
      record = await crm.updateCompany(company.twentyId, twentyPatch);
    } catch (error) {
      if (error instanceof CrmDuplicateError) throw await toDuplicateRecordError(ctx, error);
      throw error;
    }
  }

  const local = {
    status: data.status,
    activity: data.activity,
    siren: data.siren,
    phone: data.phone,
    source: data.source,
    tags: data.tags,
    ownerMemberId: data.ownerMemberId,
    notes: data.notes,
  };
  const localChanged = changedKeys(company, local);
  if (crmChanged.length === 0 && localChanged.length === 0) return company;

  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateCompanyRow(tx, id, {
      ...(record ? { ...companyTwentyColumns(record), archivedAt: company.archivedAt } : {}),
      ...local,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "company.updated",
      entityType: "company",
      entityId: id,
      metadata: { fields: [...crmChanged, ...localChanged] },
    });
    if (data.status && data.status !== company.status) {
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "company.status_changed",
        entityType: "company",
        entityId: id,
        metadata: { from: company.status, to: data.status },
      });
    }
    return row;
  });
}

/** Archive sans perdre l'historique : contacts, affaires et liens restent en place. */
export async function archiveCompany(ctx: ServiceContext, id: string): Promise<Company> {
  assertCan(ctx.actor, "crm:archive");
  const company = await repository.findCompanyById(ctx.db, id);
  if (!company) throw new NotFoundError("Client introuvable.");
  if (company.archivedAt) return company;

  assertCrmWritable(company.twentyId);
  const crm = requireCrm(ctx);
  try {
    await crm.deleteCompany(company.twentyId);
  } catch (error) {
    // Déjà archivée dans Twenty : la projection rattrape.
    if (!(error instanceof NotFoundError)) throw error;
  }
  return ctx.db.transaction(async (tx) => {
    const row = await repository.updateCompanyRow(tx, id, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "company.archived",
      entityType: "company",
      entityId: id,
      metadata: { name: company.name },
    });
    return row;
  });
}

async function restoreRecord(ctx: ServiceContext, twentyId: string): Promise<Company> {
  const crm = requireCrm(ctx);
  const record = await crm.restoreCompany(twentyId);
  return ctx.db.transaction(async (tx) => {
    const existing = await repository.findCompanyByTwentyId(tx, twentyId);
    const row = existing
      ? await repository.updateCompanyRow(tx, existing.id, {
          ...companyTwentyColumns(record),
          archivedAt: null,
        })
      : await repository.insertCompany(tx, {
          twentyId: record.id,
          ...companyTwentyColumns(record),
          archivedAt: null,
        });
    if (!row) throw new ConflictError("La fiche vient d'être restaurée par ailleurs.");
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "company.restored",
      entityType: "company",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return row;
  });
}

export async function restoreCompany(ctx: ServiceContext, id: string): Promise<Company> {
  assertCan(ctx.actor, "crm:archive");
  const company = await repository.findCompanyById(ctx.db, id);
  if (!company) throw new NotFoundError("Client introuvable.");
  if (company.mergedIntoId) {
    throw new ConflictError("Cette fiche a été fusionnée : elle ne peut plus être restaurée.");
  }
  if (!company.archivedAt) return company;
  assertCrmWritable(company.twentyId);
  return restoreRecord(ctx, company.twentyId);
}

/** Restauration proposée après un doublon : la fiche archivée n'est parfois connue que de Twenty. */
export async function restoreCompanyByTwentyId(
  ctx: ServiceContext,
  twentyId: string,
): Promise<Company> {
  assertCan(ctx.actor, "crm:archive");
  assertCrmWritable(twentyId);
  return restoreRecord(ctx, twentyId);
}

/**
 * Fusionne `loserId` dans `winnerId`. Irréversible pour la perdante dans Twenty : l'interface exige
 * une confirmation explicite. Rejouable : si Twenty a déjà absorbé la fiche, seule la projection suit.
 */
export async function mergeCompanies(ctx: ServiceContext, input: unknown): Promise<Company> {
  assertCan(ctx.actor, "crm:merge");
  const { winnerId, loserId } = parseInput(mergeSchema, input);

  const [winner, loser] = await Promise.all([
    repository.findCompanyById(ctx.db, winnerId),
    repository.findCompanyById(ctx.db, loserId),
  ]);
  if (!winner || !loser) throw new NotFoundError("Client introuvable.");
  if (loser.mergedIntoId === winner.id) return winner;
  if (winner.mergedIntoId || loser.mergedIntoId) {
    throw new ConflictError("L'une de ces fiches a déjà été fusionnée.");
  }
  if (winner.archivedAt || loser.archivedAt) {
    throw new ConflictError(
      "Restaurez d'abord la fiche archivée : Twenty ne fusionne que des fiches actives.",
    );
  }
  assertCrmWritable(winner.twentyId);
  assertCrmWritable(loser.twentyId);

  const crm = requireCrm(ctx);
  let merged: CrmCompany;
  try {
    ({ merged } = await crm.mergeCompanies({
      winnerId: winner.twentyId,
      loserIds: [loser.twentyId],
    }));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    // Première tentative aboutie côté Twenty, projection non écrite : le gagnant doit répondre.
    merged = await crm.getCompany(winner.twentyId);
  }

  return ctx.db.transaction(async (tx) => {
    await repository.moveCompanyChildren(tx, loser.id, winner.id);
    const row = await repository.updateCompanyRow(tx, winner.id, {
      ...companyTwentyColumns(merged),
      activity: winner.activity ?? loser.activity,
      siren: winner.siren ?? loser.siren,
      phone: winner.phone ?? loser.phone,
      source: winner.source ?? loser.source,
      ownerMemberId: winner.ownerMemberId ?? loser.ownerMemberId,
      tags: [...new Set([...winner.tags, ...loser.tags])],
      notes: [winner.notes, loser.notes].filter(Boolean).join("\n\n") || null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "company.merged",
      entityType: "company",
      entityId: winner.id,
      metadata: {
        winnerName: winner.name,
        loserId: loser.id,
        loserName: loser.name,
        loserTwentyId: loser.twentyId,
      },
    });
    return row;
  });
}

/**
 * Conversion à la signature (03.04.01) : une affaire gagnée fait passer un prospect ou un ancien
 * client en client. Appelé dans la transaction de la clôture, droits déjà vérifiés.
 */
export async function promoteCompanyOnWin(
  tx: Database,
  companyId: string | null,
  actorId: string | null,
): Promise<void> {
  if (!companyId) return;
  const company = await repository.lockCompanyById(tx, companyId);
  if (!company || (company.status !== "prospect" && company.status !== "former")) return;
  await repository.updateCompanyRow(tx, companyId, { status: "client" });
  await recordAudit(tx, {
    actorId,
    action: "company.status_changed",
    entityType: "company",
    entityId: companyId,
    metadata: { from: company.status, to: "client", reason: "opportunity_won" },
  });
}

// --- Doublons ---------------------------------------------------------------------------------

export interface CompanyDuplicateGroup {
  reason: "domain" | "siren" | "name";
  key: string;
  members: Company[];
}

export const DUPLICATE_REASON_LABELS: Record<string, string> = {
  domain: "Même domaine",
  siren: "Même SIREN",
  name: "Même nom",
  email: "Même e-mail",
  phone: "Même téléphone",
};

export async function listCompanyDuplicates(
  ctx: ServiceContext,
  options: { limit?: number } = {},
): Promise<CompanyDuplicateGroup[]> {
  assertCan(ctx.actor, "crm:read");
  const groups = await repository.findCompanyDuplicateGroups(ctx.db, options.limit ?? 50);
  const members = await repository.listCompaniesByIds(
    ctx.db,
    groups.flatMap((group) => group.ids),
  );
  const byId = new Map(members.map((company) => [company.id, company]));
  return groups.map((group) => ({
    reason: group.reason,
    key: group.key,
    members: group.ids.flatMap((id) => byId.get(id) ?? []),
  }));
}

export { COMPANY_STATUS_LABELS };
