import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  changeRequests,
  clientRequirements,
  companies,
  deliverableReviews,
  deliverables,
  documents,
  handoverChecklistItems,
  projectBlockers,
  projectMembers,
  projectPhases,
  projects,
  quotes,
  tasks,
  tickets,
  type ChangeRequest,
  type ClientRequirement,
  type Deliverable,
  type DeliverableReview,
  type HandoverChecklistItem,
  type ProjectBlocker,
  type ProjectPhase,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/** Jalons, livrables, contenus attendus, blocages, demandes de changement, passation. */

// --- Jalons ------------------------------------------------------------------------------------

export async function listPhases(db: Database, projectId: string): Promise<ProjectPhase[]> {
  return db
    .select()
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, projectId), isNull(projectPhases.archivedAt)))
    .orderBy(asc(projectPhases.position), asc(projectPhases.createdAt));
}

export async function findPhase(db: Database, phaseId: string): Promise<ProjectPhase | null> {
  const [row] = await db
    .select()
    .from(projectPhases)
    .where(and(eq(projectPhases.id, phaseId), isNull(projectPhases.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Ce qui rattache encore des éléments à ce jalon : tâches et livrables non archivés. */
export async function countPhaseDependents(
  tx: Database,
  phaseId: string,
): Promise<{ tasks: number; deliverables: number }> {
  const [taskRow] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.phaseId, phaseId), isNull(tasks.archivedAt)));
  const [deliverableRow] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(deliverables)
    .where(and(eq(deliverables.phaseId, phaseId), isNull(deliverables.archivedAt)));
  return { tasks: taskRow?.total ?? 0, deliverables: deliverableRow?.total ?? 0 };
}

export async function insertPhases(
  tx: Database,
  values: (typeof projectPhases.$inferInsert)[],
): Promise<ProjectPhase[]> {
  if (values.length === 0) return [];
  return tx.insert(projectPhases).values(values).returning();
}

export async function updatePhase(
  tx: Database,
  phaseId: string,
  values: Partial<typeof projectPhases.$inferInsert>,
): Promise<ProjectPhase> {
  const [row] = await tx
    .update(projectPhases)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(projectPhases.id, phaseId))
    .returning();
  if (!row) throw new Error("Jalon non modifié.");
  return row;
}

export async function completeOpenPhases(tx: Database, projectId: string): Promise<void> {
  await tx
    .update(projectPhases)
    .set({ status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(projectPhases.projectId, projectId),
        isNull(projectPhases.archivedAt),
        sql`${projectPhases.status} <> 'done'`,
      ),
    );
}

export async function nextPhasePosition(tx: Database, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(${projectPhases.position}), 0)::int` })
    .from(projectPhases)
    .where(eq(projectPhases.projectId, projectId));
  return (row?.last ?? 0) + 1;
}

// --- Intervenants ------------------------------------------------------------------------------

export async function insertProjectMember(
  tx: Database,
  values: typeof projectMembers.$inferInsert,
): Promise<boolean> {
  const rows = await tx
    .insert(projectMembers)
    .values(values)
    .onConflictDoNothing({ target: [projectMembers.projectId, projectMembers.memberId] })
    .returning({ id: projectMembers.id });
  return rows.length > 0;
}

export async function deleteProjectMember(
  tx: Database,
  input: { projectId: string; memberId: string },
): Promise<boolean> {
  const rows = await tx
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, input.projectId),
        eq(projectMembers.memberId, input.memberId),
      ),
    )
    .returning({ id: projectMembers.id });
  return rows.length > 0;
}

// --- Livrables ---------------------------------------------------------------------------------

export interface DeliverableRow extends Deliverable {
  documentTitle: string | null;
}

export async function listDeliverables(db: Database, projectId: string): Promise<DeliverableRow[]> {
  const rows = await db
    .select({ deliverable: deliverables, documentTitle: documents.title })
    .from(deliverables)
    .leftJoin(documents, eq(documents.id, deliverables.documentId))
    .where(and(eq(deliverables.projectId, projectId), isNull(deliverables.archivedAt)))
    .orderBy(asc(deliverables.createdAt));
  return rows.map((row) => ({ ...row.deliverable, documentTitle: row.documentTitle }));
}

export async function reviewsByDeliverable(
  db: Database,
  deliverableIds: readonly string[],
): Promise<Map<string, DeliverableReview[]>> {
  const result = new Map<string, DeliverableReview[]>();
  if (deliverableIds.length === 0) return result;
  const rows = await db
    .select()
    .from(deliverableReviews)
    .where(inArray(deliverableReviews.deliverableId, [...deliverableIds]))
    .orderBy(desc(deliverableReviews.at));
  for (const row of rows) {
    const list = result.get(row.deliverableId);
    if (list) list.push(row);
    else result.set(row.deliverableId, [row]);
  }
  return result;
}

export interface DeliverableScopeRow {
  deliverable: Deliverable;
  companyId: string;
  projectStatus: string;
  projectArchivedAt: Date | null;
}

export async function findDeliverableScope(
  db: Database,
  deliverableId: string,
): Promise<DeliverableScopeRow | null> {
  const [row] = await db
    .select({
      deliverable: deliverables,
      companyId: projects.companyId,
      projectStatus: projects.status,
      projectArchivedAt: projects.archivedAt,
    })
    .from(deliverables)
    .innerJoin(projects, eq(projects.id, deliverables.projectId))
    .where(and(eq(deliverables.id, deliverableId), isNull(deliverables.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function insertDeliverable(
  tx: Database,
  values: typeof deliverables.$inferInsert,
): Promise<Deliverable> {
  const [row] = await tx.insert(deliverables).values(values).returning();
  if (!row) throw new Error("Livrable non créé.");
  return row;
}

export async function updateDeliverable(
  tx: Database,
  deliverableId: string,
  values: Partial<typeof deliverables.$inferInsert>,
): Promise<Deliverable> {
  const [row] = await tx
    .update(deliverables)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(deliverables.id, deliverableId))
    .returning();
  if (!row) throw new Error("Livrable non modifié.");
  return row;
}

export async function countDeliverableReviews(
  tx: Database,
  deliverableId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(deliverableReviews)
    .where(eq(deliverableReviews.deliverableId, deliverableId));
  return row?.total ?? 0;
}

export async function insertReview(
  tx: Database,
  values: typeof deliverableReviews.$inferInsert,
): Promise<DeliverableReview> {
  const [row] = await tx.insert(deliverableReviews).values(values).returning();
  if (!row) throw new Error("Décision non enregistrée.");
  return row;
}

export async function findReviewOfVersion(
  db: Database,
  deliverableId: string,
  version: number,
): Promise<DeliverableReview | null> {
  const [row] = await db
    .select()
    .from(deliverableReviews)
    .where(
      and(
        eq(deliverableReviews.deliverableId, deliverableId),
        eq(deliverableReviews.version, version),
      ),
    )
    .orderBy(desc(deliverableReviews.at))
    .limit(1);
  return row ?? null;
}

export async function countChangeRounds(db: Database, deliverableId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deliverableReviews)
    .where(
      and(
        eq(deliverableReviews.deliverableId, deliverableId),
        eq(deliverableReviews.decision, "changes_requested"),
      ),
    );
  return row?.count ?? 0;
}

/** Livrables à valider par le client et pas encore validés : ils empêchent la livraison. */
export async function listUnvalidatedClientDeliverables(
  db: Database,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ title: deliverables.title })
    .from(deliverables)
    .where(
      and(
        eq(deliverables.projectId, projectId),
        isNull(deliverables.archivedAt),
        eq(deliverables.requiresClientValidation, true),
        sql`${deliverables.status} <> 'validated'`,
      ),
    );
  return rows.map((row) => row.title);
}

// --- Contenus attendus -------------------------------------------------------------------------

export interface RequirementRow extends ClientRequirement {
  documentTitle: string | null;
}

export async function listRequirements(db: Database, projectId: string): Promise<RequirementRow[]> {
  const rows = await db
    .select({ requirement: clientRequirements, documentTitle: documents.title })
    .from(clientRequirements)
    .leftJoin(documents, eq(documents.id, clientRequirements.documentId))
    .where(and(eq(clientRequirements.projectId, projectId), isNull(clientRequirements.archivedAt)))
    .orderBy(sql`${clientRequirements.dueOn} asc nulls last`, asc(clientRequirements.createdAt));
  return rows.map((row) => ({ ...row.requirement, documentTitle: row.documentTitle }));
}

export interface RequirementScopeRow {
  requirement: ClientRequirement;
  companyId: string;
  projectArchivedAt: Date | null;
  projectStatus: string;
}

export async function findRequirementScope(
  db: Database,
  requirementId: string,
): Promise<RequirementScopeRow | null> {
  const [row] = await db
    .select({
      requirement: clientRequirements,
      companyId: projects.companyId,
      projectArchivedAt: projects.archivedAt,
      projectStatus: projects.status,
    })
    .from(clientRequirements)
    .innerJoin(projects, eq(projects.id, clientRequirements.projectId))
    .where(and(eq(clientRequirements.id, requirementId), isNull(clientRequirements.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function insertRequirement(
  tx: Database,
  values: typeof clientRequirements.$inferInsert,
): Promise<ClientRequirement> {
  const [row] = await tx.insert(clientRequirements).values(values).returning();
  if (!row) throw new Error("Contenu attendu non créé.");
  return row;
}

export async function updateRequirement(
  tx: Database,
  requirementId: string,
  values: Partial<typeof clientRequirements.$inferInsert>,
): Promise<ClientRequirement> {
  const [row] = await tx
    .update(clientRequirements)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(clientRequirements.id, requirementId))
    .returning();
  if (!row) throw new Error("Contenu attendu non modifié.");
  return row;
}

// --- Blocages ----------------------------------------------------------------------------------

export async function listBlockers(db: Database, projectId: string): Promise<ProjectBlocker[]> {
  return db
    .select()
    .from(projectBlockers)
    .where(eq(projectBlockers.projectId, projectId))
    .orderBy(sql`${projectBlockers.resolvedAt} desc nulls first`, desc(projectBlockers.raisedAt));
}

export async function findBlocker(db: Database, blockerId: string): Promise<ProjectBlocker | null> {
  const [row] = await db
    .select()
    .from(projectBlockers)
    .where(eq(projectBlockers.id, blockerId))
    .limit(1);
  return row ?? null;
}

export async function insertBlocker(
  tx: Database,
  values: typeof projectBlockers.$inferInsert,
): Promise<ProjectBlocker> {
  const [row] = await tx.insert(projectBlockers).values(values).returning();
  if (!row) throw new Error("Blocage non créé.");
  return row;
}

export async function updateBlocker(
  tx: Database,
  blockerId: string,
  values: Partial<typeof projectBlockers.$inferInsert>,
): Promise<ProjectBlocker> {
  const [row] = await tx
    .update(projectBlockers)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(projectBlockers.id, blockerId))
    .returning();
  if (!row) throw new Error("Blocage non modifié.");
  return row;
}

export async function countOpenBlockers(db: Database, projectId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectBlockers)
    .where(and(eq(projectBlockers.projectId, projectId), isNull(projectBlockers.resolvedAt)));
  return row?.count ?? 0;
}

// --- Demandes de changement --------------------------------------------------------------------

export interface ChangeRequestRow extends ChangeRequest {
  quoteNumber: string | null;
}

export async function listChangeRequests(
  db: Database,
  projectId: string,
): Promise<ChangeRequestRow[]> {
  const rows = await db
    .select({ changeRequest: changeRequests, quoteNumber: quotes.number })
    .from(changeRequests)
    .leftJoin(quotes, eq(quotes.id, changeRequests.quoteId))
    .where(eq(changeRequests.projectId, projectId))
    .orderBy(desc(changeRequests.createdAt));
  return rows.map((row) => ({ ...row.changeRequest, quoteNumber: row.quoteNumber }));
}

export async function listChangeRequestsOfCompany(
  db: Database,
  input: { companyId: string; limit: number },
): Promise<ChangeRequest[]> {
  return db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.companyId, input.companyId))
    .orderBy(desc(changeRequests.createdAt))
    .limit(input.limit);
}

export async function findChangeRequest(
  db: Database,
  changeRequestId: string,
): Promise<ChangeRequest | null> {
  const [row] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);
  return row ?? null;
}

/** Une demande peut n'avoir aucun projet : son propre verrou sérialise les décisions. */
/** La demande transformée en ce devis, s'il y en a une. */
export async function findChangeRequestOfQuote(
  db: Database,
  quoteId: string,
): Promise<ChangeRequest | null> {
  const [row] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.quoteId, quoteId))
    .limit(1);
  return row ?? null;
}

export async function lockChangeRequest(
  tx: Database,
  changeRequestId: string,
): Promise<ChangeRequest | null> {
  const [row] = await tx
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .for("update");
  return row ?? null;
}

/** Deux conversions simultanées d'un même ticket ne créent qu'une demande. */
export async function lockTicket(tx: Database, ticketId: string): Promise<void> {
  await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).for("update");
}

/** Demande encore vivante d'un ticket : l'ouvrir deux fois n'en crée pas deux. */
export async function findLiveChangeRequestOfTicket(
  db: Database,
  ticketId: string,
): Promise<ChangeRequest | null> {
  const [row] = await db
    .select()
    .from(changeRequests)
    .where(and(eq(changeRequests.ticketId, ticketId), sql`${changeRequests.status} <> 'refused'`))
    .limit(1);
  return row ?? null;
}

export async function insertChangeRequest(
  tx: Database,
  values: typeof changeRequests.$inferInsert,
): Promise<ChangeRequest> {
  const [row] = await tx.insert(changeRequests).values(values).returning();
  if (!row) throw new Error("Demande de changement non créée.");
  return row;
}

export async function updateChangeRequest(
  tx: Database,
  changeRequestId: string,
  values: Partial<typeof changeRequests.$inferInsert>,
): Promise<ChangeRequest> {
  const [row] = await tx
    .update(changeRequests)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(changeRequests.id, changeRequestId))
    .returning();
  if (!row) throw new Error("Demande de changement non modifiée.");
  return row;
}

export async function companyOfTicket(
  db: Database,
  ticketId: string,
): Promise<{ companyId: string } | null> {
  const [row] = await db
    .select({ companyId: tickets.companyId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row ?? null;
}

export async function findQuoteCompany(
  db: Database,
  quoteId: string,
): Promise<{ companyId: string } | null> {
  const [row] = await db
    .select({ companyId: quotes.companyId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row ?? null;
}

// --- Passation ---------------------------------------------------------------------------------

export async function listHandover(
  db: Database,
  projectId: string,
): Promise<HandoverChecklistItem[]> {
  return db
    .select()
    .from(handoverChecklistItems)
    .where(
      and(
        eq(handoverChecklistItems.projectId, projectId),
        isNull(handoverChecklistItems.archivedAt),
      ),
    )
    .orderBy(asc(handoverChecklistItems.position), asc(handoverChecklistItems.createdAt));
}

export async function findHandoverItem(
  db: Database,
  itemId: string,
): Promise<HandoverChecklistItem | null> {
  const [row] = await db
    .select()
    .from(handoverChecklistItems)
    .where(and(eq(handoverChecklistItems.id, itemId), isNull(handoverChecklistItems.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function insertHandoverItems(
  tx: Database,
  values: (typeof handoverChecklistItems.$inferInsert)[],
): Promise<HandoverChecklistItem[]> {
  if (values.length === 0) return [];
  return tx.insert(handoverChecklistItems).values(values).returning();
}

export async function updateHandoverItem(
  tx: Database,
  itemId: string,
  values: Partial<typeof handoverChecklistItems.$inferInsert>,
): Promise<HandoverChecklistItem> {
  const [row] = await tx
    .update(handoverChecklistItems)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(handoverChecklistItems.id, itemId))
    .returning();
  if (!row) throw new Error("Point de passation non modifié.");
  return row;
}

export async function nextHandoverPosition(tx: Database, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number>`coalesce(max(${handoverChecklistItems.position}), 0)::int` })
    .from(handoverChecklistItems)
    .where(eq(handoverChecklistItems.projectId, projectId));
  return (row?.last ?? 0) + 1;
}

// --- Calendrier --------------------------------------------------------------------------------

export interface CalendarPhaseRow {
  id: string;
  name: string;
  status: ProjectPhase["status"];
  dueOn: string;
  projectId: string;
  projectName: string;
  companyName: string;
}

export async function listPhasesDueBetween(
  db: Database,
  input: { from: string; to: string; projectIds: readonly string[] | null; limit: number },
): Promise<CalendarPhaseRow[]> {
  if (input.projectIds !== null && input.projectIds.length === 0) return [];
  const rows = await db
    .select({
      id: projectPhases.id,
      name: projectPhases.name,
      status: projectPhases.status,
      dueOn: projectPhases.dueOn,
      projectId: projectPhases.projectId,
      projectName: projects.name,
      companyName: companies.name,
    })
    .from(projectPhases)
    .innerJoin(projects, eq(projects.id, projectPhases.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(
      and(
        sql`${projectPhases.dueOn} between ${input.from} and ${input.to}`,
        isNull(projectPhases.archivedAt),
        isNull(projects.archivedAt),
        input.projectIds === null
          ? undefined
          : inArray(projectPhases.projectId, [...input.projectIds]),
      ),
    )
    .orderBy(asc(projectPhases.dueOn), asc(projectPhases.position))
    .limit(input.limit);
  return rows.flatMap((row) => (row.dueOn ? [{ ...row, dueOn: row.dueOn }] : []));
}
