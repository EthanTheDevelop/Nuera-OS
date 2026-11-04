import type {
  CrmActivityTarget,
  CrmCompany,
  CrmNote,
  CrmPerson,
  CrmTask,
} from "@/integrations/twenty/crm-gateway";
import type { Activity } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import * as activities from "./activity.repository";
import * as companies from "./company.repository";
import { companyTwentyColumns } from "./company.service";
import * as contacts from "./contact.repository";
import { contactTwentyColumns } from "./contact.service";

/**
 * Reflète une fiche Twenty dans la projection. Idempotent et insensible à l'ordre : une version plus
 * ancienne que celle déjà connue est ignorée, ce qui protège d'un webhook arrivé en retard. Seules
 * les colonnes (T) sont écrites, jamais celles de Nuera. Commun au webhook et à la réconciliation.
 */
export type ProjectionOutcome = "applied" | "skipped" | "removed";

export function isStaleVersion(syncedAt: Date | null, updatedAt: string): boolean {
  return syncedAt !== null && new Date(updatedAt).getTime() < syncedAt.getTime();
}

export async function projectCompany(db: Database, record: CrmCompany): Promise<ProjectionOutcome> {
  return db.transaction(async (tx) => {
    const existing = await companies.findCompanyByTwentyId(tx, record.id);
    if (!existing) {
      await companies.insertCompany(tx, { twentyId: record.id, ...companyTwentyColumns(record) });
      return "applied";
    }
    if (existing.mergedIntoId || isStaleVersion(existing.twentySyncedAt, record.updatedAt)) {
      return "skipped";
    }
    await companies.updateCompanyRow(tx, existing.id, companyTwentyColumns(record));
    return "applied";
  });
}

export async function projectPerson(db: Database, record: CrmPerson): Promise<ProjectionOutcome> {
  return db.transaction(async (tx) => {
    const existing = await contacts.findContactByTwentyId(tx, record.id);
    const company = record.companyId
      ? await companies.findCompanyByTwentyId(tx, record.companyId)
      : null;
    // Client pas encore projeté : on ne perd pas le lien connu, la réconciliation le rétablira.
    const unknownCompany = record.companyId !== null && !company;
    const companyId = unknownCompany ? (existing?.companyId ?? null) : (company?.id ?? null);

    if (!existing) {
      await contacts.insertContact(tx, {
        twentyId: record.id,
        companyId,
        ...contactTwentyColumns(record),
      });
      return "applied";
    }
    if (isStaleVersion(existing.twentySyncedAt, record.updatedAt)) return "skipped";

    if (companyId !== existing.companyId) {
      if (await contacts.findPortalMembershipForContact(tx, existing.id)) {
        // L'accès au portail porte sur un client : il ne change pas de client sans décision humaine.
        logger.warn("crm.sync.contact_move_refused", {
          contactId: existing.id,
          reason: "portal_membership",
        });
      } else {
        await contacts.moveContactToCompany(tx, existing.id, companyId);
      }
    }
    await contacts.updateContactRow(tx, existing.id, contactTwentyColumns(record));
    return "applied";
  });
}

async function resolveTargets(tx: Database, targets: readonly CrmActivityTarget[]) {
  const first = (type: CrmActivityTarget["type"]) =>
    targets.find((target) => target.type === type)?.id;
  const companyTwentyId = first("company");
  const personTwentyId = first("person");
  const opportunityTwentyId = first("opportunity");

  const [company, contact, opportunity] = await Promise.all([
    companyTwentyId ? companies.findCompanyByTwentyId(tx, companyTwentyId) : null,
    personTwentyId ? contacts.findContactByTwentyId(tx, personTwentyId) : null,
    opportunityTwentyId ? activities.findOpportunityLinkByTwentyId(tx, opportunityTwentyId) : null,
  ]);

  const companyId = company?.id ?? opportunity?.companyId ?? contact?.companyId ?? null;
  const sameCompany = (linked: string | null | undefined) =>
    linked === null || linked === undefined || linked === companyId;
  if (!sameCompany(contact?.companyId) || !sameCompany(opportunity?.companyId)) {
    logger.warn("crm.sync.activity_cross_company", {
      companyTwentyId,
      personTwentyId,
      opportunityTwentyId,
    });
  }
  return {
    companyId,
    contactId: contact && contact.companyId === companyId ? contact.id : null,
    opportunityId: opportunity && opportunity.companyId === companyId ? opportunity.id : null,
  };
}

async function projectActivity(
  db: Database,
  kind: "note" | "task",
  record: Omit<CrmNote, "targets"> & { dueAt?: string | null; status?: CrmTask["status"] },
  targets: readonly CrmActivityTarget[] | undefined,
): Promise<ProjectionOutcome> {
  return db.transaction(async (tx) => {
    if (record.deletedAt) {
      // `activities` n'a pas d'archivage : la ligne projetée part, Twenty garde la fiche archivée.
      return (await activities.deleteActivityByTwentyId(tx, record.id)) ? "removed" : "skipped";
    }
    const existing = await activities.findActivityByTwentyId(tx, record.id);
    const links = targets ? await resolveTargets(tx, targets) : undefined;
    const fields: Partial<Activity> = {
      subject: record.title,
      body: record.bodyMarkdown,
      ...(kind === "task"
        ? {
            dueAt: record.dueAt ? new Date(record.dueAt) : null,
            completedAt:
              record.status === "DONE"
                ? (existing?.completedAt ?? new Date(record.updatedAt))
                : null,
          }
        : {}),
      ...links,
    };
    if (existing) {
      await activities.updateActivityRow(tx, existing.id, fields);
      return "applied";
    }
    const inserted = await activities.insertActivity(tx, {
      twentyId: record.id,
      kind,
      subject: record.title,
      occurredAt: new Date(record.createdAt),
      ...fields,
    });
    if (inserted?.opportunityId) {
      await activities.touchOpportunityActivity(
        tx,
        inserted.opportunityId,
        new Date(record.updatedAt),
      );
    }
    return "applied";
  });
}

/** `targets` absent (webhook de la note seule) : les liens connus ne bougent pas. */
export function projectNote(
  db: Database,
  record: Omit<CrmNote, "targets">,
  targets?: readonly CrmActivityTarget[],
): Promise<ProjectionOutcome> {
  return projectActivity(db, "note", record, targets);
}

export function projectTask(
  db: Database,
  record: Omit<CrmTask, "targets">,
  targets?: readonly CrmActivityTarget[],
): Promise<ProjectionOutcome> {
  return projectActivity(db, "task", record, targets);
}
