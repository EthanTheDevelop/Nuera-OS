import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  monthRange,
  parisToday,
  parseWeekKey,
  weekKey,
  weekStart,
} from "@/modules/time/calendar";
import { simulateNewProject } from "@/modules/time/capacity.service";
import {
  createTimeEntry,
  deleteTimeEntry,
  getCapacityOverview,
  getProjectTimeTotals,
  getSixWeekLoad,
  getTimeCostCents,
  getTimeEntryOptions,
  getTimeOverview,
  getTimesheet,
  getTimeTotals,
  listTaskOptionsForProject,
  listTimeEntries,
  listTimeEntriesForCompany,
  saveTimesheetCell,
  updateTimeEntry,
} from "@/modules/time/time.service";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createMemberContext,
  createProject,
  createSite,
  createTask,
  createTeamMember,
  createTicket,
} from "../../helpers/factories";

const PAGE = { page: 1, pageSize: 50 };

let db: Database;
let close: () => Promise<void>;
const today = parisToday();

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

describe("saisie du temps", () => {
  it("fige le coût horaire du membre à la saisie", async () => {
    const ctx = await createMemberContext(db, "member", { hourlyCostCents: 4000 });
    const project = await createProject(db);
    const { id } = await createTimeEntry(ctx, {
      workOn: today,
      minutes: 90,
      category: "production",
      projectId: project.id,
    });

    await db
      .update(schema.teamMembers)
      .set({ hourlyCostCents: 9000 })
      .where(eq(schema.teamMembers.id, ctx.member.id));
    await updateTimeEntry(ctx, id, {
      workOn: today,
      minutes: 120,
      category: "production",
      projectId: project.id,
    });

    const [row] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    expect(row?.hourlyCostCents).toBe(4000);
    expect(row?.minutes).toBe(120);
    expect(row?.companyId).toBe(project.companyId);
    expect(await auditCount("time_entry.created", id)).toBe(1);
    expect(await auditCount("time_entry.updated", id)).toBe(1);
  });

  it("refuse une saisie sans rattachement, sauf prospection et administratif", async () => {
    const ctx = await createMemberContext(db, "member");
    await expect(
      createTimeEntry(ctx, { workOn: today, minutes: 60, category: "production" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const { id } = await createTimeEntry(ctx, { workOn: today, minutes: 60, category: "admin" });
    const [row] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    expect(row?.billable).toBe(false);
    expect(row?.companyId).toBeNull();
  });

  it("refuse une date future et plus de 24 h par jour", async () => {
    const ctx = await createMemberContext(db, "member");
    await expect(
      createTimeEntry(ctx, { workOn: addDays(today, 1), minutes: 60, category: "admin" }),
    ).rejects.toBeInstanceOf(ValidationError);

    await createTimeEntry(ctx, { workOn: today, minutes: 1400, category: "admin" });
    await expect(
      createTimeEntry(ctx, { workOn: today, minutes: 60, category: "prospecting" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuse des rattachements de deux clients différents", async () => {
    const ctx = await createMemberContext(db, "member");
    const project = await createProject(db);
    const otherTicket = await createTicket(db);
    await expect(
      createTimeEntry(ctx, {
        workOn: today,
        minutes: 30,
        category: "support",
        projectId: project.id,
        ticketId: otherTicket.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const otherTask = await createTask(db);
    await expect(
      createTimeEntry(ctx, {
        workOn: today,
        minutes: 30,
        category: "production",
        projectId: project.id,
        taskId: otherTask.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("hérite du contrat et du projet d'une demande", async () => {
    const ctx = await createMemberContext(db, "member");
    const company = await createCompany(db);
    const contract = await createContract(db, { companyId: company.id });
    const project = await createProject(db, { companyId: company.id });
    const ticket = await createTicket(db, {
      companyId: company.id,
      contractId: contract.id,
      projectId: project.id,
    });
    const { id } = await createTimeEntry(ctx, {
      workOn: today,
      minutes: 30,
      category: "support",
      ticketId: ticket.id,
    });
    const [row] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    expect(row?.contractId).toBe(contract.id);
    expect(row?.projectId).toBe(project.id);
  });

  it("ne crée pas deux fois la même saisie envoyée deux fois", async () => {
    const ctx = await createMemberContext(db, "member");
    const project = await createProject(db);
    const input = {
      workOn: today,
      minutes: 45,
      category: "production",
      projectId: project.id,
      note: "Double clic",
    };
    const first = await createTimeEntry(ctx, input);
    const second = await createTimeEntry(ctx, input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await auditCount("time_entry.created", first.id)).toBe(1);
  });

  it("modifier sans rien changer n'écrit rien, supprimer deux fois non plus", async () => {
    const ctx = await createMemberContext(db, "member");
    const input = { workOn: today, minutes: 30, category: "admin" };
    const { id } = await createTimeEntry(ctx, input);
    expect(await updateTimeEntry(ctx, id, input)).toEqual({ id, changed: false });
    expect(await auditCount("time_entry.updated", id)).toBe(0);

    await deleteTimeEntry(ctx, id);
    await deleteTimeEntry(ctx, id);
    expect(await auditCount("time_entry.deleted", id)).toBe(1);
  });
});

describe("droits et périmètre", () => {
  it("un collaborateur saisit pour lui seul, un associé pour tout le monde", async () => {
    const member = await createMemberContext(db, "member");
    const other = await createTeamMember(db);
    await expect(
      createTimeEntry(member, {
        workOn: today,
        minutes: 30,
        category: "admin",
        memberId: other.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const admin = await createMemberContext(db, "admin");
    const { id } = await createTimeEntry(admin, {
      workOn: today,
      minutes: 30,
      category: "admin",
      memberId: other.id,
    });
    const [row] = await db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, id));
    expect(row?.memberId).toBe(other.id);
    expect(row?.hourlyCostCents).toBe(other.hourlyCostCents);

    await expect(
      updateTimeEntry(member, id, { workOn: today, minutes: 60, category: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteTimeEntry(member, id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("une lecture seule ne saisit rien", async () => {
    const viewer = await createMemberContext(db, "viewer");
    await expect(
      createTimeEntry(viewer, { workOn: today, minutes: 30, category: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveTimesheetCell(viewer, { workOn: today, minutes: 30, category: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const sheet = await getTimesheet(viewer, { weekOf: today });
    expect(sheet.editable).toBe(false);
  });

  it("un compte sans fiche ne peut pas saisir et le sait", async () => {
    const ctx = await createTestContext(db, "member");
    await expect(
      createTimeEntry(ctx, { workOn: today, minutes: 30, category: "admin" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const sheet = await getTimesheet(ctx, { weekOf: today });
    expect(sheet.member).toBeNull();
  });

  it("un client n'a aucun accès", async () => {
    const client = await createTestContext(db, "client");
    await expect(getTimesheet(client, { weekOf: today })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTimeEntries(client, {}, PAGE)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createTimeEntry(client, { workOn: today, minutes: 30, category: "admin" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe("prestataire", () => {
    it("saisit seulement sur le travail attribué, 404 ailleurs", async () => {
      const ctx = await createMemberContext(db, "contractor", { hourlyCostCents: 6000 });
      const company = await createCompany(db);
      const assigned = await createProject(db, { companyId: company.id });
      await db
        .insert(schema.projectMembers)
        .values({ projectId: assigned.id, memberId: ctx.member.id });
      const assignedTask = await createTask(db, { projectId: assigned.id });

      const notAssigned = await createProject(db);
      const otherTask = await createTask(db, { projectId: notAssigned.id });
      const otherTicket = await createTicket(db);
      const otherContract = await createContract(db);

      await expect(
        createTimeEntry(ctx, {
          workOn: today,
          minutes: 60,
          category: "production",
          projectId: assigned.id,
          taskId: assignedTask.id,
        }),
      ).resolves.toMatchObject({ created: true });

      for (const input of [
        { projectId: notAssigned.id, category: "production" },
        { taskId: otherTask.id, category: "production" },
        { ticketId: otherTicket.id, category: "support" },
        { contractId: otherContract.id, category: "support" },
      ]) {
        await expect(
          createTimeEntry(ctx, { workOn: today, minutes: 30, ...input }),
        ).rejects.toBeInstanceOf(NotFoundError);
      }
    });

    it("refuse l'administratif et la saisie pour un autre", async () => {
      const ctx = await createMemberContext(db, "contractor");
      await expect(
        createTimeEntry(ctx, { workOn: today, minutes: 30, category: "admin" }),
      ).rejects.toBeInstanceOf(ValidationError);
      const other = await createTeamMember(db);
      await expect(
        createTimeEntry(ctx, {
          workOn: today,
          minutes: 30,
          category: "admin",
          memberId: other.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("saisit sur une demande attribuée et une tâche de mission", async () => {
      const ctx = await createMemberContext(db, "contractor");
      const ticket = await createTicket(db, { assigneeMemberId: ctx.member.id });
      await expect(
        createTimeEntry(ctx, {
          workOn: today,
          minutes: 30,
          category: "support",
          ticketId: ticket.id,
        }),
      ).resolves.toMatchObject({ created: true });

      const project = await createProject(db);
      const task = await createTask(db, { projectId: project.id });
      await db.insert(schema.missions).values({
        memberId: ctx.member.id,
        companyId: project.companyId,
        projectId: project.id,
        taskId: task.id,
        title: "Mission",
      });
      await expect(
        createTimeEntry(ctx, {
          workOn: today,
          minutes: 30,
          category: "production",
          projectId: project.id,
          taskId: task.id,
        }),
      ).resolves.toMatchObject({ created: true });
    });

    it("ne voit que son temps, sans aucun coût, et jamais la capacité de l'agence", async () => {
      const ctx = await createMemberContext(db, "contractor");
      const ticket = await createTicket(db, { assigneeMemberId: ctx.member.id });
      await createTimeEntry(ctx, {
        workOn: today,
        minutes: 30,
        category: "support",
        ticketId: ticket.id,
      });
      const colleague = await createMemberContext(db, "member");
      const foreign = await createTimeEntry(colleague, {
        workOn: today,
        minutes: 30,
        category: "admin",
      });

      const list = await listTimeEntries(ctx, { memberId: colleague.member.id }, PAGE);
      expect(list.items.map((item) => item.memberId)).toEqual([ctx.member.id]);
      expect(list.items[0]).not.toHaveProperty("hourlyCostCents");
      expect(list.items[0]).not.toHaveProperty("costCents");

      await expect(
        updateTimeEntry(ctx, foreign.id, { workOn: today, minutes: 45, category: "admin" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteTimeEntry(ctx, foreign.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        getTimesheet(ctx, { memberId: colleague.member.id, weekOf: today }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const overview = await getTimeOverview(ctx, { weekOf: today });
      expect(overview.capacity).toBeNull();
      expect(overview.sixWeeks).toBeNull();
      expect(overview.productivity).toBeNull();
      await expect(simulateNewProject(ctx, { estimatedMinutes: 600 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("ne reçoit que ses choix dans le formulaire", async () => {
      const ctx = await createMemberContext(db, "contractor");
      const project = await createProject(db);
      await db
        .insert(schema.projectMembers)
        .values({ projectId: project.id, memberId: ctx.member.id });
      const other = await createProject(db);
      await createTicket(db);

      const options = await getTimeEntryOptions(ctx);
      expect(options.projects.map((item) => item.id)).toEqual([project.id]);
      expect(options.tickets).toEqual([]);
      expect(options.contracts).toEqual([]);
      expect(options.members).toEqual([]);

      await expect(listTaskOptionsForProject(ctx, project.id)).resolves.toEqual([]);
      await expect(listTaskOptionsForProject(ctx, other.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("le coût figé n'est visible qu'avec team:read_costs", async () => {
    const admin = await createMemberContext(db, "admin");
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    await createTimeEntry(admin, {
      workOn: today,
      minutes: 60,
      category: "production",
      projectId: project.id,
    });

    const asAdmin = await listTimeEntries(admin, { projectId: project.id }, PAGE);
    expect(asAdmin.items[0]?.hourlyCostCents).toBe(admin.member.hourlyCostCents);
    expect(asAdmin.items[0]?.costCents).toBe(admin.member.hourlyCostCents);

    for (const role of ["member", "viewer"] as const) {
      const ctx = await createMemberContext(db, role);
      const list = await listTimeEntries(ctx, { projectId: project.id }, PAGE);
      expect(list.items).toHaveLength(1);
      expect(JSON.stringify(list.items)).not.toMatch(/ourlyCost|costCents/);
      const rows = await listTimeEntriesForCompany(ctx, company.id);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toMatch(/ourlyCost|costCents/);
    }
    const adminRows = await listTimeEntriesForCompany(admin, company.id, { limit: 1 });
    expect(adminRows[0]?.costCents).toBe(admin.member.hourlyCostCents);
  });

  it("la fiche client exige time:read", async () => {
    const contractor = await createMemberContext(db, "contractor");
    await expect(
      listTimeEntriesForCompany(contractor, (await createCompany(db)).id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("feuille de temps", () => {
  it("enregistre le total voulu, deux fois sans effet, et vide à zéro", async () => {
    const ctx = await createMemberContext(db, "member", { hourlyCostCents: 3000 });
    const project = await createProject(db);
    const cell = {
      workOn: today,
      category: "production",
      projectId: project.id,
      billable: true,
    };

    expect(await saveTimesheetCell(ctx, { ...cell, minutes: 180 })).toEqual({
      minutes: 180,
      changed: true,
    });
    expect(await saveTimesheetCell(ctx, { ...cell, minutes: 180 })).toEqual({
      minutes: 180,
      changed: false,
    });
    let rows = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.minutes).toBe(180);

    await saveTimesheetCell(ctx, { ...cell, minutes: 240 });
    await saveTimesheetCell(ctx, { ...cell, minutes: 60 });
    rows = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.minutes).toBe(60);

    await saveTimesheetCell(ctx, { ...cell, minutes: 0 });
    rows = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(rows).toHaveLength(0);
  });

  it("une hausse de coût ne réécrit pas le temps déjà saisi", async () => {
    const ctx = await createMemberContext(db, "member", { hourlyCostCents: 3000 });
    const cell = { workOn: today, category: "admin" };
    await saveTimesheetCell(ctx, { ...cell, minutes: 60 });
    await db
      .update(schema.teamMembers)
      .set({ hourlyCostCents: 6000 })
      .where(eq(schema.teamMembers.id, ctx.member.id));
    await saveTimesheetCell(ctx, { ...cell, minutes: 90 });

    const rows = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(rows.map((row) => [row.minutes, row.hourlyCostCents]).sort()).toEqual([
      [30, 6000],
      [60, 3000],
    ]);

    await saveTimesheetCell(ctx, { ...cell, minutes: 45 });
    const after = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(after.map((row) => [row.minutes, row.hourlyCostCents])).toEqual([[45, 3000]]);
  });

  it("deux enregistrements simultanés donnent une seule saisie", async () => {
    const ctx = await createMemberContext(db, "member");
    const cell = { workOn: today, category: "prospecting", minutes: 120 };
    await Promise.all([saveTimesheetCell(ctx, cell), saveTimesheetCell(ctx, cell)]);
    const rows = await db
      .select()
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.memberId, ctx.member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.minutes).toBe(120);
  });

  it("agrège les lignes, propose le travail ouvert et distingue le facturable", async () => {
    const ctx = await createMemberContext(db, "member");
    const company = await createCompany(db, { name: "Atelier Test" });
    const first = await createProject(db, {
      companyId: company.id,
      name: "Refonte",
      ownerMemberId: ctx.member.id,
    });
    const second = await createProject(db, {
      companyId: company.id,
      name: "Boutique",
      ownerMemberId: ctx.member.id,
    });

    await saveTimesheetCell(ctx, {
      workOn: today,
      minutes: 120,
      category: "production",
      projectId: first.id,
    });
    await createTimeEntry(ctx, {
      workOn: today,
      minutes: 30,
      category: "production",
      projectId: first.id,
      billable: false,
    });

    const sheet = await getTimesheet(ctx, { weekOf: today });
    expect(sheet.editable).toBe(true);
    expect(sheet.totalMinutes).toBe(150);
    const firstBillable = sheet.rows.find((row) => row.projectId === first.id && row.billable);
    expect(firstBillable?.cells[today]).toBe(120);
    expect(firstBillable?.label).toBe("Atelier Test · production");
    // Deux projets du même client : le nom les distingue.
    expect(firstBillable?.detail).toBe("Refonte");
    const nonBillable = sheet.rows.find((row) => row.projectId === first.id && !row.billable);
    expect(nonBillable?.detail).toContain("non facturable");
    expect(sheet.rows.find((row) => row.projectId === second.id)?.detail).toBe("Boutique");
    expect(sheet.rows.at(-1)?.category).toBe("admin");
    expect(sheet.rows.at(-2)?.category).toBe("prospecting");
  });

  it("montre le week-end seulement s'il porte du temps", async () => {
    const ctx = await createMemberContext(db, "member");
    const lastWeek = addDays(weekStart(today), -7);
    const saturday = addDays(lastWeek, 5);
    expect((await getTimesheet(ctx, { weekOf: lastWeek })).days).toHaveLength(5);
    await saveTimesheetCell(ctx, { workOn: saturday, minutes: 60, category: "admin" });
    const sheet = await getTimesheet(ctx, { weekOf: lastWeek });
    expect(sheet.days).toHaveLength(6);
    expect(sheet.days.at(-1)).toBe(saturday);
    expect(sheet.totalMinutes).toBe(60);
  });

  it("la feuille d'un autre membre reste en lecture sans time:manage", async () => {
    const owner = await createMemberContext(db, "member");
    await saveTimesheetCell(owner, { workOn: today, minutes: 60, category: "admin" });
    const reader = await createMemberContext(db, "member");
    const asReader = await getTimesheet(reader, { memberId: owner.member.id, weekOf: today });
    expect(asReader.editable).toBe(false);
    expect(asReader.totalMinutes).toBe(60);

    const admin = await createMemberContext(db, "admin");
    const asAdmin = await getTimesheet(admin, { memberId: owner.member.id, weekOf: today });
    expect(asAdmin.editable).toBe(true);
    await saveTimesheetCell(admin, {
      memberId: owner.member.id,
      workOn: today,
      minutes: 90,
      category: "admin",
    });
    expect(
      (await getTimesheet(reader, { memberId: owner.member.id, weekOf: today })).totalMinutes,
    ).toBe(90);
  });
});

describe("lectures pour les autres modules", () => {
  it("getProjectTimeTotals et getTimeCostCents font le même calcul figé", async () => {
    const cheap = await createMemberContext(db, "member", { hourlyCostCents: 3000 });
    const dear = await createMemberContext(db, "member", { hourlyCostCents: 6000 });
    const company = await createCompany(db);
    const project = await createProject(db, {
      companyId: company.id,
      estimatedMinutes: 600,
      budgetCents: 100_000,
    });
    await createTimeEntry(cheap, {
      workOn: today,
      minutes: 90,
      category: "production",
      projectId: project.id,
    });
    await createTimeEntry(dear, {
      workOn: today,
      minutes: 30,
      category: "corrections",
      projectId: project.id,
      billable: false,
    });
    await db
      .update(schema.teamMembers)
      .set({ hourlyCostCents: 99999 })
      .where(eq(schema.teamMembers.id, cheap.member.id));

    const totals = await getProjectTimeTotals(db, project.id);
    expect(totals).toMatchObject({
      minutes: 120,
      billableMinutes: 90,
      nonBillableMinutes: 30,
      costCents: 7500,
      estimatedMinutes: 600,
      minutesPercent: 20,
      budgetPercent: 8,
    });
    expect(await getTimeCostCents(db, { scope: "project", id: project.id })).toBe(7500);
    expect(await getTimeCostCents(db, { scope: "client", id: company.id })).toBe(7500);
    expect(
      await getTimeCostCents(db, {
        scope: "project",
        id: project.id,
        period: { from: addDays(today, -30), to: addDays(today, -1) },
      }),
    ).toBe(0);
  });

  it("répartit le temps d'un site par demande, projet puis contrat, sans double compte", async () => {
    const ctx = await createMemberContext(db, "member", { hourlyCostCents: 6000 });
    const company = await createCompany(db);
    const project = await createProject(db, { companyId: company.id });
    const contract = await createContract(db, { companyId: company.id });
    const site = await createSite(db, {
      companyId: company.id,
      projectId: project.id,
      contractId: contract.id,
    });
    const ticket = await createTicket(db, { companyId: company.id, siteId: site.id });
    const otherSite = await createSite(db, { companyId: company.id });
    const otherTicket = await createTicket(db, {
      companyId: company.id,
      siteId: otherSite.id,
      projectId: project.id,
    });
    const base = { workOn: today, minutes: 60 };

    await createTimeEntry(ctx, { ...base, category: "support", ticketId: ticket.id });
    await createTimeEntry(ctx, { ...base, category: "production", projectId: project.id });
    await createTimeEntry(ctx, { ...base, category: "support", contractId: contract.id });
    await createTimeEntry(ctx, { ...base, category: "support", ticketId: otherTicket.id });

    const totals = await getTimeTotals(db, { scope: "site", id: site.id });
    expect(totals.minutes).toBe(180);
    expect(await getTimeCostCents(db, { scope: "site", id: otherSite.id })).toBe(6000);
    expect(await getTimeCostCents(db, { scope: "contract", id: contract.id })).toBe(6000);
  });

  it("émet une seule alerte de budget, à partir de 80 %", async () => {
    const ctx = await createMemberContext(db, "member", { hourlyCostCents: 6000 });
    const project = await createProject(db, { budgetCents: 10_000 });
    const events = () =>
      db.select().from(schema.domainEvents).where(eq(schema.domainEvents.entityId, project.id));

    await createTimeEntry(ctx, {
      workOn: today,
      minutes: 60,
      category: "production",
      projectId: project.id,
    });
    expect(await events()).toHaveLength(0);

    await saveTimesheetCell(ctx, {
      workOn: addDays(today, -1),
      minutes: 30,
      category: "production",
      projectId: project.id,
    });
    await saveTimesheetCell(ctx, {
      workOn: addDays(today, -2),
      minutes: 30,
      category: "production",
      projectId: project.id,
    });
    const emitted = await events();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "budget.threshold_80",
      companyId: project.companyId,
      payload: { budgetCents: 10_000 },
    });
  });
});

describe("capacité et charge", () => {
  // Base isolée : les chiffres dépendent de tous les membres et projets présents.
  let local: Database;
  let closeLocal: () => Promise<void>;
  const monday = addDays(weekStart(today), 7);
  const friday = addDays(monday, 4);

  beforeAll(async () => {
    ({ db: local, close: closeLocal } = await createTestDatabase());
  });

  afterAll(async () => {
    await closeLocal();
  });

  it("calcule la capacité par membre, absences déduites, sans figer le nombre d'associés (A6)", async () => {
    const full = await createTeamMember(local, {
      kind: "partner",
      weeklyCapacityMinutes: 2100,
    });
    const partial = await createTeamMember(local, {
      kind: "contractor",
      weeklyCapacityMinutes: 840,
    });
    await createTeamMember(local, {
      kind: "employee",
      weeklyCapacityMinutes: 2100,
      status: "inactive",
    });
    await local.insert(schema.memberAbsences).values({
      memberId: full.id,
      startOn: monday,
      endOn: addDays(monday, 1),
      reason: "Congés",
    });

    const overview = await getCapacityOverview(local, { from: monday, to: friday }, { today });
    expect(overview.members).toHaveLength(2);
    const fullLine = overview.members.find((line) => line.memberId === full.id);
    expect(fullLine?.capacityMinutes).toBe(1260);
    expect(fullLine?.absenceMinutes).toBe(840);
    const partialLine = overview.members.find((line) => line.memberId === partial.id);
    expect(partialLine?.capacityMinutes).toBe(840);
    expect(overview.capacityMinutes).toBe(2100);
    expect(overview.loadPercent).toBe(0);
  });

  it("répartit le reste à faire sur le membre assigné et le reste du projet sur l'équipe", async () => {
    const assignee = await createTeamMember(local, {
      kind: "employee",
      weeklyCapacityMinutes: 2100,
    });
    const project = await createProject(local, {
      status: "active",
      startOn: monday,
      dueOn: friday,
      estimatedMinutes: 1500,
    });
    await createTask(local, {
      projectId: project.id,
      assigneeMemberId: assignee.id,
      estimatedMinutes: 600,
      dueOn: friday,
    });
    await createTask(local, { projectId: project.id, status: "done", estimatedMinutes: 9999 });

    const overview = await getCapacityOverview(local, { from: monday, to: friday }, { today });
    expect(overview.members.find((line) => line.memberId === assignee.id)?.plannedMinutes).toBe(
      600,
    );
    expect(overview.plannedMinutes).toBe(1500);
    expect(overview.unassignedMinutes).toBe(900);
  });

  it("déduit le temps déjà saisi du reste à faire", async () => {
    const member = await createMemberContext(local, "member", { weeklyCapacityMinutes: 2100 });
    const project = await createProject(local, {
      status: "active",
      startOn: monday,
      dueOn: friday,
      estimatedMinutes: 600,
    });
    await createTimeEntry(member, {
      workOn: today,
      minutes: 500,
      category: "production",
      projectId: project.id,
    });
    const before = await getCapacityOverview(local, { from: monday, to: friday }, { today });
    // 1500 du projet précédent, 100 restants de celui-ci.
    expect(before.plannedMinutes).toBe(1600);
  });

  it("ignore les projets livrés, clôturés ou archivés", async () => {
    const before = await getCapacityOverview(local, { from: monday, to: friday }, { today });
    for (const overrides of [
      { status: "delivered" as const },
      { status: "closed" as const },
      { status: "active" as const, archivedAt: new Date() },
    ]) {
      await createProject(local, {
        ...overrides,
        startOn: monday,
        dueOn: friday,
        estimatedMinutes: 5000,
      });
    }
    const after = await getCapacityOverview(local, { from: monday, to: friday }, { today });
    expect(after.plannedMinutes).toBe(before.plannedMinutes);
  });

  it("un projet en retard pèse sur les jours qui viennent", async () => {
    const before = await getSixWeekLoad(local, { today });
    await createProject(local, {
      status: "blocked",
      dueOn: addDays(today, -10),
      estimatedMinutes: 420,
    });
    const after = await getSixWeekLoad(local, { today });
    const delta =
      after.reduce((sum, week) => sum + week.plannedMinutes, 0) -
      before.reduce((sum, week) => sum + week.plannedMinutes, 0);
    expect(delta).toBe(420);
  });

  it("donne six semaines consécutives à partir de la semaine courante", async () => {
    const weeks = await getSixWeekLoad(local, { today });
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.weekStart).toBe(weekStart(today));
    expect(weeks[0]?.weekKey).toBe(weekKey(today));
    expect(weeks[5]?.weekStart).toBe(addDays(weekStart(today), 35));
    expect(weeks[0]?.label).toMatch(/^S\d+$/);
    expect(parseWeekKey(weeks[1]?.weekKey)).toBe(weeks[1]?.weekStart);
  });

  it("sans capacité, la charge n'est pas un faux 0 %", async () => {
    const { db: empty, close: closeEmpty } = await createTestDatabase();
    const overview = await getCapacityOverview(empty, monthRange(today), { today });
    expect(overview.loadPercent).toBeNull();
    await closeEmpty();
  });

  it("le simulateur tient compte de la charge réelle", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    await createTeamMember(own, { kind: "partner", weeklyCapacityMinutes: 2100 });
    const admin = await createTestContext(own, "admin");

    const free = await simulateNewProject(admin, { estimatedMinutes: 420 * 5 });
    expect(free.startOn).not.toBeNull();
    expect(free.goLiveOn).not.toBeNull();
    expect(free.capacityMinutesPerWeek).toBe(2100);

    // Toute la capacité des trois prochains mois est prise par un projet déjà signé.
    await createProject(own, {
      status: "active",
      startOn: today,
      dueOn: addDays(today, 90),
      estimatedMinutes: 2100 * 14,
    });
    const busy = await simulateNewProject(admin, { estimatedMinutes: 420 * 5 });
    expect(busy.startOn! > free.startOn!).toBe(true);
    expect(busy.goLiveOn! > free.goLiveOn!).toBe(true);
    expect(busy.startOn! > addDays(today, 85)).toBe(true);

    await expect(simulateNewProject(admin, { estimatedMinutes: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );

    // Un membre lit la capacité ; le simulateur n'écrit rien.
    const member = await createTestContext(own, "member");
    await expect(simulateNewProject(member, { estimatedMinutes: 60 })).resolves.toBeTruthy();
    await closeOwn();
  });

  it("une équipe sans capacité ne promet aucune date", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    const admin = await createTestContext(own, "admin");
    const result = await simulateNewProject(admin, { estimatedMinutes: 600 });
    expect(result.startOn).toBeNull();
    expect(result.goLiveOn).toBeNull();
    await closeOwn();
  });
});

describe("analyses de l'écran 18", () => {
  it("calcule catégories, non facturable, prévu / réel, productivité et dépassements", async () => {
    const { db: own, close: closeOwn } = await createTestDatabase();
    const ctx = await createMemberContext(own, "admin", { hourlyCostCents: 6000 });
    const company = await createCompany(own);
    const delivered = await createProject(own, {
      companyId: company.id,
      status: "delivered",
      activity: "vitrine",
      estimatedMinutes: 1000,
    });
    const running = await createProject(own, {
      companyId: company.id,
      status: "active",
      activity: "landing",
      estimatedMinutes: 100,
      budgetCents: 1_000_000,
    });
    const task = await createTask(own, { projectId: running.id, estimatedMinutes: 30 });

    await createTimeEntry(ctx, {
      workOn: today,
      minutes: 1100,
      category: "production",
      projectId: delivered.id,
    });
    await createTimeEntry(ctx, {
      workOn: today,
      minutes: 90,
      category: "corrections",
      projectId: running.id,
      taskId: task.id,
      billable: false,
    });
    await createTimeEntry(ctx, { workOn: today, minutes: 10, category: "admin" });

    const overview = await getTimeOverview(ctx, { weekOf: today });
    expect(overview.week.totalMinutes).toBe(1200);
    expect(overview.week.byMember).toHaveLength(1);
    expect(overview.categories.map((item) => item.category)).toEqual([
      "production",
      "corrections",
      "admin",
    ]);
    expect(overview.categories[0]?.percent).toBe(92);
    expect(overview.nonBillable.percent).toBe(8);
    expect(overview.nonBillable.categories).toEqual(["corrections", "administratif"]);
    expect(overview.plannedVsActualPercent).toBe(10);
    expect(overview.productivity).toEqual([
      { activity: "vitrine", projects: 1, soldMinutes: 1000, actualMinutes: 1100 },
    ]);
    const overruns = overview.overruns ?? [];
    expect(overruns.find((row) => row.kind === "project")).toMatchObject({
      id: running.id,
      percent: 90,
      costCents: 9000,
      budgetCents: 1_000_000,
    });
    expect(overruns.find((row) => row.kind === "task")).toMatchObject({
      id: task.id,
      percent: 300,
    });
    expect(overview.capacity?.members).toHaveLength(1);
    expect(overview.sixWeeks).toHaveLength(6);

    const viewer = await createMemberContext(own, "viewer");
    const asViewer = await getTimeOverview(viewer, { weekOf: today });
    expect(asViewer.overruns?.[0]).not.toHaveProperty("costCents");
    expect(JSON.stringify(asViewer)).not.toMatch(/costCents|budgetCents/);
    await closeOwn();
  });
});
