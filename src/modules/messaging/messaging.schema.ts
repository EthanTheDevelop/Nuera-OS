import { COMMENT_ENTITY_TYPES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";

export const MESSAGE_MAX_LENGTH = 10_000;
export const COMMENT_MAX_LENGTH = 10_000;

const uuid = z.uuid();

/** Une valeur de formulaire vide vaut « absente ». */
const optionalUuid = z.preprocess((value) => (value === "" ? undefined : value), uuid.optional());

const mentions = z.array(uuid).max(20).default([]);

export const INBOX_FILTERS = ["clients", "prospects", "pretes", "archivees"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Lecture tolérante de l'URL : un filtre inconnu vaut « Tous », une URL trafiquée n'est pas une erreur. */
export function parseInboxFilter(value: string | undefined): InboxFilter | undefined {
  return INBOX_FILTERS.find((filter) => filter === value);
}

export const sendMessageSchema = z
  .object({
    conversationId: uuid,
    body: z.string().trim().max(MESSAGE_MAX_LENGTH).default(""),
    /** `outbound` : visible du client. `internal` : note de l'équipe, jamais visible du client. */
    direction: z.enum(["outbound", "internal"]).default("outbound"),
    mentions,
    documentId: optionalUuid,
    /** Identifiant généré par le navigateur : un double envoi ne crée qu'un message. */
    clientRequestId: optionalUuid,
  })
  .refine((value) => value.body !== "" || value.documentId, {
    path: ["body"],
    message: "Écrivez un message ou joignez un fichier.",
  });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const portalMessageSchema = z
  .object({
    body: z.string().trim().max(MESSAGE_MAX_LENGTH).default(""),
    documentId: optionalUuid,
    clientRequestId: optionalUuid,
  })
  .refine((value) => value.body !== "" || value.documentId, {
    path: ["body"],
    message: "Écrivez un message ou joignez un fichier.",
  });
export type PortalMessageInput = z.input<typeof portalMessageSchema>;

export const createConversationSchema = z
  .object({
    companyId: uuid,
    contactId: optionalUuid,
    projectId: optionalUuid,
    subject: z.string().trim().max(200).optional(),
    firstMessage: z.string().trim().max(MESSAGE_MAX_LENGTH).optional(),
    /** `inbound` : message reçu hors de l'espace client (appel, e-mail), consigné par l'équipe. */
    firstDirection: z.enum(["outbound", "inbound", "internal"]).default("outbound"),
    clientRequestId: optionalUuid,
  })
  .refine((value) => value.firstDirection !== "inbound" || value.contactId, {
    path: ["contactId"],
    message: "Choisissez le contact qui a écrit.",
  });
export type CreateConversationInput = z.input<typeof createConversationSchema>;

export const SUGGESTION_MODES = ["initial", "rephrase", "shorter"] as const;
export type SuggestionMode = (typeof SUGGESTION_MODES)[number];

export const requestSuggestionSchema = z.object({
  conversationId: uuid,
  mode: z.enum(SUGGESTION_MODES).default("initial"),
});

export const suggestionSettingsSchema = z.object({
  enabled: z.boolean(),
  readProjectContext: z.boolean(),
});
export type SuggestionSettings = z.output<typeof suggestionSettingsSchema>;

export const addCommentSchema = z.object({
  entityType: z.enum(COMMENT_ENTITY_TYPES),
  entityId: uuid,
  companyId: uuid,
  body: z.string().trim().min(1, "Écrivez un commentaire.").max(COMMENT_MAX_LENGTH),
  mentions,
  parentId: optionalUuid,
  documentId: optionalUuid,
  // `//hôte` et `/\hôte` sortent de l'application : un navigateur les lit comme une autre origine.
  href: z.string().regex(/^\/(?![/\\])/, "Lien interne attendu."),
  clientRequestId: optionalUuid,
});

export const commentTargetSchema = z.object({
  entityType: z.enum(COMMENT_ENTITY_TYPES),
  entityId: uuid,
});
