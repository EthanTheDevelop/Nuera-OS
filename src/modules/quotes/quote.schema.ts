import { z } from "@/lib/zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max, `${max} caractères au maximum.`).nullable().optional(),
  );

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid("Identifiant invalide.").nullable().optional(),
);

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const optionalDay = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().refine(isCalendarDay, "Saisissez une date valide.").nullable().optional(),
);

const percent = (message: string) =>
  z.coerce.number({ error: message }).int(message).min(0, message).max(100, message);

export const createQuoteSchema = z.object({
  companyId: z.uuid("Choisissez un client."),
  opportunityId: optionalUuid,
  title: z.string({ error: "Nommez l'offre." }).trim().min(1, "Nommez l'offre.").max(200),
});
export type CreateQuoteInput = z.output<typeof createQuoteSchema>;

export const createAmendmentSchema = z.object({
  title: z.string({ error: "Nommez l'avenant." }).trim().min(1, "Nommez l'avenant.").max(200),
  /** Demande supplémentaire acceptée (domaine 04.04.02) dont l'avenant reprend le chiffrage. */
  changeRequestId: optionalUuid,
});

export const quoteLineInputSchema = z.object({
  catalogItemId: optionalUuid,
  label: z.string({ error: "Nommez la ligne." }).trim().min(1, "Nommez la ligne.").max(200),
  unitLabel: optionalText(30),
  quantity: z.coerce
    .number({ error: "Quantité invalide." })
    .int("La quantité doit être un nombre entier.")
    .min(1, "La quantité doit être d'au moins 1.")
    .max(10_000, "Quantité trop élevée."),
  unitPriceCents: z.coerce
    .number({ error: "Prix invalide." })
    .int("Prix invalide.")
    .min(0, "Le prix ne peut pas être négatif.")
    .max(100_000_000, "Prix trop élevé."),
  estimatedCostCents: z.coerce
    .number({ error: "Coût invalide." })
    .int("Coût invalide.")
    .min(0, "Le coût ne peut pas être négatif.")
    .max(100_000_000, "Coût trop élevé."),
  estimatedMinutes: z.coerce
    .number({ error: "Durée invalide." })
    .int("Durée invalide.")
    .min(0, "La durée ne peut pas être négative.")
    .max(1_000_000, "Durée trop élevée."),
});
export type QuoteLineInput = z.output<typeof quoteLineInputSchema>;

/** Contenu de l'éditeur. Les totaux n'en font pas partie : le serveur les recalcule. */
export const quoteContentSchema = z.object({
  title: z.string({ error: "Nommez l'offre." }).trim().min(1, "Nommez l'offre.").max(200),
  issuedByNote: optionalText(300),
  scope: optionalText(5000),
  exclusions: optionalText(5000),
  conditions: optionalText(5000),
  validUntil: optionalDay,
  depositPercent: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? 0 : value),
    percent("Saisissez un acompte entre 0 et 100 %."),
  ),
  taxPercent: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? 20 : value),
    percent("Saisissez un taux de TVA entre 0 et 100 %."),
  ),
  changeNote: optionalText(500),
  lines: z.array(quoteLineInputSchema).max(100, "100 lignes au maximum."),
});
export type QuoteContentInput = z.output<typeof quoteContentSchema>;

export const QUOTE_LIST_FILTERS = ["brouillons", "envoyes", "signes", "refuses"] as const;
export type QuoteListFilter = (typeof QUOTE_LIST_FILTERS)[number];

export const quoteListSchema = z.object({
  // Vient de l'URL : une valeur trop longue est coupée, elle ne doit pas casser la page.
  search: z
    .string()
    .trim()
    .transform((value) => value.slice(0, 200))
    .optional(),
  filter: z.enum(QUOTE_LIST_FILTERS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).catch(20),
});
export type QuoteListInput = z.input<typeof quoteListSchema>;

export const sendForSignatureSchema = z.object({
  signerContactId: z.uuid("Choisissez la personne qui signe."),
});

const httpUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .url({ protocol: /^https?$/, error: "Saisissez une adresse http ou https." })
    .max(1000)
    .nullable()
    .optional(),
);

/** Références externes : Nuera OS ne produit pas le document légal, il le désigne. */
export const quoteReferencesSchema = z.object({
  indyReference: optionalText(200),
  officialDocumentUrl: httpUrl,
});

/** Acceptation hors DocuSeal : le document signé doit être désigné, sinon rien ne la prouve. */
export const manualAcceptanceSchema = z
  .object({
    indyReference: optionalText(200),
    officialDocumentUrl: httpUrl,
    signedOn: z
      .string({ error: "Indiquez la date de signature." })
      .refine(isCalendarDay, "Indiquez la date de signature."),
    note: optionalText(500),
  })
  .superRefine((value, context) => {
    if (!value.indyReference && !value.officialDocumentUrl) {
      context.addIssue({
        code: "custom",
        path: ["indyReference"],
        message: "Indiquez la référence du document signé, ou son adresse.",
      });
    }
  });

export const refusalSchema = z.object({
  reason: z
    .string({ error: "Indiquez le motif du refus." })
    .trim()
    .min(1, "Indiquez le motif du refus.")
    .max(500),
});
