import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertMissionTransition,
  canTransitionMission,
  MISSION_TRANSITIONS,
} from "@/modules/team/mission.status";
import {
  getAssignedProjectIds,
  getMemberIdForUser,
  isAssignedToProject,
  listAssignableMembers,
} from "@/modules/team/team.lookup";
import {
  addMemberAbsence,
  archiveTeamMember,
  createMission,
  createTeamMember,
  getMission,
  getMissionFormOptions,
  getTeamAccess,
  getTeamMember,
  getTeamOverview,
  linkMemberToUser,
  listContractors,
  listLinkableUsers,
  listMissions,
  listMissionsForCompany,
  listMyMissions,
  listTeamMembers,
  removeMemberAbsence,
  restoreTeamMember,
  transitionMission,
  updateMission,
  updateTeamMember,
} from "@/modules/team/team.service";
import { parisToday, addDays } from "@/modules/time/calendar";
import { createTimeEntry } from "@/modules/time/time.service";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestActor, createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createProject,
  createTask,
  createTeamMember as insertMember,
  createTicket,
} from "../../helpers/factories";

const PAGE = { page: 1, pageSize: 50 };
const today = parisToday();

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});

afterAll(async () => {
  await close();
});

async function auditCount(action: string, entityId: string) {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.entityId, entityId));
  return rows.filter((row) => row.action === action).length;
}

function memberInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "employee",
    fullName: `Fiche ${Math.random().toString(36).slice(2, 10)}`,
    weeklyCapacityMinutes: 2100,
    ...overrides,
  };
}

describe("fiches d'équipe", () => {
  it("crée une fiche avec compétences, disponibilité et audit", async () => {
    const admin = await createTestContext(db, "admin");
    const { id, created } = await createTeamMember(
      admin,
      memberInput({
        fullName: "Alix Martin",
        title: "Intégration",
        skills: "Next.js, Figma ; SEO",
        hourlyCostCents: "4500",
      }),
    );
    expect(created).toBe(true);
    const detail = await getTeamMember(admin, id);
    expect(detail.member.skills).toEqual(["Next.js", "Figma", "SEO"]);
    expect(detail.member.hourlyCostCents).toBe(4500);
    expect(await auditCount("team_member.created", id)).toBe(1);
  });

  it("un double envoi identique ne crée qu'une fiche", async () => {
    const admin = await createTestContext(db, "admin");
    const input = memberInput({ fullName: "Double Clic", email: "double@test.local" });
    const first = await createTeamMember(admin, input);
    const second = await createTeamMember(admin, input);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await auditCount("team_member.created", first.id)).toBe(1);
  });

  it("refuse une adresse déjà utilisée, en ignorant la casse", async () => {
    const admin = await createTestContext(db, "admin");
    await createTeamMember(admin, memberInput({ email: "pris@test.local" }));
    await expect(
      createTeamMember(admin, memberInput({ email: "PRIS@test.local" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse une saisie invalide", async () => {
    const admin = await createTestContext(db, "admin");
    await expect(
      createTeamMember(admin, memberInput({ weeklyCapacityMinutes: -1 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createTeamMember(admin, { kind: "employee" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("un formulaire sans champ de coût ne les efface pas", async () => {
    const admin = await createTestContext(db, "admin");
    const { id } = await createTeamMember(
      admin,
      memberInput({ hourlyCostCents: 4000, dayRateCents: 30000, conditions: "30 jours" }),
    );
    await updateTeamMember(admin, id, memberInput({ title: "Modifié" }));
    const { member } = await getTeamMember(admin, id);
    expect(member.title).toBe("Modifié");
    expect(member.hourlyCostCents).toBe(4000);
    expect(member.dayRateCents).toBe(30000);
    expect(member.conditions).toBe("30 jours");
    expect(await auditCount("team_member.costs_changed", id)).toBe(0);
  });

  it("journalise un changement de coût sans aucun montant", async () => {
    const admin = await createTestContext(db, "admin");
    const { id } = await createTeamMember(admin, memberInput({ hourlyCostCents: 4000 }));
    await updateTeamMember(admin, id, memberInput({ hourlyCostCents: 5000 }));
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, id));
    const change = rows.find((row) => row.action === "team_member.costs_changed");
    expect(change).toBeDefined();
    // Toutes les lignes de la fiche, pas seulement celle du changement de coût.
    expect(JSON.stringify(rows.map((row) => row.metadata))).not.toMatch(/4000|5000/);
  });

  it("un membre change de coût : le temps déjà saisi garde le coût figé", async () => {
    const admin = await createMemberContext(db, "admin", { hourlyCostCents: 4000 });
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const { id } = await createTimeEntry(admin, {
      workOn: today,
      minutes: 60,
      category: "production",
      projectId: project.id,
    });
    await updateTeamMember(
      admin,
      admin.member.id,
      memberInput({ fullName: admin.member.fullName, kind: "partner", hourlyCostCents: 9000 }),
    );
    const [entry] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    expect(entry?.hourlyCostCents).toBe(4000);
  });

  it("réponse 404 sur un identifiant inconnu ou malformé", async () => {
    const admin = await createTestContext(db, "admin");
    await expect(getTeamMember(admin, "pas-un-uuid")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getTeamMember(admin, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("archivage", () => {
  it("refuse tant qu'une mission ou une tâche reste ouverte", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id: missionId } = await createMission(admin, {
      memberId: member.id,
      title: "En cours",
    });
    await expect(archiveTeamMember(admin, member.id)).rejects.toBeInstanceOf(ConflictError);

    await transitionMission(admin, missionId, { status: "cancelled" });
    const task = await createTask(db, { assigneeMemberId: member.id });
    await expect(archiveTeamMember(admin, member.id)).rejects.toBeInstanceOf(ConflictError);

    await db
      .update(schema.tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(schema.tasks.id, task.id));
    await archiveTeamMember(admin, member.id);
    expect((await getTeamMember(admin, member.id)).member.status).toBe("inactive");
  });

  it("une archive quitte les listes, se répète sans effet et se restaure", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db, { fullName: "Archive Répétée" });
    await archiveTeamMember(admin, member.id);
    await archiveTeamMember(admin, member.id);
    expect(await auditCount("team_member.archived", member.id)).toBe(1);

    const live = await listTeamMembers(admin, { search: "Archive Répétée" }, PAGE);
    expect(live.total).toBe(0);
    const archived = await listTeamMembers(
      admin,
      { search: "Archive Répétée", archived: true },
      PAGE,
    );
    expect(archived.total).toBe(1);
    expect((await listAssignableMembers(db)).some((row) => row.id === member.id)).toBe(false);

    await restoreTeamMember(admin, member.id);
    await restoreTeamMember(admin, member.id);
    expect(await auditCount("team_member.restored", member.id)).toBe(1);
    expect((await getTeamMember(admin, member.id)).member.status).toBe("active");
  });
});

describe("absences", () => {
  it("déduit l'absence de la capacité du mois et se retire", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db, { weeklyCapacityMinutes: 2100 });
    const before = await getTeamMember(admin, member.id);

    // Un lundi à venir du mois courant n'existe pas toujours : on absente tout le mois.
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(`${monthStart}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const monthEnd = addDays(nextMonth.toISOString().slice(0, 10), -1);

    const { id } = await addMemberAbsence(admin, {
      memberId: member.id,
      startOn: monthStart,
      endOn: monthEnd,
      reason: "Congés",
    });
    const during = await getTeamMember(admin, member.id);
    expect(before.capacity?.capacityMinutes).toBeGreaterThan(0);
    expect(during.capacity?.capacityMinutes).toBe(0);
    expect(during.capacity?.loadPercent).toBeNull();
    expect(during.absences).toHaveLength(1);

    await removeMemberAbsence(admin, id);
    await removeMemberAbsence(admin, id);
    expect(await auditCount("member_absence.deleted", id)).toBe(1);
    expect((await getTeamMember(admin, member.id)).capacity?.capacityMinutes).toBe(
      before.capacity?.capacityMinutes,
    );
  });

  it("la même absence est idempotente, un autre chevauchement est refusé", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const input = { memberId: member.id, startOn: "2030-03-04", endOn: "2030-03-08" };
    const first = await addMemberAbsence(admin, input);
    const second = await addMemberAbsence(admin, input);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await auditCount("member_absence.created", first.id)).toBe(1);

    await expect(
      addMemberAbsence(admin, { ...input, startOn: "2030-03-07", endOn: "2030-03-12" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse une fin avant le début et un membre inconnu", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    await expect(
      addMemberAbsence(admin, { memberId: member.id, startOn: "2030-03-08", endOn: "2030-03-04" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addMemberAbsence(admin, {
        memberId: "00000000-0000-4000-8000-000000000000",
        startOn: "2030-03-04",
        endOn: "2030-03-08",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("compte relié", () => {
  it("seul `users:manage` relie ou voit les comptes", async () => {
    const member = await insertMember(db);
    const hugo = await createTestContext(db, "member");
    const viewer = await createTestContext(db, "viewer");
    const someone = await createTestActor(db, "member");
    for (const ctx of [hugo, viewer]) {
      await expect(
        linkMemberToUser(ctx, member.id, { userId: someone.userId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listLinkableUsers(ctx, member.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(getTeamAccess(hugo).canLinkUsers).toBe(false);
  });

  it("relie, se répète sans effet, détache", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const account = await createTestActor(db, "member");

    expect(await linkMemberToUser(admin, member.id, { userId: account.userId })).toEqual({
      changed: true,
    });
    expect(await linkMemberToUser(admin, member.id, { userId: account.userId })).toEqual({
      changed: false,
    });
    expect(await auditCount("team_member.user_linked", member.id)).toBe(1);
    expect(await getMemberIdForUser(db, account.userId)).toBe(member.id);

    expect(await linkMemberToUser(admin, member.id, { userId: "" })).toEqual({ changed: true });
    expect(await getMemberIdForUser(db, account.userId)).toBeNull();
    expect(await auditCount("team_member.user_unlinked", member.id)).toBe(1);
  });

  it("refuse un compte déjà relié, un compte client et un type incohérent", async () => {
    const admin = await createTestContext(db, "admin");
    const account = await createTestActor(db, "member");
    const first = await insertMember(db);
    const second = await insertMember(db);
    await linkMemberToUser(admin, first.id, { userId: account.userId });
    await expect(
      linkMemberToUser(admin, second.id, { userId: account.userId }),
    ).rejects.toBeInstanceOf(ConflictError);

    const client = await createTestActor(db, "client");
    await expect(
      linkMemberToUser(admin, second.id, { userId: client.userId }),
    ).rejects.toBeInstanceOf(ConflictError);

    const contractorAccount = await createTestActor(db, "contractor");
    await expect(
      linkMemberToUser(admin, second.id, { userId: contractorAccount.userId }),
    ).rejects.toBeInstanceOf(ConflictError);
    const contractorCard = await insertMember(db, { kind: "contractor" });
    const memberAccount = await createTestActor(db, "member");
    await expect(
      linkMemberToUser(admin, contractorCard.id, { userId: memberAccount.userId }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("une fiche reliée ne change pas de type contre le rôle de son compte", async () => {
    const admin = await createTestContext(db, "admin");
    const account = await createTestActor(db, "member");
    const member = await insertMember(db, { fullName: "Type Figé" });
    await linkMemberToUser(admin, member.id, { userId: account.userId });
    await expect(
      updateTeamMember(
        admin,
        member.id,
        memberInput({ fullName: "Type Figé", kind: "contractor" }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("la liste des comptes reliables exclut les clients et les comptes déjà pris", async () => {
    const admin = await createTestContext(db, "admin");
    const taken = await createMemberContext(db, "member");
    const free = await createTestActor(db, "member");
    const client = await createTestActor(db, "client");
    const target = await insertMember(db);
    const ids = (await listLinkableUsers(admin, target.id)).map((row) => row.id);
    expect(ids).toContain(free.userId);
    expect(ids).not.toContain(taken.actor.userId);
    expect(ids).not.toContain(client.userId);
  });
});

describe("machine à états des missions", () => {
  const STATUSES = ["planned", "in_progress", "delivered", "cancelled"] as const;

  it("n'autorise que les passages de la table", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        expect(canTransitionMission(from, to)).toBe(MISSION_TRANSITIONS[from].includes(to));
      }
    }
    expect(() => assertMissionTransition("planned", "delivered")).toThrow(ConflictError);
    expect(() => assertMissionTransition("delivered", "cancelled")).toThrow(ConflictError);
    expect(() => assertMissionTransition("cancelled", "in_progress")).toThrow(ConflictError);
  });

  it("parcourt tous les chemins et pose la date de réception", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id } = await createMission(admin, { memberId: member.id, title: "Parcours complet" });
    expect((await getMission(admin, id)).status).toBe("planned");

    await expect(transitionMission(admin, id, { status: "delivered" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    await transitionMission(admin, id, { status: "in_progress" });
    await transitionMission(admin, id, { status: "planned" });
    await transitionMission(admin, id, { status: "cancelled" });
    await expect(transitionMission(admin, id, { status: "in_progress" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await transitionMission(admin, id, { status: "planned" });
    await transitionMission(admin, id, { status: "in_progress" });

    await transitionMission(admin, id, {
      status: "delivered",
      deliverableReceivedOn: "2026-01-15",
    });
    let mission = await getMission(admin, id);
    expect(mission.status).toBe("delivered");
    expect(mission.deliverableReceivedOn).toBe("2026-01-15");
    expect(await auditCount("mission.delivered", id)).toBe(1);

    await expect(transitionMission(admin, id, { status: "cancelled" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Livrable refusé : la mission rouvre et la réception s'efface.
    await transitionMission(admin, id, { status: "in_progress" });
    mission = await getMission(admin, id);
    expect(mission.deliverableReceivedOn).toBeNull();

    await transitionMission(admin, id, { status: "cancelled" });
    expect((await getMission(admin, id)).status).toBe("cancelled");
  });

  it("sans date, la réception d'une livraison est aujourd'hui", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id } = await createMission(admin, { memberId: member.id, title: "Sans date" });
    await transitionMission(admin, id, { status: "in_progress" });
    await transitionMission(admin, id, { status: "delivered" });
    expect((await getMission(admin, id)).deliverableReceivedOn).toBe(today);
  });

  it("passer à l'état courant ne change rien et n'audite pas", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id } = await createMission(admin, { memberId: member.id, title: "Idempotent" });
    await transitionMission(admin, id, { status: "in_progress" });
    expect(await transitionMission(admin, id, { status: "in_progress" })).toEqual({
      changed: false,
    });
    expect(await auditCount("mission.status_changed", id)).toBe(1);
  });
});

describe("affectation des missions", () => {
  it("rattache au client du projet et un double envoi ne crée qu'une mission", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const input = {
      memberId: member.id,
      title: "Double envoi",
      projectId: project.id,
      deliverableLabel: "Maquettes",
      plannedCostCents: 100000,
      committedCostCents: 50000,
      dueOn: "2030-02-01",
    };
    const first = await createMission(admin, input);
    const second = await createMission(admin, input);
    expect(second).toEqual({ id: first.id, created: false });

    const mission = await getMission(admin, first.id);
    expect(mission.companyId).toBe(company.id);
    expect(mission.deliverableLabel).toBe("Maquettes");
    expect(mission.plannedCostCents).toBe(100000);
    expect(mission.committedCostCents).toBe(50000);
    expect(await auditCount("mission.created", first.id)).toBe(1);
  });

  it("déduit le projet de la tâche", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const task = await createTask(db);
    const { id } = await createMission(admin, {
      memberId: member.id,
      title: "Depuis une tâche",
      taskId: task.id,
    });
    expect((await getMission(admin, id)).projectId).toBe(task.projectId);
  });

  it("refuse un lien entre deux clients, projet et demande", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const project = await createProject(db);
    const ticket = await createTicket(db);
    await expect(
      createMission(admin, {
        memberId: member.id,
        title: "Croisée",
        projectId: project.id,
        ticketId: ticket.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse une tâche d'un autre projet", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const project = await createProject(db);
    const task = await createTask(db);
    await expect(
      createMission(admin, {
        memberId: member.id,
        title: "Tâche étrangère",
        projectId: project.id,
        taskId: task.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuse un intervenant inactif, archivé ou inconnu", async () => {
    const admin = await createTestContext(db, "admin");
    const inactive = await insertMember(db, { status: "inactive" });
    await expect(
      createMission(admin, { memberId: inactive.id, title: "Inactif" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const archived = await insertMember(db, { archivedAt: new Date() });
    await expect(
      createMission(admin, { memberId: archived.id, title: "Archivé" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createMission(admin, {
        memberId: "00000000-0000-4000-8000-000000000000",
        title: "Inconnu",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("une modification sans coût conserve les coûts existants", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id } = await createMission(admin, {
      memberId: member.id,
      title: "Conserve",
      plannedCostCents: 1000,
      committedCostCents: 500,
    });
    await updateMission(admin, id, { memberId: member.id, title: "Conserve, renommée" });
    const mission = await getMission(admin, id);
    expect(mission.title).toBe("Conserve, renommée");
    expect(mission.plannedCostCents).toBe(1000);
    expect(mission.committedCostCents).toBe(500);
    expect(await auditCount("mission.updated", id)).toBe(1);
  });

  it("affecter un prestataire à un projet l'ouvre à son périmètre", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    expect(await isAssignedToProject(db, contractor.actor, project.id)).toBe(false);
    await createMission(admin, {
      memberId: contractor.member.id,
      title: "Ouvre le périmètre",
      projectId: project.id,
    });
    expect(await getAssignedProjectIds(db, contractor.actor)).toContain(project.id);
  });
});

describe("droits et coûts par rôle", () => {
  async function seededMission() {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db, {
      kind: "contractor",
      hourlyCostCents: 7777,
      dayRateCents: 88800,
      conditions: "Acompte secret",
    });
    const { id } = await createMission(admin, {
      memberId: member.id,
      title: "Mission sensible",
      plannedCostCents: 123456,
      committedCostCents: 65432,
    });
    return { admin, member, missionId: id };
  }

  const SENSITIVE = ["7777", "88800", "Acompte secret", "123456", "65432"];

  it("un collaborateur et un lecteur lisent sans aucun coût", async () => {
    const { member, missionId } = await seededMission();
    for (const role of ["member", "viewer"] as const) {
      const ctx = await createTestContext(db, role);
      const payload = JSON.stringify({
        detail: await getTeamMember(ctx, member.id),
        mission: await getMission(ctx, missionId),
        missions: await listMissions(ctx, { memberId: member.id }, PAGE),
        contractors: await listContractors(ctx, { search: member.fullName }, PAGE),
        members: await listTeamMembers(ctx, { search: member.fullName }, PAGE),
        overview: await getTeamOverview(ctx, { page: PAGE, contractorsLimit: 50 }),
      });
      for (const value of SENSITIVE) expect(payload).not.toContain(value);
      expect(payload).not.toContain("hourlyCostCents");
      expect(payload).not.toContain("dayRateCents");
      expect(payload).not.toContain("plannedCostCents");
      expect(payload).not.toContain("committedCostCents");
      expect(payload).not.toContain('"conditions"');
    }
  });

  it("un associé lit les coûts", async () => {
    const { admin, member, missionId } = await seededMission();
    const detail = await getTeamMember(admin, member.id);
    expect(detail.member.hourlyCostCents).toBe(7777);
    expect(detail.member.dayRateCents).toBe(88800);
    expect(detail.member.conditions).toBe("Acompte secret");
    expect(detail.missionSummary.plannedCostCents).toBe(123456);
    expect((await getMission(admin, missionId)).committedCostCents).toBe(65432);
  });

  it("les totaux de sous-traitance couvrent tous les prestataires, pas seulement l'aperçu", async () => {
    const fresh = await createTestDatabase();
    try {
      const admin = await createTestContext(fresh.db, "admin");
      const planned = [1000, 2000, 3000];
      for (const cost of planned) {
        const member = await insertMember(fresh.db, { kind: "contractor" });
        await createMission(admin, {
          memberId: member.id,
          title: `Mission ${cost}`,
          plannedCostCents: cost,
          committedCostCents: cost / 2,
        });
      }
      const cancelledMember = await insertMember(fresh.db, { kind: "contractor" });
      const cancelled = await createMission(admin, {
        memberId: cancelledMember.id,
        title: "Annulée",
        plannedCostCents: 999999,
      });
      await transitionMission(admin, cancelled.id, { status: "cancelled" });
      // Un membre interne ne compte pas dans la sous-traitance.
      const staff = await insertMember(fresh.db, { kind: "employee" });
      await createMission(admin, { memberId: staff.id, title: "Interne", plannedCostCents: 5555 });

      const overview = await getTeamOverview(admin, { page: PAGE, contractorsLimit: 1 });
      expect(overview.contractors.items).toHaveLength(1);
      expect(overview.contractors.total).toBe(4);
      expect(overview.subcontracting).toEqual({ plannedCostCents: 6000, committedCostCents: 3000 });
    } finally {
      await fresh.close();
    }
  });

  it("seul `team:manage` écrit", async () => {
    const { member, missionId } = await seededMission();
    for (const role of ["member", "viewer", "contractor", "client"] as const) {
      const ctx = await createTestContext(db, role);
      const refused = [
        () => createTeamMember(ctx, memberInput()),
        () => updateTeamMember(ctx, member.id, memberInput()),
        () => archiveTeamMember(ctx, member.id),
        () => restoreTeamMember(ctx, member.id),
        () =>
          addMemberAbsence(ctx, {
            memberId: member.id,
            startOn: "2031-01-01",
            endOn: "2031-01-02",
          }),
        () => createMission(ctx, { memberId: member.id, title: "Refusée" }),
        () => updateMission(ctx, missionId, { memberId: member.id, title: "Refusée" }),
        () => transitionMission(ctx, missionId, { status: "in_progress" }),
        () => getMissionFormOptions(ctx),
      ];
      for (const call of refused) await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("un prestataire ou un client ne lit ni l'équipe ni l'annuaire", async () => {
    const { member } = await seededMission();
    for (const role of ["contractor", "client"] as const) {
      const ctx = await createTestContext(db, role);
      const refused = [
        () => getTeamOverview(ctx, { page: PAGE }),
        () => listTeamMembers(ctx, {}, PAGE),
        () => listContractors(ctx, {}, PAGE),
        () => getTeamMember(ctx, member.id),
        () => listMissions(ctx, {}, PAGE),
      ];
      for (const call of refused) await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("un prestataire ne voit que ses missions, sans coût ; celle d'un autre répond 404", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const other = await insertMember(db, { kind: "contractor" });
    const own = await createMission(admin, {
      memberId: contractor.member.id,
      title: "La mienne",
      plannedCostCents: 424242,
    });
    const foreign = await createMission(admin, { memberId: other.id, title: "L'autre" });

    const mine = await getMission(contractor, own.id);
    expect(mine.title).toBe("La mienne");
    expect(JSON.stringify(mine)).not.toContain("424242");
    await expect(getMission(contractor, foreign.id)).rejects.toBeInstanceOf(NotFoundError);

    const list = await listMyMissions(contractor);
    expect(list.map((row) => row.id)).toEqual([own.id]);
    expect(JSON.stringify(list)).not.toContain("424242");
  });

  it("un prestataire sans fiche ne voit aucune mission", async () => {
    const orphan = await createTestContext(db, "contractor");
    expect(await listMyMissions(orphan)).toEqual([]);
  });
});

describe("écran 22", () => {
  it("sépare associés et collaborateurs des prestataires et compte par type", async () => {
    const fresh = await createTestDatabase();
    try {
      const admin = await createTestContext(fresh.db, "admin");
      await insertMember(fresh.db, { kind: "partner", fullName: "A Associé" });
      await insertMember(fresh.db, { kind: "employee", fullName: "B Collaboration" });
      await insertMember(fresh.db, { kind: "contractor", fullName: "C Prestation" });
      await insertMember(fresh.db, { kind: "employee", fullName: "D Inactif", status: "inactive" });
      await insertMember(fresh.db, {
        kind: "employee",
        fullName: "E Archive",
        archivedAt: new Date(),
      });

      const overview = await getTeamOverview(admin, { page: PAGE });
      expect(overview.counts).toEqual({ partner: 1, employee: 1, contractor: 1 });
      expect(overview.members.items.map((card) => card.member.fullName)).toEqual([
        "A Associé",
        "B Collaboration",
        "D Inactif",
      ]);
      expect(overview.contractors.items.map((item) => item.member.fullName)).toEqual([
        "C Prestation",
      ]);
      expect(overview.members.items[0]?.capacity?.capacityMinutes).toBeGreaterThan(0);
    } finally {
      await fresh.close();
    }
  });

  it("pagine les cartes côté serveur", async () => {
    const fresh = await createTestDatabase();
    try {
      const admin = await createTestContext(fresh.db, "admin");
      for (let index = 0; index < 5; index += 1) {
        await insertMember(fresh.db, { kind: "employee", fullName: `Page ${index}` });
      }
      const overview = await getTeamOverview(admin, { page: { page: 2, pageSize: 2 } });
      expect(overview.members.total).toBe(5);
      expect(overview.members.items.map((card) => card.member.fullName)).toEqual([
        "Page 2",
        "Page 3",
      ]);
    } finally {
      await fresh.close();
    }
  });

  it("n'affiche pas de mission close dans les missions ouvertes", async () => {
    const fresh = await createTestDatabase();
    try {
      const admin = await createTestContext(fresh.db, "admin");
      const member = await insertMember(fresh.db);
      const open = await createMission(admin, { memberId: member.id, title: "Ouverte" });
      const closed = await createMission(admin, { memberId: member.id, title: "Annulée" });
      await transitionMission(admin, closed.id, { status: "cancelled" });

      const overview = await getTeamOverview(admin, { page: PAGE });
      expect(overview.missions.items.map((row) => row.id)).toEqual([open.id]);
      expect((await listMissions(admin, { status: "cancelled" }, PAGE)).total).toBe(1);
    } finally {
      await fresh.close();
    }
  });
});

describe("fiche client 360°", () => {
  it("ne renvoie que les missions du client, sans aucun coût", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const company = await createCompany(db);
    const otherCompany = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const otherProject = await createProject(db, { companyId: otherCompany.id });
    const { id } = await createMission(admin, {
      memberId: member.id,
      title: "Chez ce client",
      projectId: project.id,
      plannedCostCents: 987654,
    });
    await createMission(admin, {
      memberId: member.id,
      title: "Chez un autre",
      projectId: otherProject.id,
    });

    const rows = await listMissionsForCompany(admin, company.id, { limit: 5 });
    expect(rows.map((row) => row.id)).toEqual([id]);
    expect(JSON.stringify(rows)).not.toContain("987654");

    const contractor = await createTestContext(db, "contractor");
    await expect(listMissionsForCompany(contractor, company.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
