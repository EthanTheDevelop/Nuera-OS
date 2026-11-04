import {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  KNOWLEDGE_KINDS,
  OFFER_ACTIVITIES,
  TEMPLATE_KINDS,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/** Une chaîne vide de formulaire vaut « rien » : `null` pour les liens et champs facultatifs. */
function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const uuid = z.uuid("Identifiant invalide.");
const optionalUuid = z.preprocess(emptyToNull, uuid.nullish());

const title = z
  .string()
  .trim()
  .min(2, "Le titre doit comporter au moins 2 caractères.")
  .max(200, "Le titre ne peut pas dépasser 200 caractères.");

export const documentLinksSchema = z.object({
  companyId: optionalUuid,
  projectId: optionalUuid,
  contractId: optionalUuid,
  siteId: optionalUuid,
  ticketId: optionalUuid,
  quoteId: optionalUuid,
});

const kind = z.enum(DOCUMENT_KINDS, { error: "Type de document invalide." });
const visibility = z.enum(DOCUMENT_VISIBILITIES, { error: "Partage invalide." });
const status = z.enum(DOCUMENT_STATUSES, { error: "Statut invalide." });
const note = z.preprocess(emptyToNull, z.string().trim().max(500).nullish());

export const uploadDocumentSchema = documentLinksSchema.extend({
  title,
  kind: kind.default("other"),
  visibility: visibility.default("internal"),
  status: status.default("final"),
  note,
  filename: z.string().trim().min(1, "Le nom du fichier est manquant.").max(400),
});
export type UploadDocumentInput = z.input<typeof uploadDocumentSchema>;

export const attachDocumentSchema = documentLinksSchema.extend({
  title,
  kind,
  visibility: visibility.default("internal"),
  status: status.default("final"),
  note,
  file: z.object({
    storageKey: z.string().min(1).max(300),
    filename: z.string().trim().min(1).max(400),
    mimeType: z.string().min(1).max(200),
    sizeBytes: z.number().int().min(0),
    sha256: z.string().min(1).max(64),
  }),
});

export const uploadVersionSchema = z.object({
  documentId: uuid,
  filename: z.string().trim().min(1, "Le nom du fichier est manquant.").max(400),
  note,
});
export type UploadVersionInput = z.input<typeof uploadVersionSchema>;

export const uploadClientFileSchema = z.object({
  title: z.preprocess(emptyToNull, title.nullish()),
  filename: z.string().trim().min(1, "Le nom du fichier est manquant.").max(400),
  projectId: optionalUuid,
  ticketId: optionalUuid,
  note,
});
export type UploadClientFileInput = z.input<typeof uploadClientFileSchema>;

export const updateDocumentSchema = documentLinksSchema.extend({
  id: uuid,
  title,
  kind,
});
export type UpdateDocumentInput = z.input<typeof updateDocumentSchema>;

export const documentVisibilitySchema = z.object({ id: uuid, visibility });
export const documentStatusSchema = z.object({ id: uuid, status });
export const documentReferenceSchema = z.object({ id: uuid, versionId: uuid });
export const documentIdSchema = z.object({ id: uuid });

const searchText = z.preprocess(emptyToNull, z.string().trim().max(200).nullish());

export const documentFilterSchema = documentLinksSchema.extend({
  search: searchText,
  kind: z.preprocess(emptyToNull, kind.nullish()),
  visibility: z.preprocess(emptyToNull, visibility.nullish()),
  archived: z.boolean().default(false),
});
export type DocumentFilterInput = z.input<typeof documentFilterSchema>;

export const documentsForSchema = z.object({
  companyId: optionalUuid,
  projectId: optionalUuid,
  contractId: optionalUuid,
  siteId: optionalUuid,
  ticketId: optionalUuid,
  quoteId: optionalUuid,
  limit: z.number().int().min(1).max(200).optional(),
});
export type DocumentsForInput = z.input<typeof documentsForSchema>;

export const portalDocumentFilterSchema = z.object({
  kinds: z.array(kind).max(DOCUMENT_KINDS.length).optional(),
  uploadedByClient: z.boolean().optional(),
  projectId: optionalUuid,
  ticketId: optionalUuid,
});
export type PortalDocumentFilterInput = z.input<typeof portalDocumentFilterSchema>;

// --- Base de connaissances ---------------------------------------------------------------------

const articleTitle = title;
const articleBody = z
  .string()
  .trim()
  .min(1, "Rédigez le contenu de l'article.")
  .max(50_000, "L'article ne peut pas dépasser 50 000 caractères.");

export const createArticleSchema = z.object({
  kind: z.enum(KNOWLEDGE_KINDS, { error: "Type d'article invalide." }),
  title: articleTitle,
  body: articleBody,
  siteId: optionalUuid,
  projectId: optionalUuid,
});
export type CreateArticleInput = z.input<typeof createArticleSchema>;

export const updateArticleSchema = createArticleSchema.extend({
  id: uuid,
  /** Version lue par l'auteur : une modification concurrente est refusée, pas écrasée. */
  expectedVersion: z.coerce.number().int().min(1),
});
export type UpdateArticleInput = z.input<typeof updateArticleSchema>;

export const restoreArticleVersionSchema = z.object({
  id: uuid,
  version: z.coerce.number().int().min(1),
});
export const articleIdSchema = z.object({ id: uuid });

export const articleFilterSchema = z.object({
  search: searchText,
  kind: z.preprocess(emptyToNull, z.enum(KNOWLEDGE_KINDS).nullish()),
  siteId: z.preprocess(emptyToNull, z.uuid().nullish()),
  projectId: z.preprocess(emptyToNull, z.uuid().nullish()),
  archived: z.boolean().default(false),
});
export type ArticleFilterInput = z.input<typeof articleFilterSchema>;

// --- Modèles -----------------------------------------------------------------------------------

/** Une ligne de formulaire par élément, ou un tableau d'un autre service. */
const templateItems = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : value,
  z
    .array(z.string().trim().min(1).max(300, "Un élément ne peut pas dépasser 300 caractères."))
    .max(200, "Un modèle ne peut pas dépasser 200 éléments.")
    .default([]),
);

const templateFields = z.object({
  kind: z.enum(TEMPLATE_KINDS, { error: "Type de modèle invalide." }),
  activity: z.preprocess(emptyToNull, z.enum(OFFER_ACTIVITIES).nullish()),
  name: z
    .string()
    .trim()
    .min(2, "Le nom doit comporter au moins 2 caractères.")
    .max(160, "Le nom ne peut pas dépasser 160 caractères."),
  body: z.preprocess(
    emptyToNull,
    z.string().trim().max(20_000, "Le texte ne peut pas dépasser 20 000 caractères.").nullish(),
  ),
  items: templateItems,
});

/** Une checklist ou un plan se compose d'éléments, un brief ou un message d'un texte. */
function requireContent(
  value: { kind: string; body?: string | null; items: string[] },
  context: z.RefinementCtx,
) {
  const structured = value.kind === "checklist" || value.kind === "project_plan";
  if (structured && value.items.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Ajoutez au moins un élément, un par ligne.",
    });
  }
  if (!structured && !value.body) {
    context.addIssue({ code: "custom", path: ["body"], message: "Rédigez le texte du modèle." });
  }
}

export const createTemplateSchema = templateFields.superRefine(requireContent);
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

export const updateTemplateSchema = templateFields.extend({ id: uuid }).superRefine(requireContent);
export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;

export const templateActiveSchema = z.object({ id: uuid, active: z.boolean() });
export const templateIdSchema = z.object({ id: uuid });

export const templateFilterSchema = z.object({
  search: searchText,
  kinds: z.array(z.enum(TEMPLATE_KINDS)).optional(),
  activity: z.preprocess(emptyToNull, z.enum(OFFER_ACTIVITIES).nullish()),
  active: z.boolean().default(true),
});
export type TemplateFilterInput = z.input<typeof templateFilterSchema>;
