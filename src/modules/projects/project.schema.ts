import {
  CHANGE_REQUEST_STATUSES,
  OFFER_ACTIVITIES,
  PHASE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  REVIEW_DECISIONS,
  TASK_STATUSES,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/**
 * Entrées du domaine Projets. Les formulaires envoient des chaînes : un champ vide vaut `null`,
 * les montants arrivent en centimes et les durées en minutes (`MoneyField`, `DurationField`).
 */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const uuid = z.uuid("Identifiant invalide.");
const optionalUuid = z.preprocess(emptyToNull, uuid.nullable().optional());
const optionalDay = z.preprocess(
  emptyToNull,
  z.iso.date("Saisissez une date valide.").nullable().optional(),
);
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
const optionalCount = (max = 2_000_000_000) =>
  z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(max).nullable().optional());

const title = (label: string) =>
  z
    .string({ error: `${label} est obligatoire.` })
    .trim()
    .min(1, `${label} est obligatoire.`)
    .max(200);

const checkbox = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

export const entityIdSchema = uuid;

export const companyRowsSchema = z.object({
  companyId: uuid,
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const calendarRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });

export const createProjectFromQuoteSchema = z.object({
  quoteId: uuid,
  opportunityId: uuid.nullable(),
  companyId: uuid,
  versionId: uuid,
});

export const createProjectSchema = z.object({
  companyId: z.uuid("Choisissez un client."),
  name: title("Le nom du projet"),
  activity: z.preprocess(emptyToNull, z.enum(OFFER_ACTIVITIES).nullable().optional()),
  objective: optionalText(2000),
  scope: optionalText(4000),
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITIES).default("normal")),
  ownerMemberId: optionalUuid,
  startOn: optionalDay,
  dueOn: optionalDay,
  budgetCents: optionalCount(),
  estimatedMinutes: optionalCount(),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  projectId: uuid,
  name: title("Le nom du projet"),
  activity: z.preprocess(emptyToNull, z.enum(OFFER_ACTIVITIES).nullable().optional()),
  objective: optionalText(2000),
  scope: optionalText(4000),
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITIES).default("normal")),
  ownerMemberId: optionalUuid,
  startOn: optionalDay,
  dueOn: optionalDay,
  budgetCents: optionalCount(),
  estimatedMinutes: optionalCount(),
});
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const changeProjectStatusSchema = z.object({
  projectId: uuid,
  status: z.enum(PROJECT_STATUSES),
});

export const goLiveSchema = z.object({
  projectId: uuid,
  siteId: optionalUuid,
});
export type GoLiveInput = z.input<typeof goLiveSchema>;

export const projectListSchema = z.object({
  view: z.enum(["active", "upcoming", "delivered", "late", "archived"]).default("active"),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProjectListInput = z.input<typeof projectListSchema>;
export type ProjectListView = z.output<typeof projectListSchema>["view"];

export const projectMemberSchema = z.object({
  projectId: uuid,
  memberId: uuid,
  role: optionalText(120),
});

export const removeProjectMemberSchema = z.object({ projectId: uuid, memberId: uuid });

// --- Jalons ------------------------------------------------------------------------------------

export const createPhaseSchema = z.object({
  projectId: uuid,
  name: title("Le nom du jalon"),
  dueOn: optionalDay,
  clientVisible: checkbox,
});

export const updatePhaseSchema = z.object({
  phaseId: uuid,
  name: title("Le nom du jalon"),
  dueOn: optionalDay,
  clientVisible: checkbox,
});

export const changePhaseStatusSchema = z.object({
  phaseId: uuid,
  status: z.enum(PHASE_STATUSES),
});

// --- Tâches ------------------------------------------------------------------------------------

export const taskListSchema = z.object({
  projectId: uuid,
  status: z.preprocess(emptyToUndefined, z.enum(TASK_STATUSES).optional()),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TaskListInput = z.input<typeof taskListSchema>;

export const createTaskSchema = z.object({
  projectId: uuid,
  title: title("Le titre de la tâche"),
  description: optionalText(8000),
  phaseId: optionalUuid,
  parentTaskId: optionalUuid,
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITIES).default("normal")),
  assigneeMemberId: optionalUuid,
  dueOn: optionalDay,
  estimatedMinutes: optionalCount(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/** Seuls les champs présents changent. */
export const updateTaskSchema = z.object({
  taskId: uuid,
  title: title("Le titre de la tâche").optional(),
  description: optionalText(8000),
  phaseId: optionalUuid,
  priority: z.preprocess(emptyToUndefined, z.enum(PRIORITIES).optional()),
  assigneeMemberId: optionalUuid,
  dueOn: optionalDay,
  estimatedMinutes: optionalCount(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const changeTaskStatusSchema = z.object({ taskId: uuid, status: z.enum(TASK_STATUSES) });

export const taskDependencySchema = z.object({ taskId: uuid, dependsOnTaskId: uuid });

export const taskCommentSchema = z.object({
  taskId: uuid,
  body: z.string().trim().min(1, "Écrivez un commentaire.").max(8000),
  mentions: z.array(uuid).max(50).default([]),
  documentId: optionalUuid,
  parentId: optionalUuid,
  /** Généré par le navigateur : un double envoi ne crée qu'un commentaire. */
  clientRequestId: optionalUuid,
});
export type TaskCommentInput = z.input<typeof taskCommentSchema>;

// --- Livrables ---------------------------------------------------------------------------------

export const createDeliverableSchema = z.object({
  projectId: uuid,
  title: title("Le titre du livrable"),
  phaseId: optionalUuid,
  documentId: optionalUuid,
  requiresClientValidation: checkbox,
  feedbackRoundsIncluded: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(50).default(0),
  ),
});

export const updateDeliverableSchema = z.object({
  deliverableId: uuid,
  title: title("Le titre du livrable"),
  phaseId: optionalUuid,
  documentId: optionalUuid,
  requiresClientValidation: checkbox,
  feedbackRoundsIncluded: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(50).default(0),
  ),
});

export const submitDeliverableSchema = z.object({
  deliverableId: uuid,
  documentId: optionalUuid,
});
export type SubmitDeliverableInput = z.input<typeof submitDeliverableSchema>;

export const newDeliverableVersionSchema = z.object({
  deliverableId: uuid,
  documentId: optionalUuid,
});

export const deliverableReviewSchema = z.object({
  deliverableId: uuid,
  decision: z.enum(REVIEW_DECISIONS),
  comment: optionalText(4000),
});
export type DeliverableReviewInput = z.input<typeof deliverableReviewSchema>;

// --- Contenus attendus -------------------------------------------------------------------------

export const createRequirementSchema = z.object({
  projectId: uuid,
  label: title("Le contenu attendu"),
  dueOn: optionalDay,
});

export const updateRequirementSchema = z.object({
  requirementId: uuid,
  label: title("Le contenu attendu"),
  dueOn: optionalDay,
});

export const markRequirementReceivedSchema = z.object({
  requirementId: uuid,
  documentId: optionalUuid,
});
export type MarkRequirementReceivedInput = z.input<typeof markRequirementReceivedSchema>;

export const reopenRequirementSchema = z.object({ requirementId: uuid });

// --- Blocages ----------------------------------------------------------------------------------

export const raiseBlockerSchema = z.object({
  projectId: uuid,
  title: title("Le blocage"),
  consequence: optionalText(4000),
  decision: optionalText(4000),
});

export const updateBlockerSchema = z.object({
  blockerId: uuid,
  title: title("Le blocage"),
  consequence: optionalText(4000),
  decision: optionalText(4000),
});

export const resolveBlockerSchema = z.object({ blockerId: uuid });

// --- Demandes de changement --------------------------------------------------------------------

export const createChangeRequestSchema = z
  .object({
    projectId: optionalUuid,
    companyId: optionalUuid,
    ticketId: optionalUuid,
    title: title("La demande"),
    description: optionalText(8000),
    estimatedMinutes: optionalCount(),
    amountCents: optionalCount(),
  })
  .refine((value) => value.projectId || value.companyId, {
    error: "Une demande de changement est rattachée à un projet ou à un client.",
  });
export type CreateChangeRequestInput = z.input<typeof createChangeRequestSchema>;

export const updateChangeRequestSchema = z.object({
  changeRequestId: uuid,
  title: title("La demande"),
  description: optionalText(8000),
  estimatedMinutes: optionalCount(),
  amountCents: optionalCount(),
});

export const changeRequestDecisionSchema = z.object({ changeRequestId: uuid });

export const convertChangeRequestSchema = z.object({ changeRequestId: uuid });

export const changeRequestListSchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(CHANGE_REQUEST_STATUSES).optional()),
});

// --- Passation ---------------------------------------------------------------------------------

export const addHandoverItemSchema = z.object({
  projectId: uuid,
  label: title("Le point de passation"),
});

export const toggleHandoverItemSchema = z.object({
  itemId: uuid,
  done: z.boolean(),
});
