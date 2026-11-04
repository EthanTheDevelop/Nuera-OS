import { IMPORT_FIELDS } from "@/integrations/indy/indy.csv";
import {
  BILLING_PERIODS,
  COST_CATEGORIES,
  COST_NATURES,
  FINANCIAL_DOCUMENT_KINDS,
  FINANCIAL_DOCUMENT_STATUSES,
  SCHEDULE_ITEM_STATUSES,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

const MAX_CENTS = 2_000_000_000;

/** Un champ de formulaire vide vaut « absent ». */
const emptyToNull = (value: unknown) =>
  value === "" || value === undefined || value === null ? null : value;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Saisissez une date valide.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Date impossible.");

/** Une recherche vient de l'URL : trop longue, elle se tronque au lieu de faire tomber l'écran. */
const searchText = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .transform((value) => value.slice(0, 120))
    .nullable(),
);

const optionalDay = z.preprocess(emptyToNull, day.nullable());
const optionalUuid = z.preprocess(emptyToNull, z.uuid("Sélection invalide.").nullable());

/** Case à cocher d'un formulaire (`on`), ou booléen d'un appel direct. */
const checkbox = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

const cents = (message: string) =>
  z.coerce
    .number({ message })
    .int(message)
    .min(0, message)
    .max(MAX_CENTS, "Ce montant est trop élevé.");

export const invoiceInputSchema = z
  .object({
    companyId: z.uuid("Choisissez un client."),
    projectId: optionalUuid,
    contractId: optionalUuid,
    quoteId: optionalUuid,
    scheduleItemId: optionalUuid,
    documentId: optionalUuid,
    kind: z.enum(FINANCIAL_DOCUMENT_KINDS).default("invoice"),
    externalRef: z
      .string()
      .trim()
      .min(1, "Saisissez la référence de la facture dans Indy.")
      .max(120, "Cette référence est trop longue."),
    /** Co-traitance (A12) : chaque facture a son associé émetteur. */
    issuerMemberId: z.uuid("Choisissez l'associé émetteur."),
    issuedOn: day,
    dueOn: optionalDay,
    amountCents: cents("Saisissez un montant HT."),
    taxCents: z.preprocess(
      (value) => emptyToNull(value) ?? 0,
      cents("Saisissez un montant de TVA."),
    ),
    clientVisible: checkbox,
  })
  .refine((input) => input.amountCents > 0, {
    path: ["amountCents"],
    message: "Le montant doit être supérieur à zéro.",
  })
  .refine((input) => !input.dueOn || input.dueOn >= input.issuedOn, {
    path: ["dueOn"],
    message: "L'échéance ne peut pas précéder l'émission.",
  });
export type InvoiceInput = z.output<typeof invoiceInputSchema>;

export const invoiceStatusChangeSchema = z.object({
  to: z.enum(FINANCIAL_DOCUMENT_STATUSES),
  paidOn: optionalDay,
});

export const invoiceVisibilitySchema = z.boolean("Indiquez si la facture est visible.");

export const invoiceListFilterSchema = z.object({
  status: z.preprocess(emptyToNull, z.enum(FINANCIAL_DOCUMENT_STATUSES).nullable()),
  search: searchText,
});

export const scheduleInputSchema = z
  .object({
    companyId: z.uuid("Choisissez un client."),
    projectId: optionalUuid,
    contractId: optionalUuid,
    quoteId: optionalUuid,
    label: z
      .string()
      .trim()
      .min(1, "Saisissez un libellé, par exemple « Acompte 30 % ».")
      .max(160, "Ce libellé est trop long."),
    dueOn: optionalDay,
    amountCents: cents("Saisissez un montant HT."),
  })
  .refine((input) => input.amountCents > 0, {
    path: ["amountCents"],
    message: "Le montant doit être supérieur à zéro.",
  });
export type ScheduleInput = z.output<typeof scheduleInputSchema>;

export const scheduleListFilterSchema = z.object({
  status: z.preprocess(emptyToNull, z.enum(SCHEDULE_ITEM_STATUSES).nullable()),
  search: searchText,
});

export const directCostInputSchema = z
  .object({
    companyId: optionalUuid,
    projectId: optionalUuid,
    siteId: optionalUuid,
    contractId: optionalUuid,
    memberId: optionalUuid,
    label: z.string().trim().min(1, "Saisissez un libellé.").max(160, "Ce libellé est trop long."),
    category: z.enum(COST_CATEGORIES, "Choisissez une catégorie."),
    amountCents: cents("Saisissez un montant HT."),
    incurredOn: day,
    recurringPeriod: z.preprocess(emptyToNull, z.enum(BILLING_PERIODS).nullable()),
    nature: z.enum(COST_NATURES, "Choisissez prévisionnel ou réalisé."),
  })
  .refine((input) => input.amountCents > 0 || input.recurringPeriod !== null, {
    path: ["amountCents"],
    message: "Seul un coût récurrent peut rester à chiffrer : saisissez un montant.",
  })
  .refine((input) => input.companyId || (!input.projectId && !input.siteId && !input.contractId), {
    path: ["companyId"],
    message: "Choisissez le client de ce projet, site ou contrat.",
  });
export type DirectCostInput = z.output<typeof directCostInputSchema>;

export const directCostListFilterSchema = z.object({
  nature: z.preprocess(emptyToNull, z.enum(COST_NATURES).nullable()),
  category: z.preprocess(emptyToNull, z.enum(COST_CATEGORIES).nullable()),
  recurring: z.preprocess(emptyToNull, z.enum(["yes", "no"]).nullable()),
  search: searchText,
});

/** Association champ → colonne d'un import. Une valeur vide laisse le champ de côté. */
export const columnMappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200));

export const marginScopeSchema = z.enum(
  ["project", "client", "site", "contract"],
  "Portée de marge inconnue.",
);

export const marginIdSchema = z.uuid("Identifiant invalide.");

export const marginInputSchema = z.object({
  scope: marginScopeSchema,
  id: marginIdSchema,
  period: z
    .object({ from: day, to: day })
    .refine((period) => period.from <= period.to, "La période est inversée.")
    .optional(),
});
