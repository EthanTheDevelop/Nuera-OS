import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveProject,
  changeProjectStatus,
  checkProjectBudget,
  createProject,
  createProjectFromQuote,
  getProjectDetail,
  getProjectsOverview,
  goLiveProject,
  listProjects,
  listProjectsForCompany,
  restoreProject,
  sweepProjectBudgets,
  updateProject,
} from "@/modules/projects/project.service";
import { raiseBlocker, resolveBlocker } from "@/modules/projects/production.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createMemberContext,
  createOpportunity,
  createProject as createProjectRow,
  createQuote,
  createSite,
  createTask,
  createTeamMember,
} from "../../helpers/factories";

const sites = vi.hoisted(() => ({ activate: vi.fn() }));
vi.mock("@/modules/sites/site.service", () => ({
  activateSiteAfterGoLive: sites.activate,
}));

let db: Database;
let close: () => Promise<void>;
let admin: ServiceContext;
let member: ServiceContext;
let viewer: ServiceContext;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  admin = await createMemberContext(db, "admin");
  member = await createMemberContext(db, "member");
  viewer = await createTestContext(db, "viewer");
});
afterAll(async () => close());
beforeEach(() => {
  sites.activate.mockReset();
  sites.activate.mockResolvedValue(undefined);
});

async function eventsOf(type: string, entityId: string) {
  return db
    .select()
    .from(schema.domainEvents)
    .where(and(eq(schema.domainEvents.type, type), eq(schema.domainEvents.entityId, entityId)));
}

describe("createProjectFromQuote", () => {
  it("crée le projet et les cinq jalons standard, sans modèle pour l'activité", async () => {
    const company = await createCompany(db);
    const { quote, version } = await createQuote(
      db,
      { companyId: company.id, title: "Site vitrine", status: "accepted" },
      { totalCents: 780_000, estimatedMinutes: 5040, scope: "5 pages" },
    );

    const project = await db.transaction((tx) =>
      createProjectFromQuote(admin, tx, {
        quoteId: quote.id,
        opportunityId: null,
        companyId: company.id,
        versionId: version.id,
      }),
    );

    expect(project).toMatchObject({
      name: "Site vitrine",
      companyId: company.id,
      quoteId: quote.id,
      status: "preparation",
      budgetCents: 780_000,
      estimatedMinutes: 5040,
      scope: "5 pages",
    });
    expect(project.number).toMatch(/^P-\d{4}-\d{3}$/);
    const phases = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, project.id));
    expect(phases.sort((a, b) => a.position - b.position).map((phase) => phase.name)).toEqual([
      "Cadrage",
      "Design",
      "Développement",
      "Recette",
      "Mise en ligne",
    ]);
    expect(await eventsOf("project.created", project.id)).toHaveLength(1);
  });

  it("est idempotent par quoteId : aucun doublon, aucun second événement", async () => {
    const company = await createCompany(db);
    const { quote, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    const input = {
      quoteId: quote.id,
      opportunityId: null,
      companyId: company.id,
      versionId: version.id,
    };

    const first = await db.transaction((tx) => createProjectFromQuote(admin, tx, input));
    const second = await db.transaction((tx) => createProjectFromQuote(admin, tx, input));

    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.quoteId, quote.id));
    expect(rows).toHaveLength(1);
    const phases = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, first.id));
    expect(phases).toHaveLength(5);
    expect(await eventsOf("project.created", first.id)).toHaveLength(1);
  });

  it("suit le modèle de plan de l'activité, tâches initiales et checklist comprises", async () => {
    const company = await createCompany(db);
    const [catalog] = await db
      .insert(schema.catalogItems)
      .values({
        kind: "project",
        activity: "landing",
        name: "Landing",
        priceCents: 100_000,
      })
      .returning();
    await db.insert(schema.templates).values([
      {
        kind: "project_plan",
        activity: "landing",
        name: "Plan landing",
        items: [
          {
            name: "Brief",
            dueOffsetDays: 3,
            tasks: ["Atelier", { title: "Maquette", estimatedMinutes: 420 }],
          },
          "Livraison",
        ],
      },
      {
        kind: "checklist",
        activity: "landing",
        name: "Recette landing",
        items: ["Formulaire testé"],
      },
    ]);
    const { quote, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    await db.insert(schema.quoteLines).values({
      quoteVersionId: version.id,
      catalogItemId: catalog?.id,
      label: "Landing",
    });

    const project = await db.transaction((tx) =>
      createProjectFromQuote(admin, tx, {
        quoteId: quote.id,
        opportunityId: null,
        companyId: company.id,
        versionId: version.id,
      }),
    );

    expect(project.activity).toBe("landing");
    const phases = await db
      .select()
      .from(schema.projectPhases)
      .where(eq(schema.projectPhases.projectId, project.id));
    expect(phases.map((phase) => phase.name).sort()).toEqual(["Brief", "Livraison"]);
    expect(phases.find((phase) => phase.name === "Brief")?.dueOn).toBeTruthy();
    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id));
    expect(tasks.map((task) => task.title).sort()).toEqual(["Atelier", "Maquette"]);
    expect(tasks.every((task) => /^TA-\d{4}-\d{3}$/.test(task.number))).toBe(true);
    const handover = await db
      .select()
      .from(schema.handoverChecklistItems)
      .where(eq(schema.handoverChecklistItems.projectId, project.id));
    expect(handover.map((item) => item.label)).toEqual(["Formulaire testé"]);
  });

  it("reprend le responsable de l'affaire d'origine", async () => {
    const company = await createCompany(db);
    const owner = await createTeamMember(db);
    const opportunity = await createOpportunity(db, {
      companyId: company.id,
      ownerMemberId: owner.id,
    });
    const { quote, version } = await createQuote(db, {
      companyId: company.id,
      opportunityId: opportunity.id,
      status: "accepted",
    });
    const project = await db.transaction((tx) =>
      createProjectFromQuote(admin, tx, {
        quoteId: quote.id,
        opportunityId: opportunity.id,
        companyId: company.id,
        versionId: version.id,
      }),
    );
    expect(project.ownerMemberId).toBe(owner.id);
    expect(project.opportunityId).toBe(opportunity.id);
  });

  it("refuse une version d'un autre devis et un devis d'un autre client", async () => {
    const company = await createCompany(db);
    const other = await createCompany(db);
    const { quote, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    const { version: foreignVersion } = await createQuote(db, { companyId: other.id });

    await expect(
      db.transaction((tx) =>
        createProjectFromQuote(admin, tx, {
          quoteId: quote.id,
          opportunityId: null,
          companyId: company.id,
          versionId: foreignVersion.id,
        }),
      ),
    ).rejects.toThrow(NotFoundError);
    await expect(
      db.transaction((tx) =>
        createProjectFromQuote(admin, tx, {
          quoteId: quote.id,
          opportunityId: null,
          companyId: other.id,
          versionId: version.id,
        }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("refuse un rôle sans droit", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db);
    const { quote, version } = await createQuote(db, {
      companyId: company.id,
      status: "accepted",
    });
    const input = {
      quoteId: quote.id,
      opportunityId: null,
      companyId: company.id,
      versionId: version.id,
    };
    await expect(createProjectFromQuote(viewer, db, input)).rejects.toThrow(ForbiddenError);
    await expect(createProjectFromQuote(contractor, db, input)).rejects.toThrow(ForbiddenError);
  });
});

describe("création et modification", () => {
  it("crée un projet manuel avec son plan et journalise", async () => {
    const company = await createCompany(db);
    const project = await createProject(admin, {
      companyId: company.id,
      name: "Refonte",
      startOn: "2026-11-01",
      dueOn: "2026-12-01",
      budgetCents: 100_000,
    });
    expect(project.quoteId).toBeNull();
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, project.id));
    expect(audit.map((row) => row.action)).toContain("project.created");
  });

  it("valide l'entrée avant toute écriture", async () => {
    const company = await createCompany(db);
    await expect(createProject(admin, { companyId: company.id, name: "  " })).rejects.toThrow(
      ValidationError,
    );
    await expect(
      createProject(admin, {
        companyId: company.id,
        name: "Dates",
        startOn: "2026-12-01",
        dueOn: "2026-11-01",
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createProject(admin, {
        companyId: "00000000-0000-4000-8000-000000000000",
        name: "Sans client",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("applique les droits par rôle", async () => {
    const company = await createCompany(db);
    await expect(createProject(viewer, { companyId: company.id, name: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    const project = await createProjectRow(db, { companyId: company.id });
    await expect(updateProject(viewer, { projectId: project.id, name: "y" })).rejects.toThrow(
      ForbiddenError,
    );
    const updated = await updateProject(member, { projectId: project.id, name: "Nouveau nom" });
    expect(updated.name).toBe("Nouveau nom");
  });

  it("archive au lieu de supprimer, et restaure", async () => {
    const project = await createProjectRow(db);
    await expect(archiveProject(viewer, project.id)).rejects.toThrow(ForbiddenError);
    const archived = await archiveProject(admin, project.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(updateProject(admin, { projectId: project.id, name: "Interdit" })).rejects.toThrow(
      ConflictError,
    );
    expect((await archiveProject(admin, project.id)).archivedAt).toEqual(archived.archivedAt);
    const restored = await restoreProject(admin, project.id);
    expect(restored.archivedAt).toBeNull();
  });
});

describe("statuts", () => {
  it("applique la machine à états et refuse le reste", async () => {
    const project = await createProjectRow(db, { status: "preparation" });
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "in_validation" }),
    ).rejects.toThrow(ConflictError);
    const active = await changeProjectStatus(admin, { projectId: project.id, status: "active" });
    expect(active.status).toBe("active");
    await changeProjectStatus(admin, { projectId: project.id, status: "blocked" });
    await changeProjectStatus(admin, { projectId: project.id, status: "active" });
    await changeProjectStatus(admin, { projectId: project.id, status: "in_validation" });
    await changeProjectStatus(admin, { projectId: project.id, status: "active" });
    await changeProjectStatus(admin, { projectId: project.id, status: "in_validation" });
    await changeProjectStatus(admin, { projectId: project.id, status: "blocked" });
    await changeProjectStatus(admin, { projectId: project.id, status: "in_validation" });
    const delivered = await changeProjectStatus(admin, {
      projectId: project.id,
      status: "delivered",
    });
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredOn).toBeTruthy();
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "active" }),
    ).rejects.toThrow(ConflictError);
    const closed = await changeProjectStatus(admin, { projectId: project.id, status: "closed" });
    expect(closed.status).toBe("closed");
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "active" }),
    ).rejects.toThrow(ConflictError);
  });

  it("répéter le même statut ne fait rien, sans événement", async () => {
    const project = await createProjectRow(db, { status: "active" });
    await changeProjectStatus(admin, { projectId: project.id, status: "active" });
    expect(await eventsOf("project.status_changed", project.id)).toHaveLength(0);
  });

  it("démarrer un projet éclaire son premier jalon", async () => {
    const project = await createProject(admin, {
      companyId: (await createCompany(db)).id,
      name: "Démarrage",
    });
    await changeProjectStatus(admin, { projectId: project.id, status: "active" });
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.phases[0]).toMatchObject({ name: "Cadrage", status: "in_progress" });
  });

  it("ne clôture pas tant que la passation n'est pas finie", async () => {
    const project = await createProjectRow(db, { status: "delivered" });
    await db.insert(schema.handoverChecklistItems).values({
      projectId: project.id,
      label: "Accès remis",
    });
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "closed" }),
    ).rejects.toThrow(/passation/);
  });
});

describe("mise en ligne", () => {
  async function projectInValidation() {
    const company = await createCompany(db);
    const project = await createProjectRow(db, { companyId: company.id, status: "in_validation" });
    const site = await createSite(db, { companyId: company.id, projectId: project.id });
    return { company, project, site };
  }

  it("passe le projet en livré et active son site", async () => {
    const { project, site } = await projectInValidation();
    const delivered = await goLiveProject(admin, { projectId: project.id, siteId: site.id });
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredOn).toBeTruthy();
    expect(sites.activate).toHaveBeenCalledTimes(1);
    expect(sites.activate.mock.calls[0]?.[2]).toEqual({ projectId: project.id, siteId: site.id });
    expect(await eventsOf("project.delivered", project.id)).toHaveLength(1);
  });

  it("choisit seul le site quand il n'y en a qu'un", async () => {
    const { project, site } = await projectInValidation();
    await goLiveProject(admin, { projectId: project.id });
    expect(sites.activate.mock.calls[0]?.[2]).toEqual({ projectId: project.id, siteId: site.id });
  });

  it("exige un choix quand il y a plusieurs sites", async () => {
    const { company, project } = await projectInValidation();
    await createSite(db, { companyId: company.id, projectId: project.id });
    await expect(goLiveProject(admin, { projectId: project.id })).rejects.toThrow(ValidationError);
  });

  it("répéter ne rejoue ni l'activation ni l'événement", async () => {
    const { project, site } = await projectInValidation();
    await goLiveProject(admin, { projectId: project.id, siteId: site.id });
    await goLiveProject(admin, { projectId: project.id, siteId: site.id });
    expect(sites.activate).toHaveBeenCalledTimes(1);
    expect(await eventsOf("project.delivered", project.id)).toHaveLength(1);
  });

  it("si le site échoue, le projet reste en validation : tout ou rien", async () => {
    const { project, site } = await projectInValidation();
    sites.activate.mockRejectedValue(
      new ServiceUnavailableError("Coolify", "unreachable", "Coolify est injoignable."),
    );
    await expect(goLiveProject(admin, { projectId: project.id, siteId: site.id })).rejects.toThrow(
      ServiceUnavailableError,
    );
    const detail = await getProjectDetail(admin, project.id);
    expect(detail.status).toBe("in_validation");
    expect(detail.deliveredOn).toBeNull();
    expect(await eventsOf("project.delivered", project.id)).toHaveLength(0);
  });

  it("refuse un site d'un autre projet, et le passage direct d'un projet qui a un site", async () => {
    const { project } = await projectInValidation();
    const foreign = await createSite(db);
    await expect(
      goLiveProject(admin, { projectId: project.id, siteId: foreign.id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      changeProjectStatus(admin, { projectId: project.id, status: "delivered" }),
    ).rejects.toThrow(/mise en ligne/);
  });

  it("refuse hors de la validation, avec un blocage ouvert ou une validation client en attente", async () => {
    const active = await createProjectRow(db, { status: "active" });
    await expect(goLiveProject(admin, { projectId: active.id })).rejects.toThrow(ConflictError);

    const { project, site } = await projectInValidation();
    const blocker = await raiseBlocker(admin, { projectId: project.id, title: "Paiement" });
    await expect(goLiveProject(admin, { projectId: project.id, siteId: site.id })).rejects.toThrow(
      /blocage/,
    );
    await resolveBlocker(admin, { blockerId: blocker.id });

    await db.insert(schema.deliverables).values({
      projectId: project.id,
      title: "Maquette",
      requiresClientValidation: true,
      status: "to_validate",
    });
    await expect(goLiveProject(admin, { projectId: project.id, siteId: site.id })).rejects.toThrow(
      /Maquette/,
    );
    expect(sites.activate).not.toHaveBeenCalled();
  });

  it("refuse un rôle sans droit", async () => {
    const { project, site } = await projectInValidation();
    await expect(goLiveProject(viewer, { projectId: project.id, siteId: site.id })).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("seuil de budget", () => {
  async function addTime(projectId: string, companyId: string, minutes: number, cost = 6000) {
    const worker = await createTeamMember(db);
    await db.insert(schema.timeEntries).values({
      memberId: worker.id,
      companyId,
      projectId,
      workOn: "2026-11-01",
      minutes,
      category: "production",
      hourlyCostCents: cost,
    });
  }

  it("émet une seule fois, au franchissement de 80 %", async () => {
    const company = await createCompany(db);
    const project = await createProjectRow(db, {
      companyId: company.id,
      budgetCents: 100_000,
      estimatedMinutes: 6000,
    });
    await addTime(project.id, company.id, 600);
    expect((await checkProjectBudget(db, project.id, { actorId: null })).reached).toBe(false);
    expect(await eventsOf("budget.threshold_80", project.id)).toHaveLength(0);

    await addTime(project.id, company.id, 200);
    const reached = await checkProjectBudget(db, project.id, { actorId: null });
    expect(reached.reached).toBe(true);
    expect(reached.percent).toBeCloseTo(80);
    const [event] = await eventsOf("budget.threshold_80", project.id);
    expect(event?.payload).toEqual({ consumedCents: 80_000, budgetCents: 100_000 });

    await addTime(project.id, company.id, 300);
    await checkProjectBudget(db, project.id, { actorId: null });
    await sweepProjectBudgets(db);
    expect(await eventsOf("budget.threshold_80", project.id)).toHaveLength(1);
  });

  it("le rattrapage périodique émet pour ce que la saisie a manqué", async () => {
    const company = await createCompany(db);
    const project = await createProjectRow(db, {
      companyId: company.id,
      estimatedMinutes: 100,
      status: "active",
    });
    await addTime(project.id, company.id, 90);
    await sweepProjectBudgets(db);
    expect(await eventsOf("budget.threshold_80", project.id)).toHaveLength(1);
  });

  it("réduire l'enveloppe peut franchir le seuil", async () => {
    const company = await createCompany(db);
    const project = await createProjectRow(db, {
      companyId: company.id,
      estimatedMinutes: 10_000,
    });
    await addTime(project.id, company.id, 500);
    await updateProject(admin, {
      projectId: project.id,
      name: project.name,
      estimatedMinutes: 600,
    });
    expect(await eventsOf("budget.threshold_80", project.id)).toHaveLength(1);
  });
});

describe("lectures et périmètre", () => {
  it("filtre, cherche et pagine côté serveur", async () => {
    const company = await createCompany(db, { name: "Filtre Unique SARL" });
    for (let index = 0; index < 3; index += 1) {
      await createProjectRow(db, {
        companyId: company.id,
        status: "active",
        name: `Actif ${index}`,
      });
    }
    await createProjectRow(db, { companyId: company.id, status: "preparation", name: "À venir" });
    await createProjectRow(db, { companyId: company.id, status: "delivered", name: "Livré" });
    await createProjectRow(db, {
      companyId: company.id,
      status: "active",
      name: "En retard",
      dueOn: "2020-01-01",
    });

    const search = "Filtre Unique";
    const open = await listProjects(admin, { search, view: "active", pageSize: 2 });
    expect(open.total).toBe(4);
    expect(open.items).toHaveLength(2);
    const second = await listProjects(admin, { search, view: "active", pageSize: 2, page: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.items[0]?.id).not.toBe(open.items[0]?.id);

    expect((await listProjects(admin, { search, view: "upcoming" })).total).toBe(1);
    expect((await listProjects(admin, { search, view: "delivered" })).total).toBe(1);
    const late = await listProjects(admin, { search, view: "late" });
    expect(late.total).toBe(1);
    expect(late.items[0]?.health.kind).toBe("late");
  });

  it("calcule étape, avancement, équipe et état", async () => {
    const company = await createCompany(db, { name: "Atelier Résumé" });
    const worker = await createTeamMember(db, { fullName: "Ethan Ngo" });
    const project = await createProjectRow(db, {
      companyId: company.id,
      name: "Atelier Résumé · Site vitrine",
      status: "active",
      estimatedMinutes: 1000,
      dueOn: "2099-01-01",
    });
    await db.insert(schema.projectPhases).values([
      { projectId: project.id, name: "Cadrage", position: 1, status: "done" },
      { projectId: project.id, name: "Design", position: 2, status: "in_progress" },
      { projectId: project.id, name: "Recette", position: 3 },
    ]);
    await db.insert(schema.projectMembers).values({ projectId: project.id, memberId: worker.id });
    await createTask(db, { projectId: project.id, estimatedMinutes: 500, status: "done" });
    await createTask(db, { projectId: project.id, estimatedMinutes: 500 });

    const { items } = await listProjects(admin, { search: "Atelier Résumé" });
    expect(items[0]).toMatchObject({
      offer: "Site vitrine",
      companyName: "Atelier Résumé",
      stage: { index: 2, name: "Design" },
      team: ["Ethan Ngo"],
      health: { kind: "on_time" },
      progress: { percent: 50, done: 500, total: 1000 },
    });
  });

  it("un prestataire ne voit que ses projets, le reste répond 404", async () => {
    const contractor = await createMemberContext(db, "contractor");
    const company = await createCompany(db, { name: "Périmètre Prestataire" });
    const mine = await createProjectRow(db, {
      companyId: company.id,
      status: "active",
      budgetCents: 500_000,
    });
    const other = await createProjectRow(db, { companyId: company.id, status: "active" });
    await db.insert(schema.projectMembers).values({
      projectId: mine.id,
      memberId: contractor.member.id,
    });

    const { items, total } = await listProjects(contractor, { search: "Périmètre Prestataire" });
    expect(total).toBe(1);
    expect(items[0]?.id).toBe(mine.id);

    const detail = await getProjectDetail(contractor, mine.id);
    expect(detail.budgetCents).toBeNull();
    expect(detail.planned).toBeNull();
    expect(detail.changeRequests).toEqual([]);
    expect(detail.capabilities).toMatchObject({ edit: false, addTask: false, archive: false });

    await expect(getProjectDetail(contractor, other.id)).rejects.toThrow(NotFoundError);
    expect(await listProjectsForCompany(contractor, company.id)).toHaveLength(1);
    expect((await getProjectsOverview(contractor)).load).toBeNull();
  });

  it("un prestataire sans fiche d'équipe ne voit rien", async () => {
    const lonely = await createTestContext(db, "contractor");
    expect((await listProjects(lonely)).total).toBe(0);
  });

  it("un client n'a aucun accès interne", async () => {
    const client = await createTestContext(db, "client");
    await expect(listProjects(client)).rejects.toThrow(ForbiddenError);
  });

  it("un lecteur lit tout mais n'écrit rien, un objet inconnu répond 404", async () => {
    const project = await createProjectRow(db);
    const detail = await getProjectDetail(viewer, project.id);
    expect(detail.capabilities.edit).toBe(false);
    await expect(getProjectDetail(admin, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("masque le coût du temps sans team:read_costs", async () => {
    const company = await createCompany(db);
    const project = await createProjectRow(db, { companyId: company.id, budgetCents: 100_000 });
    expect((await getProjectDetail(member, project.id)).planned?.consumedCents).toBeNull();
    expect((await getProjectDetail(admin, project.id)).planned?.consumedCents).toBe(0);
  });

  it("donne les lignes compactes de la fiche client", async () => {
    const company = await createCompany(db);
    const project = await createProjectRow(db, {
      companyId: company.id,
      status: "active",
      budgetCents: 100_000,
    });
    const rows = await listProjectsForCompany(admin, company.id, { limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: project.id, status: "active", budgetCents: 100_000 });
  });

  it("répartit la charge des tâches ouvertes sur six semaines, le retard sur la semaine en cours", async () => {
    const isolated = await createTestDatabase();
    try {
      const ctx = await createMemberContext(isolated.db, "admin", {
        weeklyCapacityMinutes: 2100,
      });
      const project = await createProjectRow(isolated.db, { status: "active" });
      await createTask(isolated.db, {
        projectId: project.id,
        estimatedMinutes: 100,
        dueOn: "2026-10-01",
      });
      await createTask(isolated.db, {
        projectId: project.id,
        estimatedMinutes: 200,
        dueOn: "2026-11-05",
      });
      await createTask(isolated.db, {
        projectId: project.id,
        estimatedMinutes: 400,
        dueOn: "2026-11-11",
      });
      await createTask(isolated.db, {
        projectId: project.id,
        estimatedMinutes: 999,
        dueOn: "2026-11-05",
        status: "done",
      });
      await createTask(isolated.db, {
        projectId: project.id,
        estimatedMinutes: 999,
        dueOn: "2027-06-01",
      });

      const overview = await getProjectsOverview(ctx, { now: new Date("2026-11-04T10:00:00Z") });
      expect(overview.load?.weeks[0]?.capacityMinutes).toBeGreaterThan(0);
      expect(overview.load?.weeks.map((week) => week.label)).toEqual([
        "S45",
        "S46",
        "S47",
        "S48",
        "S49",
        "S50",
      ]);
      // Le module Temps répartit le reste à faire : les tâches ouvertes pèsent, pas celles qui sont faites.
      const planned = overview.load?.weeks.reduce((sum, week) => sum + week.plannedMinutes, 0) ?? 0;
      expect(planned).toBeGreaterThan(0);
    } finally {
      await isolated.close();
    }
  });
});
