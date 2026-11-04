import { OPPORTUNITY_STAGES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { optionalDay, optionalId, optionalText } from "@/modules/crm/crm.schema";

/** Montant en centimes : les champs monétaires des formulaires envoient déjà cette unité. */
const optionalCents = z
  .union([
    // Dans cet ordre : `Number("")` et `Number(null)` valent 0.
    z.literal(""),
    z.null(),
    z.coerce.number().int("Montant invalide.").min(0, "Le montant ne peut pas être négatif."),
  ])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

const optionalProbability = z
  .union([
    z.literal(""),
    z.null(),
    z.coerce.number().int().min(0, "De 0 à 100.").max(100, "De 0 à 100."),
  ])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

const opportunityFields = {
  companyId: optionalId(),
  contactId: optionalId(),
  amountCents: optionalCents,
  expectedCloseOn: optionalDay(),
  probability: optionalProbability,
  source: optionalText(120),
  need: optionalText(5000),
  budgetEstimateCents: optionalCents,
  ownerMemberId: optionalId(),
  nextAction: optionalText(500),
  nextActionOn: optionalDay(),
};

export const createOpportunitySchema = z.object({
  /** Identifiant fourni par l'appelant : une création se rejoue sans doublon. */
  id: z.guid().optional(),
  name: z.string().trim().min(1, "Le nom de l'affaire est obligatoire.").max(300),
  stage: z.enum(["NEW", "QUALIFIED", "QUOTE_SENT", "NEGOTIATION"]).optional(),
  /** Lead d'une société encore inconnue : la fiche prospect est créée avec l'affaire. */
  newCompanyName: optionalText(200),
  ...opportunityFields,
});
export type CreateOpportunityInput = z.output<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z.object({
  name: z.string().trim().min(1, "Le nom de l'affaire est obligatoire.").max(300).optional(),
  ...opportunityFields,
});
export type UpdateOpportunityInput = z.output<typeof updateOpportunitySchema>;

export const moveOpportunitySchema = z.object({
  opportunityId: z.guid(),
  toStage: z.enum(OPPORTUNITY_STAGES),
  lostReason: optionalText(500),
});

export const opportunityFiltersSchema = z.object({
  responsable: z.guid().optional().catch(undefined),
  origine: z.string().trim().max(120).optional().catch(undefined),
  etape: z.enum(OPPORTUNITY_STAGES).optional().catch(undefined),
  /** Sans activité depuis ce nombre de jours (03.03.03). */
  inactives: z.coerce.number().int().min(1).max(365).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  archivees: z.literal("1").optional().catch(undefined),
  tri: z.enum(["affaire", "montant", "echeance", "action"]).optional().catch(undefined),
  sens: z.enum(["asc", "desc"]).optional().catch(undefined),
});
export type OpportunityFilters = z.output<typeof opportunityFiltersSchema>;

export const nextActionSchema = z.object({
  nextAction: optionalText(500),
  nextActionOn: optionalDay(),
});
