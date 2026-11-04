import { describe, expect, it } from "vitest";
import { planStageOptions, type TwentySelectOption } from "./twenty.data-model";

/** Options réellement livrées par Twenty v2.55.0 sur un espace neuf. */
const DEFAULT_OPTIONS: TwentySelectOption[] = [
  { id: "id-new", color: "red", label: "New", value: "NEW", position: 0 },
  { id: "id-screening", color: "purple", label: "Screening", value: "SCREENING", position: 1 },
  { id: "id-meeting", color: "sky", label: "Meeting", value: "MEETING", position: 2 },
  { id: "id-proposal", color: "turquoise", label: "Proposal", value: "PROPOSAL", position: 3 },
  { id: "id-customer", color: "yellow", label: "Customer", value: "CUSTOMER", position: 4 },
];

describe("planStageOptions", () => {
  it("renomme les étapes par défaut en gardant leur identifiant (les dossiers suivent)", () => {
    const { options, orphanValues } = planStageOptions(DEFAULT_OPTIONS, () => "id-nouveau");
    expect(orphanValues).toEqual([]);
    expect(options?.map(({ id, value, label, position }) => [id, value, label, position])).toEqual([
      ["id-new", "NEW", "Nouveau", 0],
      ["id-screening", "QUALIFIED", "Qualifié", 1],
      ["id-proposal", "QUOTE_SENT", "Devis envoyé", 2],
      ["id-meeting", "NEGOTIATION", "Négociation", 3],
      ["id-customer", "WON", "Gagné", 4],
      ["id-nouveau", "LOST", "Perdu", 5],
    ]);
  });

  it("ne propose rien sur une instance déjà conforme (idempotence)", () => {
    const applied = planStageOptions(DEFAULT_OPTIONS, () => "id-nouveau").options!;
    expect(planStageOptions(applied)).toEqual({ options: null, orphanValues: [] });
  });

  it("corrige un libellé ou un ordre modifié à la main sans changer l'identifiant", () => {
    const applied = planStageOptions(DEFAULT_OPTIONS, () => "id-nouveau").options!;
    const altered = applied.map((option) =>
      option.value === "WON" ? { ...option, label: "Signé", position: 5 } : option,
    );
    const plan = planStageOptions(altered);
    expect(plan.options?.find((option) => option.value === "WON")).toMatchObject({
      id: "id-customer",
      label: "Gagné",
      position: 4,
    });
  });

  it("signale les étapes sans équivalent au lieu de les effacer en silence", () => {
    const plan = planStageOptions([
      ...DEFAULT_OPTIONS,
      { id: "id-demo", color: "blue", label: "Démo", value: "DEMO", position: 5 },
    ]);
    expect(plan.orphanValues).toEqual(["DEMO"]);
    expect(plan.options).toHaveLength(6);
  });

  it("préfère la valeur Nuera déjà présente à une ancienne valeur équivalente", () => {
    const plan = planStageOptions(
      [
        { id: "id-1", color: "gray", label: "Qualifié", value: "QUALIFIED", position: 1 },
        { id: "id-2", color: "blue", label: "Screening", value: "SCREENING", position: 2 },
      ],
      () => "id-x",
    );
    expect(plan.options?.find((option) => option.value === "QUALIFIED")?.id).toBe("id-1");
    expect(plan.orphanValues).toEqual(["SCREENING"]);
  });
});
