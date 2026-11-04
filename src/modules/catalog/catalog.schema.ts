import { CATALOG_ITEM_KINDS, OFFER_ACTIVITIES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/** Une chaîne vide de formulaire vaut « absent ». */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max, `${max} caractères au maximum.`).nullable().optional(),
  );

const requiredInt = (message: string, max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.coerce.number({ error: message }).int(message).min(0, message).max(max, message),
  );

const optionalInt = (message: string, max: number) =>
  z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce
      .number({ error: message })
      .int(message)
      .min(0, message)
      .max(max, message)
      .nullable()
      .optional(),
  );

export const catalogItemInputSchema = z.object({
  kind: z.enum(CATALOG_ITEM_KINDS, { error: "Choisissez un type." }),
  activity: z.enum(OFFER_ACTIVITIES, { error: "Choisissez une activité." }),
  name: z
    .string({ error: "Le nom est obligatoire." })
    .trim()
    .min(1, "Le nom est obligatoire.")
    .max(200),
  description: optionalText(2000),
  priceCents: requiredInt("Saisissez un prix.", 100_000_000),
  estimatedCostCents: requiredInt("Saisissez un coût estimé.", 100_000_000),
  estimatedMinutes: requiredInt("Saisissez une durée estimée.", 1_000_000),
  scope: optionalText(5000),
  exclusions: optionalText(5000),
  conditions: optionalText(5000),
  validityDays: optionalInt("Saisissez un nombre de jours.", 3650),
  depositPercent: z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce
      .number({ error: "Saisissez un pourcentage entre 0 et 100." })
      .int("Saisissez un pourcentage entre 0 et 100.")
      .min(0, "Saisissez un pourcentage entre 0 et 100.")
      .max(100, "Saisissez un pourcentage entre 0 et 100.")
      .nullable()
      .optional(),
  ),
});
export type CatalogItemInput = z.output<typeof catalogItemInputSchema>;

export const catalogListSchema = z.object({
  // Vient de l'URL : une valeur trop longue est coupée, elle ne doit pas casser la page.
  search: z
    .string()
    .trim()
    .transform((value) => value.slice(0, 200))
    .optional(),
  kind: z.enum(CATALOG_ITEM_KINDS).optional().catch(undefined),
  /** `active` par défaut ; `inactive` : les prestations retirées de la vente. */
  state: z.enum(["active", "inactive", "all"]).default("active").catch("active"),
  page: z.coerce.number().int().min(1).default(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25).catch(25),
});
export type CatalogListInput = z.input<typeof catalogListSchema>;
