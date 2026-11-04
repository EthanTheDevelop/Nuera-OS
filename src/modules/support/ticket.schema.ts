import {
  TICKET_CATEGORIES,
  TICKET_COVERAGES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/** Un champ de formulaire vide arrive en chaîne vide : il vaut « non renseigné ». */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalId = (message: string) =>
  z.preprocess(blankToNull, z.uuid(message).nullable().optional());

const requiredId = (message: string) => z.uuid(message);

const subject = z
  .string("Indiquez un objet.")
  .trim()
  .min(3, "Indiquez un objet d'au moins 3 caractères.")
  .max(200, "L'objet ne dépasse pas 200 caractères.");

const description = z.preprocess(
  blankToNull,
  z.string().trim().max(10_000, "La description ne dépasse pas 10 000 caractères.").nullable(),
);

const body = z
  .string("Écrivez un message.")
  .trim()
  .min(1, "Écrivez un message.")
  .max(10_000, "Le message ne dépasse pas 10 000 caractères.");

/** Un membre de l'équipe saisit une demande reçue autrement : le portail et la surveillance ont leur propre chemin. */
export const STAFF_TICKET_CHANNELS = ["email", "phone", "internal"] as const;

export const createTicketSchema = z.object({
  companyId: requiredId("Choisissez un client."),
  siteId: optionalId("Site invalide."),
  contractId: optionalId("Contrat invalide."),
  projectId: optionalId("Projet invalide."),
  subject,
  description: description.optional(),
  channel: z.enum(STAFF_TICKET_CHANNELS, "Choisissez un canal."),
  category: z.enum(TICKET_CATEGORIES, "Choisissez une catégorie."),
  severity: z.enum(TICKET_SEVERITIES, "Choisissez une gravité."),
  assigneeMemberId: optionalId("Responsable invalide."),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  subject,
  description: description.optional(),
  siteId: optionalId("Site invalide."),
  contractId: optionalId("Contrat invalide."),
  projectId: optionalId("Projet invalide."),
  category: z.enum(TICKET_CATEGORIES, "Choisissez une catégorie."),
  severity: z.enum(TICKET_SEVERITIES, "Choisissez une gravité."),
  coverage: z.enum(TICKET_COVERAGES, "Choisissez une couverture."),
  /** Échéance convenue, en jour `AAAA-MM-JJ`. Ignorée si le contrat fixe les délais. */
  dueOn: z.preprocess(blankToNull, z.iso.date("Indiquez une date valide.").nullable().optional()),
});
export type UpdateTicketInput = z.input<typeof updateTicketSchema>;

export const transitionTicketSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  toStatus: z.enum(TICKET_STATUSES, "Statut invalide."),
  note: z.preprocess(
    blankToNull,
    z.string().trim().max(2_000, "La note ne dépasse pas 2 000 caractères.").nullable().optional(),
  ),
  /** Attribution faite en même temps qu'une prise en charge. */
  assigneeMemberId: optionalId("Responsable invalide."),
});
export type TransitionTicketInput = z.input<typeof transitionTicketSchema>;

export const assignTicketSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  assigneeMemberId: optionalId("Responsable invalide."),
});
export type AssignTicketInput = z.input<typeof assignTicketSchema>;

export const addTicketMessageSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  body,
  internal: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
});
export type AddTicketMessageInput = z.input<typeof addTicketMessageSchema>;

export const addTicketCommentSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  body,
  mentions: z.array(z.uuid()).max(20).default([]),
  parentId: optionalId("Commentaire invalide."),
});
export type AddTicketCommentInput = z.input<typeof addTicketCommentSchema>;

export const logTicketTimeSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  minutes: z.coerce
    .number("Indiquez une durée.")
    .int("Indiquez une durée en minutes entières.")
    .positive("Indiquez une durée positive.")
    .max(24 * 60, "Une saisie ne dépasse pas 24 h."),
  workOn: z.iso.date("Indiquez une date valide."),
  billable: z.preprocess(
    (value) => value === true || value === "on" || value === "true",
    z.boolean(),
  ),
  note: z.preprocess(
    blankToNull,
    z.string().trim().max(500, "La note ne dépasse pas 500 caractères.").nullable().optional(),
  ),
});
export type LogTicketTimeInput = z.input<typeof logTicketTimeSchema>;

export const CONVERSION_TARGETS = ["change_request", "quote"] as const;
export type ConversionTarget = (typeof CONVERSION_TARGETS)[number];

export const convertTicketSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  target: z.enum(CONVERSION_TARGETS, "Choisissez une transformation."),
});
export type ConvertTicketInput = z.input<typeof convertTicketSchema>;

/** Filtres de l'écran : une valeur inconnue dans l'URL est ignorée, jamais une erreur. */
export const ticketQuerySchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  statut: z.enum(TICKET_STATUSES).optional().catch(undefined),
  gravite: z.enum(TICKET_SEVERITIES).optional().catch(undefined),
  couverture: z.enum(TICKET_COVERAGES).optional().catch(undefined),
  filtre: z
    .enum(["miennes", "sans_responsable", "retard", "critiques", "incidents", "hors_contrat"])
    .optional()
    .catch(undefined),
  client: z.uuid().optional().catch(undefined),
  site: z.uuid().optional().catch(undefined),
  tri: z.enum(["creation", "echeance", "gravite"]).optional().catch(undefined),
  sens: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});
export type TicketQuery = z.output<typeof ticketQuerySchema>;

/** Demande ouverte par un client depuis son espace : ni gravité ni canal à choisir. */
export const createPortalTicketSchema = z.object({
  siteId: optionalId("Site invalide."),
  subject,
  description: description.optional(),
  category: z.enum(TICKET_CATEGORIES, "Choisissez une catégorie.").default("assistance"),
});
export type CreatePortalTicketInput = z.input<typeof createPortalTicketSchema>;

export const addPortalTicketMessageSchema = z.object({
  ticketId: requiredId("Demande invalide."),
  body,
});
export type AddPortalTicketMessageInput = z.input<typeof addPortalTicketMessageSchema>;
