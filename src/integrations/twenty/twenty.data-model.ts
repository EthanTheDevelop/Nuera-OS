/**
 * Configuration Nuera du modèle de données Twenty (appliquée par `npm run twenty:bootstrap`).
 *
 * Seules les étapes d'opportunité sont configurées dans Twenty : les champs propres à Nuera
 * (probabilité, source, tags, motif de perte, prochaine action…) restent dans les tables de
 * Nuera OS, jointes par l'identifiant Twenty.
 */
import { randomUUID } from "node:crypto";
import type { OpportunityStage } from "./crm-gateway";

export type TwentySelectOption = {
  id: string;
  value: string;
  label: string;
  color: string;
  position: number;
};

export const NUERA_STAGES: readonly {
  value: OpportunityStage;
  label: string;
  color: string;
}[] = [
  { value: "NEW", label: "Nouveau", color: "gray" },
  { value: "QUALIFIED", label: "Qualifié", color: "sky" },
  { value: "QUOTE_SENT", label: "Devis envoyé", color: "purple" },
  { value: "NEGOTIATION", label: "Négociation", color: "orange" },
  { value: "WON", label: "Gagné", color: "green" },
  { value: "LOST", label: "Perdu", color: "red" },
];

/**
 * Étapes par défaut de Twenty, renommées (et non supprimées) : à identifiant d'option constant,
 * Twenty renomme la valeur dans l'enum PostgreSQL, ce qui migre les enregistrements existants
 * et les colonnes des vues Kanban.
 */
const LEGACY_STAGE_MAPPING: Readonly<Record<string, OpportunityStage>> = {
  SCREENING: "QUALIFIED",
  PROPOSAL: "QUOTE_SENT",
  MEETING: "NEGOTIATION",
  CUSTOMER: "WON",
};

export type StageOptionsPlan = {
  /** Options à envoyer ; `null` si l'instance est déjà conforme. */
  options: TwentySelectOption[] | null;
  /** Options actuelles sans équivalent Nuera : leur suppression effacerait la valeur des dossiers. */
  orphanValues: string[];
};

function isSameOption(a: TwentySelectOption | undefined, b: TwentySelectOption): boolean {
  return (
    a !== undefined &&
    a.value === b.value &&
    a.label === b.label &&
    a.color === b.color &&
    a.position === b.position
  );
}

export function planStageOptions(
  current: readonly TwentySelectOption[],
  newId: () => string = randomUUID,
): StageOptionsPlan {
  const usedIds = new Set<string>();

  const options = NUERA_STAGES.map((stage, position) => {
    const existing =
      current.find((option) => option.value === stage.value) ??
      current.find((option) => LEGACY_STAGE_MAPPING[option.value] === stage.value);
    if (existing) usedIds.add(existing.id);
    return { id: existing?.id ?? newId(), ...stage, position };
  });

  const orphanValues = current
    .filter((option) => !usedIds.has(option.id))
    .map((option) => option.value);

  const isConform =
    orphanValues.length === 0 &&
    current.length === options.length &&
    options.every((option) =>
      isSameOption(
        current.find((candidate) => candidate.id === option.id),
        option,
      ),
    );

  return { options: isConform ? null : options, orphanValues };
}
