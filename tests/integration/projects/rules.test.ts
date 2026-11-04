import { describe, expect, it } from "vitest";
import { CHANGE_REQUEST_TRANSITIONS } from "@/modules/projects/change-request.status";
import {
  canDeliverableTransition,
  DELIVERABLE_TRANSITIONS,
} from "@/modules/projects/deliverable.status";
import { canPhaseTransition, PHASE_TRANSITIONS } from "@/modules/projects/phase.status";
import {
  budgetConsumption,
  isoWeekNumber,
  mondayOf,
  nextWeeks,
  offerLabel,
  parisDay,
  parseChecklistItems,
  parsePlanItems,
  plannedMinutesToDate,
  projectHealth,
  projectProgress,
  projectTitle,
  STANDARD_MILESTONES,
  standardPlan,
  wouldCreateCycle,
} from "@/modules/projects/project.rules";
import { assertProjectTransition, PROJECT_TRANSITIONS } from "@/modules/projects/project.status";
import {
  assertTaskTransition,
  canTaskTransition,
  TASK_TRANSITIONS,
} from "@/modules/projects/task.status";
import { ConflictError } from "@/server/errors";

describe("machines à états", () => {
  it("projet : contrat §4 et §9", () => {
    expect(PROJECT_TRANSITIONS).toEqual({
      preparation: ["active"],
      active: ["blocked", "in_validation"],
      blocked: ["active", "in_validation"],
      in_validation: ["active", "blocked", "delivered"],
      delivered: ["closed"],
      closed: [],
    });
    expect(() => assertProjectTransition("preparation", "delivered")).toThrow(ConflictError);
    expect(() => assertProjectTransition("closed", "active")).toThrow(ConflictError);
  });

  it("tâche : une tâche faite se rouvre, une tâche bloquée ne se termine pas directement", () => {
    expect(TASK_TRANSITIONS.done).toEqual(["in_progress"]);
    expect(canTaskTransition("blocked", "done")).toBe(false);
    expect(canTaskTransition("todo", "done")).toBe(true);
    expect(() => assertTaskTransition("done", "todo")).toThrow(ConflictError);
  });

  it("jalon : pas de saut d'étape", () => {
    expect(PHASE_TRANSITIONS.todo).toEqual(["in_progress"]);
    expect(canPhaseTransition("todo", "done")).toBe(false);
    expect(canPhaseTransition("done", "in_progress")).toBe(true);
  });

  it("livrable : un validé ne redevient qu'un brouillon", () => {
    expect(DELIVERABLE_TRANSITIONS.validated).toEqual(["draft"]);
    expect(canDeliverableTransition("draft", "validated")).toBe(false);
    expect(canDeliverableTransition("changes_requested", "to_validate")).toBe(true);
  });

  it("demande de changement : une décision est définitive", () => {
    // Des travaux acceptés peuvent encore donner un devis ou un avenant, rien d'autre.
    expect(CHANGE_REQUEST_TRANSITIONS.accepted).toEqual(["converted"]);
    expect(CHANGE_REQUEST_TRANSITIONS.refused).toEqual([]);
    expect(CHANGE_REQUEST_TRANSITIONS.converted).toEqual([]);
  });
});

describe("dépendances", () => {
  const edges = [
    { taskId: "b", dependsOnTaskId: "a" },
    { taskId: "c", dependsOnTaskId: "b" },
  ];

  it("refuse une tâche qui dépend d'elle-même", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("refuse une boucle directe ou indirecte", () => {
    expect(wouldCreateCycle(edges, "a", "b")).toBe(true);
    expect(wouldCreateCycle(edges, "a", "c")).toBe(true);
  });

  it("accepte un graphe sans boucle, y compris en losange", () => {
    expect(wouldCreateCycle(edges, "c", "a")).toBe(false);
    expect(wouldCreateCycle(edges, "d", "c")).toBe(false);
    expect(
      wouldCreateCycle(
        [
          { taskId: "b", dependsOnTaskId: "a" },
          { taskId: "c", dependsOnTaskId: "a" },
          { taskId: "d", dependsOnTaskId: "b" },
        ],
        "d",
        "c",
      ),
    ).toBe(false);
  });
});

describe("modèles", () => {
  it("lit une liste de noms de jalons", () => {
    const plan = parsePlanItems(["Cadrage", "Livraison"]);
    expect(plan?.map((phase) => phase.name)).toEqual(["Cadrage", "Livraison"]);
    expect(plan?.[0]).toMatchObject({ clientVisible: true, dueOffsetDays: null, tasks: [] });
  });

  it("lit des jalons avec leurs tâches initiales", () => {
    const plan = parsePlanItems([
      {
        name: "Design",
        clientVisible: false,
        dueOffsetDays: 14,
        tasks: ["Moodboard", { title: "Maquette", estimatedMinutes: 840 }],
      },
    ]);
    expect(plan?.[0]).toMatchObject({ name: "Design", clientVisible: false, dueOffsetDays: 14 });
    expect(plan?.[0]?.tasks).toEqual([
      { title: "Moodboard", estimatedMinutes: null, description: null },
      { title: "Maquette", estimatedMinutes: 840, description: null },
    ]);
  });

  it("un modèle vide ou illisible donne null : l'appelant prend le plan standard", () => {
    expect(parsePlanItems([])).toBeNull();
    expect(parsePlanItems([{ nom: "x" }])).toBeNull();
    expect(parsePlanItems("Cadrage")).toBeNull();
    expect(standardPlan().map((phase) => phase.name)).toEqual([...STANDARD_MILESTONES]);
  });

  it("lit une checklist, et ignore ce qui n'en est pas une", () => {
    expect(parseChecklistItems(["A", { label: "B" }])).toEqual(["A", "B"]);
    expect(parseChecklistItems(null)).toEqual([]);
  });
});

describe("avancement", () => {
  it("rapporte le temps fait à l'enveloppe vendue", () => {
    const progress = projectProgress(
      { taskCount: 4, doneCount: 1, estimatedMinutes: 1000, doneMinutes: 500 },
      2000,
    );
    expect(progress).toEqual({ percent: 25, unit: "minutes", done: 500, total: 2000 });
  });

  it("compte les tâches quand rien n'est estimé", () => {
    const progress = projectProgress(
      { taskCount: 4, doneCount: 1, estimatedMinutes: 0, doneMinutes: 0 },
      null,
    );
    expect(progress).toEqual({ percent: 25, unit: "tasks", done: 1, total: 4 });
  });

  it("ne dépasse pas 100 %", () => {
    expect(
      projectProgress({ taskCount: 1, doneCount: 1, estimatedMinutes: 900, doneMinutes: 900 }, 300)
        .percent,
    ).toBe(100);
  });
});

describe("état lisible", () => {
  const base = { today: "2026-11-04", openBlockers: 0, expectedRequirements: 0 };

  it("le retard l'emporte et donne le nombre de jours", () => {
    const health = projectHealth(
      { status: "blocked", dueOn: "2026-11-02" },
      { ...base, expectedRequirements: 2 },
    );
    expect(health).toMatchObject({ kind: "late", label: "En retard · 2 j", tone: "danger" });
  });

  it("distingue contenus attendus, blocage, en attente et dans les temps", () => {
    expect(
      projectHealth(
        { status: "blocked", dueOn: "2026-12-01" },
        { ...base, expectedRequirements: 1 },
      ).label,
    ).toBe("Contenus attendus");
    expect(
      projectHealth({ status: "active", dueOn: "2026-12-01" }, { ...base, openBlockers: 1 }).label,
    ).toBe("Bloqué");
    expect(projectHealth({ status: "preparation", dueOn: null }, base).label).toBe("En attente");
    expect(projectHealth({ status: "active", dueOn: "2026-12-01" }, base).label).toBe(
      "Dans les temps",
    );
    expect(projectHealth({ status: "delivered", dueOn: "2026-01-01" }, base).label).toBe("Livré");
  });
});

describe("consommation", () => {
  it("le premier de l'argent ou du temps à 80 % déclenche", () => {
    const byTime = budgetConsumption({
      budgetCents: 1_000_000,
      estimatedMinutes: 1000,
      consumedCents: 1000,
      spentMinutes: 800,
    });
    expect(byTime.reached).toBe(true);
    const byCost = budgetConsumption({
      budgetCents: 1000,
      estimatedMinutes: null,
      consumedCents: 800,
      spentMinutes: 1,
    });
    expect(byCost.reached).toBe(true);
    const below = budgetConsumption({
      budgetCents: 1000,
      estimatedMinutes: 1000,
      consumedCents: 799,
      spentMinutes: 799,
    });
    expect(below.reached).toBe(false);
  });

  it("sans enveloppe, pas d'alerte", () => {
    expect(
      budgetConsumption({
        budgetCents: null,
        estimatedMinutes: null,
        consumedCents: 900,
        spentMinutes: 900,
      }),
    ).toMatchObject({ percent: null, reached: false });
  });

  it("le prévu à date suit le temps écoulé, borné à l'enveloppe", () => {
    const input = { startOn: "2026-11-01", dueOn: "2026-11-11", estimatedMinutes: 1000 };
    expect(plannedMinutesToDate({ ...input, today: "2026-11-06" })).toBe(500);
    expect(plannedMinutesToDate({ ...input, today: "2026-10-01" })).toBe(0);
    expect(plannedMinutesToDate({ ...input, today: "2027-01-01" })).toBe(1000);
    expect(plannedMinutesToDate({ ...input, dueOn: null, today: "2026-11-06" })).toBeNull();
  });
});

describe("calendrier", () => {
  it("trouve le lundi et le numéro de semaine ISO", () => {
    expect(mondayOf("2026-11-04")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(isoWeekNumber("2026-11-04")).toBe(45);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(nextWeeks("2026-11-04", 3)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("le jour civil est celui de Paris", () => {
    expect(parisDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});

describe("présentation", () => {
  it("sépare le client de l'offre, sans jamais le répéter", () => {
    expect(offerLabel("Atelier Lune · Site vitrine", "Atelier Lune")).toBe("Site vitrine");
    expect(offerLabel("Site vitrine", "Atelier Lune")).toBe("Site vitrine");
    expect(projectTitle("Atelier Lune · Site vitrine", "Atelier Lune")).toBe(
      "Atelier Lune · Site vitrine",
    );
    expect(projectTitle("Site vitrine", "Atelier Lune")).toBe("Atelier Lune · Site vitrine");
  });
});
