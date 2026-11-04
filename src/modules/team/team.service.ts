import { recordAudit } from "@/modules/audit/audit.service";
import { monthRange, parisToday } from "@/modules/time/calendar";
import { getCapacityOverview, type MemberCapacity } from "@/modules/time/capacity.service";
import { getWorkOptions } from "@/modules/time/time.service";
import type { MemberKind, MissionStatus } from "@/lib/domain-enums";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { isUniqueViolation } from "@/server/db/errors";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { pageOffset, paginated, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { assertMissionTransition } from "./mission.status";
import { getMemberIdForUser, listAssignableMembers, type MemberOption } from "./team.lookup";
import * as teamRepository from "./team.repository";
import {
  absenceSchema,
  isUuid,
  linkUserSchema,
  memberSchema,
  missionSchema,
  missionTransitionSchema,
} from "./team.schema";

/** Fenêtre dans laquelle un envoi identique du même formulaire est un double clic. */
const DUPLICATE_WINDOW_MS = 10_000;

/** Vrai si chaque valeur à écrire est déjà en base, tableaux compris. */
function hasNoChange(values: object, current: object): boolean {
  const stored = current as Record<string, unknown>;
  return Object.entries(values).every(
    ([key, value]) => JSON.stringify(value) === JSON.stringify(stored[key]),
  );
}

const STAFF_KINDS: readonly MemberKind[] = ["partner", "employee"];
const CONTRACTOR_KINDS: readonly MemberKind[] = ["contractor"];

export interface TeamAccess {
  canManage: boolean;
  canReadCosts: boolean;
  canLinkUsers: boolean;
  canReadTime: boolean;
}

export function getTeamAccess(ctx: ServiceContext): TeamAccess {
  return {
    canManage: can(ctx.actor, "team:manage"),
    canReadCosts: can(ctx.actor, "team:read_costs"),
    canLinkUsers: can(ctx.actor, "users:manage"),
    canReadTime: can(ctx.actor, "time:read"),
  };
}

// --- Vues : coûts, tarifs et conditions ne sortent qu'avec `team:read_costs` -----------------------

type MemberRow = NonNullable<Awaited<ReturnType<typeof teamRepository.getMember>>>;

/**
 * `conditions` est un texte libre qui contient des tarifs (« Tarifs, conditions », 12.02.02) :
 * même règle que les coûts. `userId` reste lisible pour afficher « compte relié ».
 */
export type MemberView = Omit<MemberRow, "hourlyCostCents" | "dayRateCents" | "conditions"> & {
  hourlyCostCents?: number | null;
  dayRateCents?: number | null;
  conditions?: string | null;
};

function toMemberView(ctx: ServiceContext, row: MemberRow): MemberView {
  const { hourlyCostCents, dayRateCents, conditions, ...rest } = row;
  if (!can(ctx.actor, "team:read_costs")) return rest;
  return { ...rest, hourlyCostCents, dayRateCents, conditions };
}

export type MissionView = Omit<
  teamRepository.MissionRow,
  "plannedCostCents" | "committedCostCents"
> & {
  plannedCostCents?: number | null;
  committedCostCents?: number | null;
};

function toMissionView(ctx: ServiceContext, row: teamRepository.MissionRow): MissionView {
  const { plannedCostCents, committedCostCents, ...rest } = row;
  if (!can(ctx.actor, "team:read_costs")) return rest;
  return { ...rest, plannedCostCents, committedCostCents };
}

// --- Écran 22 ---------------------------------------------------------------------------------------

export interface MemberCard {
  member: MemberView;
  capacity: MemberCapacity | null;
  absences: { startOn: string; endOn: string; reason: string | null }[];
}

export interface ContractorSummary {
  member: MemberView;
  missionsTotal: number;
  missionsOpen: number;
  missionsDelivered: number;
  lastDueOn: string | null;
  /** Absents sans `team:read_costs`. */
  plannedCostCents?: number;
  committedCostCents?: number;
}

export interface TeamOverview {
  counts: Record<MemberKind, number>;
  members: Paginated<MemberCard>;
  missions: Paginated<MissionView>;
  contractors: Paginated<ContractorSummary>;
  /** Totaux de sous-traitance : absents sans `team:read_costs`. */
  subcontracting: { plannedCostCents: number; committedCostCents: number } | null;
}

async function buildCards(ctx: ServiceContext, rows: readonly MemberRow[]): Promise<MemberCard[]> {
  const today = parisToday();
  const month = monthRange(today);
  const [capacity, absences] = await Promise.all([
    getCapacityOverview(ctx.db, month, { today }),
    teamRepository.listAbsencesBetween(
      ctx.db,
      rows.map((row) => row.id),
      month.from,
      month.to,
    ),
  ]);
  const byMember = new Map(capacity.members.map((item) => [item.memberId, item]));
  return rows.map((row) => ({
    member: toMemberView(ctx, row),
    capacity: byMember.get(row.id) ?? null,
    absences: absences
      .filter((absence) => absence.memberId === row.id)
      .map(({ startOn, endOn, reason }) => ({ startOn, endOn, reason })),
  }));
}

async function buildContractors(
  ctx: ServiceContext,
  rows: readonly MemberRow[],
): Promise<ContractorSummary[]> {
  const summaries = await teamRepository.summarizeMissions(
    ctx.db,
    rows.map((row) => row.id),
  );
  const byMember = new Map(summaries.map((row) => [row.memberId, row]));
  const readCosts = can(ctx.actor, "team:read_costs");
  return rows.map((row) => {
    const summary = byMember.get(row.id);
    return {
      member: toMemberView(ctx, row),
      missionsTotal: summary?.total ?? 0,
      missionsOpen: summary?.open ?? 0,
      missionsDelivered: summary?.delivered ?? 0,
      lastDueOn: summary?.lastDueOn ?? null,
      ...(readCosts
        ? {
            plannedCostCents: summary?.plannedCostCents ?? 0,
            committedCostCents: summary?.committedCostCents ?? 0,
          }
        : {}),
    };
  });
}

/**
 * Tout l'écran 22 : cartes paginées, puis les premières missions ouvertes et les premiers prestataires.
 * Les deux listes complètes ont leur page, avec leur pagination serveur.
 */
export async function getTeamOverview(
  ctx: ServiceContext,
  options: { page: PageParams; missionsLimit?: number; contractorsLimit?: number },
): Promise<TeamOverview> {
  assertCan(ctx.actor, "team:read");
  const missionsLimit = options.missionsLimit ?? 8;
  const contractorsLimit = options.contractorsLimit ?? 5;
  const staffFilters = { kinds: STAFF_KINDS };
  const contractorFilters = { kinds: CONTRACTOR_KINDS };

  const [
    staffRows,
    staffTotal,
    missionRows,
    missionTotal,
    contractorRows,
    contractorTotal,
    kindCounts,
  ] = await Promise.all([
    teamRepository.listMembers(
      ctx.db,
      staffFilters,
      options.page.pageSize,
      pageOffset(options.page),
    ),
    teamRepository.countMembers(ctx.db, staffFilters),
    teamRepository.listMissions(ctx.db, { open: true }, missionsLimit, 0),
    teamRepository.countMissions(ctx.db, { open: true }),
    teamRepository.listMembers(ctx.db, contractorFilters, contractorsLimit, 0),
    teamRepository.countMembers(ctx.db, contractorFilters),
    teamRepository.countMembersByKind(ctx.db),
  ]);

  const [cards, contractors] = await Promise.all([
    buildCards(ctx, staffRows),
    buildContractors(ctx, contractorRows),
  ]);

  const counts: Record<MemberKind, number> = { partner: 0, employee: 0, contractor: 0 };
  for (const row of kindCounts) counts[row.kind] = row.total;

  // Tous les prestataires, pas seulement ceux affichés dans l'aperçu.
  const subcontracting = can(ctx.actor, "team:read_costs")
    ? await teamRepository.sumSubcontractingCosts(ctx.db)
    : null;

  return {
    counts,
    members: paginated(cards, staffTotal, options.page),
    missions: paginated(
      missionRows.map((row) => toMissionView(ctx, row)),
      missionTotal,
      { page: 1, pageSize: missionsLimit },
    ),
    contractors: paginated(contractors, contractorTotal, { page: 1, pageSize: contractorsLimit }),
    subcontracting,
  };
}

/** Annuaire complet des prestataires : spécialité, missions, et conditions avec `team:read_costs`. */
export async function listContractors(
  ctx: ServiceContext,
  filters: { search?: string; archived?: boolean },
  params: PageParams,
): Promise<Paginated<ContractorSummary>> {
  assertCan(ctx.actor, "team:read");
  const query = { ...filters, kinds: CONTRACTOR_KINDS };
  const [rows, total] = await Promise.all([
    teamRepository.listMembers(ctx.db, query, params.pageSize, pageOffset(params)),
    teamRepository.countMembers(ctx.db, query),
  ]);
  return paginated(await buildContractors(ctx, rows), total, params);
}

export async function listTeamMembers(
  ctx: ServiceContext,
  filters: teamRepository.MemberFilters,
  params: PageParams,
): Promise<Paginated<MemberView>> {
  assertCan(ctx.actor, "team:read");
  const [rows, total] = await Promise.all([
    teamRepository.listMembers(ctx.db, filters, params.pageSize, pageOffset(params)),
    teamRepository.countMembers(ctx.db, filters),
  ]);
  return paginated(
    rows.map((row) => toMemberView(ctx, row)),
    total,
    params,
  );
}

export interface MemberDetail {
  member: MemberView;
  capacity: MemberCapacity | null;
  absences: Awaited<ReturnType<typeof teamRepository.listAbsences>>;
  linkedUser: { id: string; name: string; email: string; role: string } | null;
  /** Bilan des missions : les coûts cumulés sont absents sans `team:read_costs`. */
  missionSummary: Omit<ContractorSummary, "member">;
}

export async function getTeamMember(ctx: ServiceContext, id: string): Promise<MemberDetail> {
  assertCan(ctx.actor, "team:read");
  if (!isUuid(id)) throw new NotFoundError("Membre introuvable.");
  const row = await teamRepository.getMember(ctx.db, id);
  if (!row) throw new NotFoundError("Membre introuvable.");
  const today = parisToday();
  const [capacity, absences, linkedUser, [summary]] = await Promise.all([
    getCapacityOverview(ctx.db, monthRange(today), { today }),
    teamRepository.listAbsences(ctx.db, id),
    row.userId && can(ctx.actor, "users:manage")
      ? teamRepository.getUser(ctx.db, row.userId)
      : Promise.resolve(null),
    buildContractors(ctx, [row]),
  ]);
  const { member: _member, ...missionSummary } = summary as ContractorSummary;
  return {
    member: toMemberView(ctx, row),
    capacity: capacity.members.find((item) => item.memberId === id) ?? null,
    absences,
    linkedUser,
    missionSummary,
  };
}

// --- Écritures sur les membres ----------------------------------------------------------------------

function assertCostFieldsAllowed(
  ctx: ServiceContext,
  data: {
    hourlyCostCents?: number | null;
    dayRateCents?: number | null;
    conditions?: string | null;
  },
): void {
  const touched =
    data.hourlyCostCents !== undefined ||
    data.dayRateCents !== undefined ||
    data.conditions !== undefined;
  if (touched && !can(ctx.actor, "team:read_costs")) {
    throw new ForbiddenError("Les coûts et les tarifs sont réservés au rôle Associé.");
  }
}

async function assertEmailFree(tx: Database, email: string | null | undefined, id?: string) {
  if (!email) return;
  if (await teamRepository.findMemberByEmail(tx, email, id)) {
    throw new ConflictError("Un membre utilise déjà cette adresse e-mail.", {
      email: ["Adresse déjà utilisée par un autre membre."],
    });
  }
}

export async function createTeamMember(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ id: string; created: boolean }> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(memberSchema, input);
  assertCostFieldsAllowed(ctx, data);

  return ctx.db.transaction(async (tx) => {
    await teamRepository.lockKey(tx, `team:member:${data.email?.toLowerCase() ?? data.fullName}`);
    const existing = await teamRepository.findRecentMember(
      tx,
      { fullName: data.fullName, kind: data.kind, email: data.email ?? null },
      new Date(Date.now() - DUPLICATE_WINDOW_MS),
    );
    if (existing) return { id: existing, created: false };
    await assertEmailFree(tx, data.email);

    const row = await teamRepository.insertMember(tx, {
      kind: data.kind,
      fullName: data.fullName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      title: data.title ?? null,
      specialty: data.specialty ?? null,
      skills: data.skills,
      status: data.status,
      weeklyCapacityMinutes: data.weeklyCapacityMinutes,
      hourlyCostCents: data.hourlyCostCents ?? null,
      dayRateCents: data.dayRateCents ?? null,
      conditions: data.conditions ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "team_member.created",
      entityType: "team_member",
      entityId: row.id,
      metadata: { kind: row.kind, fullName: row.fullName },
    });
    return { id: row.id, created: true };
  });
}

/** Un champ de coût absent reste tel quel : un formulaire sans ces champs ne les efface pas. */
export async function updateTeamMember(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(memberSchema, input);
  assertCostFieldsAllowed(ctx, data);
  if (!isUuid(id)) throw new NotFoundError("Membre introuvable.");

  await ctx.db.transaction(async (tx) => {
    const current = await teamRepository.getMember(tx, id);
    if (!current) throw new NotFoundError("Membre introuvable.");
    await assertEmailFree(tx, data.email, id);
    if (current.userId && current.kind !== data.kind) {
      const user = await teamRepository.getUser(tx, current.userId);
      if (user) assertKindMatchesRole(data.kind, user.role);
    }

    const costChanges = {
      hourlyCostCents:
        data.hourlyCostCents === undefined ? current.hourlyCostCents : data.hourlyCostCents,
      dayRateCents: data.dayRateCents === undefined ? current.dayRateCents : data.dayRateCents,
    };
    const costsChanged =
      costChanges.hourlyCostCents !== current.hourlyCostCents ||
      costChanges.dayRateCents !== current.dayRateCents;

    const values = {
      kind: data.kind,
      fullName: data.fullName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      title: data.title ?? null,
      specialty: data.specialty ?? null,
      skills: data.skills,
      status: data.status,
      weeklyCapacityMinutes: data.weeklyCapacityMinutes,
      ...costChanges,
      conditions: data.conditions === undefined ? current.conditions : data.conditions,
    };
    // Un second envoi du formulaire ne change rien : pas d'écriture, rien au journal.
    if (hasNoChange(values, current)) return;

    await teamRepository.updateMember(tx, id, values);

    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "team_member.updated",
      entityType: "team_member",
      entityId: id,
      metadata: { kind: data.kind, status: data.status },
    });
    if (costsChanged) {
      // Aucun montant au journal : il est lisible par des rôles sans `team:read_costs`.
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "team_member.costs_changed",
        entityType: "team_member",
        entityId: id,
      });
    }
  });
}

/** Une archive ne laisse pas de travail en plan : missions, tâches, demandes et projets ouverts bloquent. */
export async function archiveTeamMember(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "team:manage");
  if (!isUuid(id)) throw new NotFoundError("Membre introuvable.");
  await ctx.db.transaction(async (tx) => {
    const current = await teamRepository.getMember(tx, id);
    if (!current) throw new NotFoundError("Membre introuvable.");
    if (current.archivedAt) return;
    const open = await teamRepository.countOpenWork(tx, id);
    if (open.missions > 0 || open.tasks > 0 || open.tickets > 0 || open.projects > 0) {
      throw new ConflictError(
        `Ce membre a encore ${open.missions} mission(s), ${open.tasks} tâche(s), ${open.tickets} demande(s) et ${open.projects} projet(s) ouverts : réaffectez-les avant d'archiver.`,
      );
    }
    await teamRepository.updateMember(tx, id, { archivedAt: new Date(), status: "inactive" });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "team_member.archived",
      entityType: "team_member",
      entityId: id,
    });
  });
}

export async function restoreTeamMember(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "team:manage");
  if (!isUuid(id)) throw new NotFoundError("Membre introuvable.");
  await ctx.db.transaction(async (tx) => {
    const current = await teamRepository.getMember(tx, id);
    if (!current) throw new NotFoundError("Membre introuvable.");
    if (!current.archivedAt) return;
    // Une autre fiche vivante a pu reprendre cette adresse depuis l'archivage.
    await assertEmailFree(tx, current.email, id);
    await teamRepository.updateMember(tx, id, { archivedAt: null, status: "active" });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "team_member.restored",
      entityType: "team_member",
      entityId: id,
    });
  });
}

// --- Absences ----------------------------------------------------------------------------------------

/** Déclarer deux fois la même absence ne fait rien ; un autre chevauchement est refusé. */
export async function addMemberAbsence(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ id: string; created: boolean }> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(absenceSchema, input);

  return ctx.db.transaction(async (tx) => {
    const member = await teamRepository.getMember(tx, data.memberId);
    if (!member) throw new NotFoundError("Membre introuvable.");
    await teamRepository.lockKey(tx, `team:absence:${data.memberId}`);
    const overlap = await teamRepository.findOverlappingAbsence(
      tx,
      data.memberId,
      data.startOn,
      data.endOn,
    );
    if (overlap) {
      if (overlap.startOn === data.startOn && overlap.endOn === data.endOn) {
        return { id: overlap.id, created: false };
      }
      throw new ConflictError("Cette période chevauche une absence déjà déclarée.", {
        startOn: ["Cette période chevauche une absence déjà déclarée."],
      });
    }
    const row = await teamRepository.insertAbsence(tx, {
      memberId: data.memberId,
      startOn: data.startOn,
      endOn: data.endOn,
      reason: data.reason ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "member_absence.created",
      entityType: "member_absence",
      entityId: row.id,
      metadata: { memberId: data.memberId, startOn: data.startOn, endOn: data.endOn },
    });
    return { id: row.id, created: true };
  });
}

/** Déjà retirée : aucune erreur, rien de plus au journal. */
export async function removeMemberAbsence(ctx: ServiceContext, id: string): Promise<void> {
  assertCan(ctx.actor, "team:manage");
  if (!isUuid(id)) return;
  await ctx.db.transaction(async (tx) => {
    const absence = await teamRepository.getAbsence(tx, id);
    if (!absence) return;
    await teamRepository.deleteAbsence(tx, id);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "member_absence.deleted",
      entityType: "member_absence",
      entityId: id,
      metadata: {
        memberId: absence.memberId,
        startOn: absence.startOn,
        endOn: absence.endOn,
      },
    });
  });
}

// --- Compte relié ------------------------------------------------------------------------------------

/**
 * Un prestataire et son compte vont ensemble : un compte `member` sur une fiche de prestataire
 * lirait tout, un compte `contractor` sur une fiche interne perdrait son cloisonnement.
 */
function assertKindMatchesRole(kind: MemberKind, role: string): void {
  if ((kind === "contractor") !== (role === "contractor")) {
    throw new ConflictError(
      kind === "contractor"
        ? "Une fiche de prestataire se relie à un compte de rôle Prestataire."
        : "Un compte de rôle Prestataire se relie à une fiche de prestataire.",
      { userId: ["Le rôle du compte ne correspond pas au type de membre."] },
    );
  }
}

export interface LinkableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  linked: boolean;
}

export async function listLinkableUsers(
  ctx: ServiceContext,
  memberId: string,
): Promise<LinkableUser[]> {
  assertCan(ctx.actor, "users:manage");
  if (!isUuid(memberId)) throw new NotFoundError("Membre introuvable.");
  const rows = await teamRepository.listLinkableUsers(ctx.db, memberId);
  return rows.map(({ linkedMemberId, ...row }) => ({ ...row, linked: linkedMemberId !== null }));
}

/** Relier une fiche à un compte, ou l'en détacher (`userId` vide). Réservé à `users:manage`. */
export async function linkMemberToUser(
  ctx: ServiceContext,
  memberId: string,
  input: unknown,
): Promise<{ changed: boolean }> {
  assertCan(ctx.actor, "users:manage");
  const data = parseInput(linkUserSchema, input);
  const userId = data.userId ?? null;
  if (!isUuid(memberId)) throw new NotFoundError("Membre introuvable.");

  try {
    return await ctx.db.transaction(async (tx) => {
      const member = await teamRepository.getMember(tx, memberId);
      if (!member) throw new NotFoundError("Membre introuvable.");
      if (member.userId === userId) return { changed: false };

      if (userId) {
        const user = await teamRepository.getUser(tx, userId);
        if (!user) throw new NotFoundError("Compte introuvable.");
        if (user.role === "client") {
          throw new ConflictError("Un compte client ne se relie pas à une fiche d'équipe.", {
            userId: ["Un compte client ne se relie pas à une fiche d'équipe."],
          });
        }
        assertKindMatchesRole(member.kind, user.role);
        const linked = await teamRepository.findMemberByUser(tx, userId);
        if (linked) throw linkedConflict();
      }

      await teamRepository.updateMember(tx, memberId, { userId });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: userId ? "team_member.user_linked" : "team_member.user_unlinked",
        entityType: "team_member",
        entityId: memberId,
        metadata: { userId: userId ?? member.userId },
      });
      return { changed: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw linkedConflict();
    throw error;
  }
}

function linkedConflict(): ConflictError {
  return new ConflictError("Ce compte est déjà relié à une autre fiche.", {
    userId: ["Ce compte est déjà relié à une autre fiche."],
  });
}

// --- Missions ----------------------------------------------------------------------------------------

export async function listMissions(
  ctx: ServiceContext,
  filters: teamRepository.MissionFilters,
  params: PageParams,
): Promise<Paginated<MissionView>> {
  assertCan(ctx.actor, "team:read");
  if (filters.memberId && !isUuid(filters.memberId)) return paginated([], 0, params);
  const [rows, total] = await Promise.all([
    teamRepository.listMissions(ctx.db, filters, params.pageSize, pageOffset(params)),
    teamRepository.countMissions(ctx.db, filters),
  ]);
  return paginated(
    rows.map((row) => toMissionView(ctx, row)),
    total,
    params,
  );
}

/** Mission d'un autre : 404 pour un prestataire, le périmètre est sa fiche. */
export async function getMission(ctx: ServiceContext, id: string): Promise<MissionView> {
  assertCanAny(ctx.actor, ["team:read", "time:create_own"]);
  if (!isUuid(id)) throw new NotFoundError("Mission introuvable.");
  const row = await teamRepository.getMission(ctx.db, id);
  if (!row) throw new NotFoundError("Mission introuvable.");
  if (!can(ctx.actor, "team:read")) {
    const own = await getMemberIdForUser(ctx.db, ctx.actor.userId);
    if (row.memberId !== own) throw new NotFoundError("Mission introuvable.");
  }
  return toMissionView(ctx, row);
}

/** Missions ouvertes de l'acteur, pour un prestataire qui n'a pas `team:read`. */
export async function listMyMissions(ctx: ServiceContext, limit = 10): Promise<MissionView[]> {
  assertCanAny(ctx.actor, ["team:read", "time:create_own"]);
  const own = await getMemberIdForUser(ctx.db, ctx.actor.userId);
  if (!own) return [];
  const rows = await teamRepository.listMissions(ctx.db, { memberId: own, open: true }, limit, 0);
  return rows.map((row) => toMissionView(ctx, row));
}

export interface CompanyMissionRow {
  id: string;
  title: string;
  memberName: string;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableReceivedOn: string | null;
  dueOn: string | null;
  status: MissionStatus;
}

/** Fiche client 360° : missions du client, sans aucun coût. */
export async function listMissionsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<CompanyMissionRow[]> {
  assertCan(ctx.actor, "team:read");
  if (!isUuid(companyId)) return [];
  const rows = await teamRepository.listMissions(
    ctx.db,
    { companyId },
    Math.min(options.limit ?? 10, 100),
    0,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    memberName: row.memberName,
    projectName: row.projectName,
    deliverableLabel: row.deliverableLabel,
    deliverableReceivedOn: row.deliverableReceivedOn,
    dueOn: row.dueOn,
    status: row.status,
  }));
}

async function resolveMissionLinks(
  tx: Database,
  input: { projectId?: string | null; taskId?: string | null; ticketId?: string | null },
) {
  const task = input.taskId ? await teamRepository.getTaskLink(tx, input.taskId) : null;
  if (input.taskId && !task) throw new NotFoundError("Tâche introuvable.");
  const projectId = input.projectId ?? task?.projectId ?? null;
  if (task && task.projectId !== projectId) {
    throw new ConflictError("Cette tâche n'appartient pas à ce projet.", {
      taskId: ["Cette tâche n'appartient pas à ce projet."],
    });
  }
  const project = projectId ? await teamRepository.getProjectLink(tx, projectId) : null;
  if (projectId && !project) throw new NotFoundError("Projet introuvable.");
  const ticket = input.ticketId ? await teamRepository.getTicketLink(tx, input.ticketId) : null;
  if (input.ticketId && !ticket) throw new NotFoundError("Demande introuvable.");
  if (project && ticket && project.companyId !== ticket.companyId) {
    throw new ConflictError("Ce projet et cette demande ne sont pas du même client.", {
      ticketId: ["Choisissez une demande du même client que le projet."],
    });
  }
  return {
    projectId,
    taskId: task?.id ?? null,
    ticketId: ticket?.id ?? null,
    companyId: project?.companyId ?? ticket?.companyId ?? null,
  };
}

async function assertActiveMember(tx: Database, memberId: string): Promise<void> {
  const member = await teamRepository.getMember(tx, memberId);
  if (!member) throw new NotFoundError("Intervenant introuvable.");
  if (member.archivedAt || member.status !== "active") {
    throw new ConflictError("Cet intervenant n'est plus actif.", {
      memberId: ["Choisissez un intervenant actif."],
    });
  }
}

/** Affecter une mission. Un second envoi identique dans les 10 secondes renvoie la même mission. */
export async function createMission(
  ctx: ServiceContext,
  input: unknown,
): Promise<{ id: string; created: boolean }> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(missionSchema, input);
  assertCostFieldsAllowed(ctx, {
    hourlyCostCents: data.plannedCostCents,
    dayRateCents: data.committedCostCents,
  });

  return ctx.db.transaction(async (tx) => {
    await assertActiveMember(tx, data.memberId);
    const links = await resolveMissionLinks(tx, data);
    await teamRepository.lockKey(tx, `team:mission:${data.memberId}:${data.title}`);
    const existing = await teamRepository.findRecentMission(
      tx,
      {
        memberId: data.memberId,
        title: data.title,
        projectId: links.projectId,
        ticketId: links.ticketId,
      },
      new Date(Date.now() - DUPLICATE_WINDOW_MS),
    );
    if (existing) return { id: existing, created: false };

    const row = await teamRepository.insertMission(tx, {
      ...links,
      memberId: data.memberId,
      title: data.title,
      deliverableLabel: data.deliverableLabel ?? null,
      dueOn: data.dueOn ?? null,
      plannedCostCents: data.plannedCostCents ?? null,
      committedCostCents: data.committedCostCents ?? null,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "mission.created",
      entityType: "mission",
      entityId: row.id,
      metadata: { memberId: data.memberId, projectId: links.projectId, title: data.title },
    });
    return { id: row.id, created: true };
  });
}

export async function updateMission(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(missionSchema, input);
  assertCostFieldsAllowed(ctx, {
    hourlyCostCents: data.plannedCostCents,
    dayRateCents: data.committedCostCents,
  });
  if (!isUuid(id)) throw new NotFoundError("Mission introuvable.");

  await ctx.db.transaction(async (tx) => {
    const current = await teamRepository.getMission(tx, id);
    if (!current) throw new NotFoundError("Mission introuvable.");
    if (data.memberId !== current.memberId) await assertActiveMember(tx, data.memberId);
    const links = await resolveMissionLinks(tx, data);
    const values = {
      ...links,
      memberId: data.memberId,
      title: data.title,
      deliverableLabel: data.deliverableLabel ?? null,
      dueOn: data.dueOn ?? null,
      plannedCostCents:
        data.plannedCostCents === undefined ? current.plannedCostCents : data.plannedCostCents,
      committedCostCents:
        data.committedCostCents === undefined
          ? current.committedCostCents
          : data.committedCostCents,
    };
    // Un second envoi du formulaire ne change rien : pas d'écriture, rien au journal.
    if (hasNoChange(values, current)) return;
    await teamRepository.updateMission(tx, id, values);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "mission.updated",
      entityType: "mission",
      entityId: id,
      metadata: { memberId: data.memberId, projectId: links.projectId },
    });
  });
}

/**
 * Passer à l'état où elle est déjà ne fait rien. Livrée : la date de réception est posée, jamais
 * dans le futur. Le verrou fait passer deux clics simultanés l'un après l'autre : un seul audit.
 */
export async function transitionMission(
  ctx: ServiceContext,
  id: string,
  input: unknown,
): Promise<{ changed: boolean }> {
  assertCan(ctx.actor, "team:manage");
  const data = parseInput(missionTransitionSchema, input);
  if (!isUuid(id)) throw new NotFoundError("Mission introuvable.");
  if (data.deliverableReceivedOn && data.deliverableReceivedOn > parisToday()) {
    throw new ValidationError("Un livrable ne se reçoit pas à l'avance.", {
      deliverableReceivedOn: ["Choisissez aujourd'hui ou une date passée."],
    });
  }

  return ctx.db.transaction(async (tx) => {
    await teamRepository.lockKey(tx, `team:mission-status:${id}`);
    const current = await teamRepository.getMission(tx, id);
    if (!current) throw new NotFoundError("Mission introuvable.");
    if (current.status === data.status) return { changed: false };
    assertMissionTransition(current.status, data.status);

    const delivered = data.status === "delivered";
    await teamRepository.updateMission(tx, id, {
      status: data.status,
      deliverableReceivedOn: delivered
        ? (data.deliverableReceivedOn ?? parisToday())
        : current.status === "delivered"
          ? null
          : current.deliverableReceivedOn,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: delivered ? "mission.delivered" : "mission.status_changed",
      entityType: "mission",
      entityId: id,
      metadata: { fromStatus: current.status, toStatus: data.status },
    });
    return { changed: true };
  });
}

// --- Choix des formulaires -----------------------------------------------------------------------------

export interface MissionFormOptions {
  members: MemberOption[];
  projects: { id: string; label: string }[];
  tickets: { id: string; label: string }[];
}

export async function getMissionFormOptions(ctx: ServiceContext): Promise<MissionFormOptions> {
  assertCan(ctx.actor, "team:manage");
  const [members, work] = await Promise.all([
    listAssignableMembers(ctx.db),
    getWorkOptions(ctx.db),
  ]);
  return { members, projects: work.projects, tickets: work.tickets };
}
