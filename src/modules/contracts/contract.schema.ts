import {
  BILLING_PERIODS,
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  SIGNATURE_STATUSES,
  TICKET_CATEGORIES,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/** Une entrée de formulaire arrive en texte : une chaîne vide ou un champ absent vaut « non renseigné ». */
function blankToNull(value: unknown): unknown {
  if (value === undefined) return null;
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const MAX_INT = 2_000_000_000;

const nullableInt = (message: string) =>
  z.preprocess(
    blankToNull,
    z.coerce
      .number({ error: message })
      .int(message)
      .min(0, message)
      .max(MAX_INT, message)
      .nullable(),
  );

const requiredInt = (message: string) =>
  z.preprocess(
    (value) => blankToNull(value) ?? undefined,
    z.coerce.number({ error: message }).int(message).min(0, message).max(MAX_INT, message),
  );

const nullableHours = z.preprocess(
  blankToNull,
  z.coerce
    .number({ error: "Saisissez un nombre d'heures." })
    .int("Saisissez un nombre d'heures entier.")
    .min(0, "Saisissez un nombre d'heures positif.")
    .max(8760, "Saisissez au plus 8 760 heures.")
    .nullable(),
);

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const calendarDay = z
  .string({ error: "Saisissez une date." })
  .refine(isCalendarDay, { error: "Saisissez une date valide." });

const nullableDay = z.preprocess(blankToNull, calendarDay.nullable());

const nullableText = (max: number) =>
  z.preprocess(
    (value) => blankToNull(typeof value === "string" ? value.trim() : value),
    z.string().max(max, `${max} caractères au plus.`).nullable(),
  );

const nullableUuid = (message: string) =>
  z.preprocess(blankToNull, z.uuid({ error: message }).nullable());

/** Une case cochée envoie « on » ; décochée, rien. Un service peut passer un vrai booléen. */
const checkbox = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

const contractFields = {
  planId: nullableUuid("Formule inconnue."),
  quoteId: nullableUuid("Devis inconnu."),
  name: z
    .string({ error: "Donnez un nom au contrat." })
    .trim()
    .min(1, "Donnez un nom au contrat.")
    .max(200, "200 caractères au plus."),
  kind: z.enum(CONTRACT_KINDS, { error: "Choisissez un type de contrat." }),
  startOn: nullableDay,
  endOn: nullableDay,
  renewsOn: nullableDay,
  autoRenew: checkbox,
  period: z.enum(BILLING_PERIODS, { error: "Choisissez une périodicité." }),
  monthlyCostCents: nullableInt("Saisissez un coût valide."),
  includedMinutes: nullableInt("Saisissez une durée valide."),
  includedTickets: nullableInt("Saisissez un nombre de demandes valide."),
  scope: nullableText(5000),
  exclusions: nullableText(5000),
  conditions: nullableText(5000),
  responseHours: nullableHours,
  resolutionHours: nullableHours,
};

function checkDates(
  value: { startOn: string | null; endOn: string | null; renewsOn: string | null },
  context: z.RefinementCtx,
) {
  if (value.startOn && value.endOn && value.endOn < value.startOn) {
    context.addIssue({
      code: "custom",
      path: ["endOn"],
      message: "La fin doit suivre le début.",
    });
  }
  if (value.startOn && value.renewsOn && value.renewsOn < value.startOn) {
    context.addIssue({
      code: "custom",
      path: ["renewsOn"],
      message: "Le renouvellement doit suivre le début.",
    });
  }
  // Une date de renouvellement au-delà de la fin masquerait la fin : ni alerte ni expiration à temps.
  if (value.endOn && value.renewsOn && value.renewsOn > value.endOn) {
    context.addIssue({
      code: "custom",
      path: ["renewsOn"],
      message: "Le renouvellement ne peut pas suivre la fin du contrat.",
    });
  }
}

export const createContractSchema = z
  .object({
    companyId: z.uuid({ error: "Choisissez un client." }),
    priceCents: requiredInt("Saisissez un prix valide."),
    ...contractFields,
  })
  .superRefine(checkDates);
export type CreateContractInput = z.output<typeof createContractSchema>;

/** Le client ne change pas (clés composites), et le prix passe par la révision de tarif. */
export const updateContractSchema = z.object(contractFields).superRefine(checkDates);
export type UpdateContractInput = z.output<typeof updateContractSchema>;

export const changePriceSchema = z.object({
  priceCents: requiredInt("Saisissez un prix valide."),
  period: z.enum(BILLING_PERIODS, { error: "Choisissez une périodicité." }),
  note: nullableText(1000),
});

export const renewContractSchema = z.object({
  /** Échéance vue à l'écran : un second envoi après renouvellement ne renouvelle pas deux fois. */
  expectedNextOn: nullableDay,
  newRenewsOn: nullableDay,
  note: nullableText(1000),
});

export const CONTRACT_STATUS_TARGETS = ["active", "to_review", "suspended", "expired"] as const;

export const changeStatusSchema = z.object({
  status: z.enum(CONTRACT_STATUS_TARGETS, { error: "État inconnu." }),
  note: nullableText(1000),
});

export const terminateContractSchema = z.object({
  note: z
    .string({ error: "Indiquez le motif de la résiliation." })
    .trim()
    .min(1, "Indiquez le motif de la résiliation.")
    .max(1000, "1 000 caractères au plus."),
  transfers: nullableText(1000),
  effectiveOn: nullableDay,
});

export const contractNoteSchema = z.object({
  note: z
    .string({ error: "Écrivez une note." })
    .trim()
    .min(1, "Écrivez une note.")
    .max(2000, "2 000 caractères au plus."),
});

export const signatureSchema = z.object({
  status: z.enum(SIGNATURE_STATUSES, { error: "État de signature inconnu." }),
});

export const siteLinkSchema = z.object({
  siteId: z.uuid({ error: "Choisissez un site." }),
});

export const planSchema = z.object({
  name: z
    .string({ error: "Donnez un nom à la formule." })
    .trim()
    .min(1, "Donnez un nom à la formule.")
    .max(120, "120 caractères au plus."),
  description: nullableText(1000),
  priceCents: requiredInt("Saisissez un prix valide."),
  period: z.enum(BILLING_PERIODS, { error: "Choisissez une périodicité." }),
  includedMinutes: nullableInt("Saisissez une durée valide."),
  includedTickets: nullableInt("Saisissez un nombre de demandes valide."),
  scope: nullableText(5000),
  exclusions: nullableText(5000),
  responseHours: nullableHours,
  resolutionHours: nullableHours,
});
export type PlanInput = z.output<typeof planSchema>;

const interventionFields = {
  title: z
    .string({ error: "Donnez un titre à l'intervention." })
    .trim()
    .min(1, "Donnez un titre à l'intervention.")
    .max(200, "200 caractères au plus."),
  siteId: nullableUuid("Site inconnu."),
  memberId: nullableUuid("Intervenant inconnu."),
  plannedOn: nullableDay,
  minutes: nullableInt("Saisissez une durée valide."),
};

export const createInterventionSchema = z
  .object({
    ...interventionFields,
    doneOn: nullableDay,
    result: nullableText(2000),
  })
  .superRefine((value, context) => {
    if (!value.plannedOn && !value.doneOn) {
      context.addIssue({
        code: "custom",
        path: ["plannedOn"],
        message: "Indiquez une date prévue ou une date de réalisation.",
      });
    }
  });

export const updateInterventionSchema = z.object(interventionFields);

export const completeInterventionSchema = z.object({
  doneOn: calendarDay,
  minutes: requiredInt("Saisissez la durée passée."),
  result: nullableText(2000),
});

export const overageSchema = z.object({
  title: z
    .string({ error: "Décrivez le travail en quelques mots." })
    .trim()
    .min(1, "Décrivez le travail en quelques mots.")
    .max(200, "200 caractères au plus."),
  description: nullableText(5000),
  estimatedMinutes: nullableInt("Saisissez une durée valide."),
  amountCents: nullableInt("Saisissez un montant valide."),
  withQuote: checkbox,
});

export const CONTRACT_LIST_FILTERS = [
  "open",
  "all",
  "active",
  "to_review",
  "to_start",
  "suspended",
  "ended",
] as const;
export type ContractListFilter = (typeof CONTRACT_LIST_FILTERS)[number];

export const CONTRACT_SORT_KEYS = ["contract", "price", "deadline"] as const;
export type ContractSortKey = (typeof CONTRACT_SORT_KEYS)[number];

export const listContractsSchema = z.object({
  filter: z.enum(CONTRACT_LIST_FILTERS).catch("open"),
  kind: z.enum(CONTRACT_KINDS).nullable().catch(null),
  search: z.string().trim().max(200).catch(""),
  sort: z.enum(CONTRACT_SORT_KEYS).catch("deadline"),
  direction: z.enum(["asc", "desc"]).catch("asc"),
});

export const coverageInputSchema = z.object({
  companyId: z.uuid(),
  siteId: z.uuid().nullish(),
  contractId: z.uuid().nullish(),
  category: z.enum(TICKET_CATEGORIES),
});

export const consumeQuotaSchema = z.object({
  contractId: z.uuid(),
  minutes: z.number().int().min(0).max(MAX_INT),
  ticketId: z.uuid().nullable(),
});

export { CONTRACT_STATUSES };
