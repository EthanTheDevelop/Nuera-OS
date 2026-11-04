import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAssignedProjectIds, isAssignedToProject } from "@/modules/team/team.lookup";
import {
  addMemberAbsence,
  archiveTeamMember,
  createMission,
  createTeamMember,
  listMissionsForCompany,
  restoreTeamMember,
  transitionMission,
  updateMission,
  updateTeamMember,
} from "@/modules/team/team.service";
import { addDays, parisToday } from "@/modules/time/calendar";
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntryOptions,
  getTimeOverview,
  listTaskOptionsForProject,
  listTimeEntriesForCompany,
  updateTimeEntry,
} from "@/modules/time/time.service";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createProject,
  createTask,
  createTeamMember as insertMember,
  createTicket,
} from "../../helpers/factories";

/** Défauts trouvés à l'audit du lot : chaque test échouait avant sa correction. */
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

describe("dates du calendrier", () => {
  it("une absence au 31 février est une erreur de saisie, pas une panne de la base", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    await expect(
      addMemberAbsence(admin, { memberId: member.id, startOn: "2026-02-31", endOn: "2026-03-02" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("une échéance de mission impossible est refusée à la validation", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    await expect(
      createMission(admin, { memberId: member.id, title: "Mission", dueOn: "2026-13-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un livrable ne se reçoit ni à une date impossible ni dans le futur", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const { id } = await createMission(admin, { memberId: member.id, title: "Livrable" });
    await transitionMission(admin, id, { status: "in_progress" });
    await expect(
      transitionMission(admin, id, { status: "delivered", deliverableReceivedOn: "2026-02-31" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transitionMission(admin, id, {
        status: "delivered",
        deliverableReceivedOn: addDays(today, 1),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("périmètre d'un prestataire", () => {
  it("une mission annulée ne donne plus accès à son projet", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    const { id } = await createMission(admin, {
      memberId: contractor.member.id,
      title: "Annulée ensuite",
      projectId: project.id,
    });
    expect(await isAssignedToProject(db, contractor.actor, project.id)).toBe(true);

    await transitionMission(admin, id, { status: "cancelled" });

    expect(await isAssignedToProject(db, contractor.actor, project.id)).toBe(false);
    await expect(
      createTimeEntry(contractor, {
        workOn: today,
        minutes: 30,
        category: "production",
        projectId: project.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("une mission annulée ne laisse saisir ni sur sa tâche ni sur sa demande", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    const task = await createTask(db, { projectId: project.id });
    const ticket = await createTicket(db);
    const onTask = await createMission(admin, {
      memberId: contractor.member.id,
      title: "Sur tâche",
      projectId: project.id,
      taskId: task.id,
    });
    const onTicket = await createMission(admin, {
      memberId: contractor.member.id,
      title: "Sur demande",
      ticketId: ticket.id,
    });
    await transitionMission(admin, onTask.id, { status: "cancelled" });
    await transitionMission(admin, onTicket.id, { status: "cancelled" });

    await expect(
      createTimeEntry(contractor, {
        workOn: today,
        minutes: 30,
        category: "production",
        taskId: task.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTimeEntry(contractor, {
        workOn: today,
        minutes: 30,
        category: "support",
        ticketId: ticket.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const options = await getTimeEntryOptions(contractor);
    expect(options.projects).toEqual([]);
    expect(options.tickets).toEqual([]);
    await expect(listTaskOptionsForProject(contractor, project.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("une mission livrée garde l'accès : le travail reste consultable", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    const { id } = await createMission(admin, {
      memberId: contractor.member.id,
      title: "Livrée",
      projectId: project.id,
    });
    await transitionMission(admin, id, { status: "in_progress" });
    await transitionMission(admin, id, { status: "delivered" });
    expect(await isAssignedToProject(db, contractor.actor, project.id)).toBe(true);
  });

  it("une tâche archivée ne compte plus pour le périmètre", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    await createTask(db, {
      projectId: project.id,
      assigneeMemberId: contractor.member.id,
      archivedAt: new Date(),
    });
    expect(await getAssignedProjectIds(db, contractor.actor)).toEqual([]);
  });

  it("une fiche archivée n'ouvre plus aucun projet et ne modifie plus son temps", async () => {
    const admin = await createTestContext(db, "admin");
    const contractor = await createMemberContext(db, "contractor");
    const project = await createProject(db);
    const { id: missionId } = await createMission(admin, {
      memberId: contractor.member.id,
      title: "Avant le départ",
      projectId: project.id,
    });
    const { id: entryId } = await createTimeEntry(contractor, {
      workOn: today,
      minutes: 60,
      category: "production",
      projectId: project.id,
    });
    await transitionMission(admin, missionId, { status: "in_progress" });
    await transitionMission(admin, missionId, { status: "delivered" });
    await archiveTeamMember(admin, contractor.member.id);

    expect(await getAssignedProjectIds(db, contractor.actor)).toEqual([]);
    await expect(
      updateTimeEntry(contractor, entryId, {
        workOn: today,
        minutes: 90,
        category: "production",
        projectId: project.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteTimeEntry(contractor, entryId)).rejects.toBeInstanceOf(ConflictError);
    // Un associé corrige encore l'historique d'un membre parti.
    const updated = await updateTimeEntry(admin, entryId, {
      workOn: today,
      minutes: 75,
      category: "production",
      projectId: project.id,
    });
    expect(updated.changed).toBe(true);
  });
});

describe("archivage et restauration", () => {
  it("une demande ouverte ou un projet ouvert retient l'archivage", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const ticket = await createTicket(db, { assigneeMemberId: member.id });
    await expect(archiveTeamMember(admin, member.id)).rejects.toBeInstanceOf(ConflictError);

    await db
      .update(schema.tickets)
      .set({ status: "closed" })
      .where(eq(schema.tickets.id, ticket.id));
    const project = await createProject(db, { ownerMemberId: member.id, status: "active" });
    await expect(archiveTeamMember(admin, member.id)).rejects.toBeInstanceOf(ConflictError);

    await db
      .update(schema.projects)
      .set({ status: "closed" })
      .where(eq(schema.projects.id, project.id));
    await archiveTeamMember(admin, member.id);
  });

  it("restaurer ne crée pas deux fiches vivantes à la même adresse", async () => {
    const admin = await createTestContext(db, "admin");
    const email = `doublon-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const first = await createTeamMember(admin, {
      kind: "employee",
      fullName: "Première Fiche",
      email,
      weeklyCapacityMinutes: 2100,
    });
    await archiveTeamMember(admin, first.id);
    await createTeamMember(admin, {
      kind: "employee",
      fullName: "Seconde Fiche",
      email,
      weeklyCapacityMinutes: 2100,
    });
    await expect(restoreTeamMember(admin, first.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("modifications répétées", () => {
  it("renvoyer une fiche identique n'ajoute rien au journal", async () => {
    const admin = await createTestContext(db, "admin");
    const input = {
      kind: "employee",
      fullName: "Fiche Stable",
      title: "Intégration",
      skills: "Next.js, SEO",
      weeklyCapacityMinutes: 2100,
      hourlyCostCents: 4000,
      conditions: "Net 30",
    };
    const { id } = await createTeamMember(admin, input);
    await updateTeamMember(admin, id, input);
    await updateTeamMember(admin, id, input);
    expect(await auditCount("team_member.updated", id)).toBe(0);

    await updateTeamMember(admin, id, { ...input, title: "Direction" });
    expect(await auditCount("team_member.updated", id)).toBe(1);
  });

  it("renvoyer une mission identique n'ajoute rien au journal", async () => {
    const admin = await createTestContext(db, "admin");
    const member = await insertMember(db);
    const project = await createProject(db);
    const input = {
      memberId: member.id,
      title: "Mission stable",
      projectId: project.id,
      deliverableLabel: "Maquettes",
      dueOn: today,
      plannedCostCents: 10_000,
    };
    const { id } = await createMission(admin, input);
    await updateMission(admin, id, input);
    await updateMission(admin, id, input);
    expect(await auditCount("mission.updated", id)).toBe(0);

    await updateMission(admin, id, { ...input, title: "Mission renommée" });
    expect(await auditCount("mission.updated", id)).toBe(1);
  });
});

describe("alerte de budget à l'écran", () => {
  it("un budget consommé à 80 % se voit sans estimation, pour un associé seulement", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    const admin = await createMemberContext(own, "admin", { hourlyCostCents: 6000 });
    const company = await createCompany(own);
    const project = await createProject(own, {
      companyId: company.id,
      status: "active",
      budgetCents: 10_000,
    });
    await createTimeEntry(admin, {
      workOn: today,
      minutes: 85,
      category: "production",
      projectId: project.id,
    });

    const overview = await getTimeOverview(admin, { weekOf: today });
    expect(overview.overruns?.find((row) => row.id === project.id)).toMatchObject({
      kind: "project",
      percent: 85,
      costCents: 8500,
      budgetCents: 10_000,
    });

    // Sans `team:read_costs`, la ligne trahirait un coût : elle n'apparaît pas.
    const viewer = await createMemberContext(own, "viewer");
    const asViewer = await getTimeOverview(viewer, { weekOf: today });
    expect(asViewer.overruns?.find((row) => row.id === project.id)).toBeUndefined();
    await closeOwn();
  });
});

describe("fiche client 360°", () => {
  it("un identifiant malformé donne une liste vide, pas une panne", async () => {
    const admin = await createTestContext(db, "admin");
    await expect(listTimeEntriesForCompany(admin, "pas-un-id")).resolves.toEqual([]);
    await expect(listMissionsForCompany(admin, "pas-un-id")).resolves.toEqual([]);
  });
});
