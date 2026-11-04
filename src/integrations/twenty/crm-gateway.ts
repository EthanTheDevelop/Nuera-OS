/**
 * Port CRM de Nuera OS.
 *
 * Twenty est le système de référence des entreprises, personnes, opportunités et activités ;
 * les services ne dépendent que de cette interface et de ces types, dans le vocabulaire Nuera.
 * Aucune forme propre à Twenty ne doit apparaître ici.
 *
 * Toutes les dates (`createdAt`, `updatedAt`, `deletedAt`, `dueAt`, `updatedSince`) sont des chaînes
 * ISO 8601 UTC, sauf `closeDate` (date seule, `AAAA-MM-JJ`).
 *
 * Conventions de mise à jour : un champ absent reste inchangé, `null` l'efface. Les groupes
 * `domains`, `emails` et `phones` sont remplacés en entier (Twenty écrase ou vide les sous-champs
 * non transmis : voir docs/integrations/twenty.md).
 */
import { ConflictError, IntegrationError } from "@/server/errors";

export const OPPORTUNITY_STAGES = [
  "NEW",
  "QUALIFIED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// --- Erreurs du port -----------------------------------------------------------------------------

export type CrmUnavailableReason =
  /** TWENTY_API_URL / TWENTY_API_KEY absents. */
  | "not_configured"
  /** Clé d'API absente, expirée ou révoquée. */
  | "unauthorized"
  /** Réseau, délai dépassé ou erreur 5xx après les nouvelles tentatives. */
  | "unreachable"
  /** Limite de débit de Twenty encore dépassée après les nouvelles tentatives. */
  | "rate_limited";

const UNAVAILABLE_MESSAGES: Record<CrmUnavailableReason, string> = {
  not_configured:
    "Connexion au CRM requise : l'URL et la clé d'API de Twenty ne sont pas définies.",
  unauthorized: "Connexion au CRM requise : Twenty refuse la clé d'API configurée.",
  unreachable: "Le CRM est momentanément indisponible. Réessayez dans quelques instants.",
  rate_limited: "Le CRM reçoit trop de demandes pour le moment. Réessayez dans une minute.",
};

/** Le CRM ne peut pas répondre : jamais de succès simulé, l'appelant décide quoi afficher. */
export class IntegrationUnavailableError extends IntegrationError {
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly reason: CrmUnavailableReason,
    options?: { cause?: unknown; status?: number; retryAfterMs?: number },
  ) {
    super("crm", UNAVAILABLE_MESSAGES[reason], options);
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export type CrmDuplicateField = "domain" | "email" | "id";

/**
 * Contrainte d'unicité violée. Un enregistrement archivé (`existing.deleted`) continue d'occuper
 * son domaine ou son e-mail : le restaurer plutôt que d'en recréer un.
 */
export class CrmDuplicateError extends ConflictError {
  constructor(
    readonly field: CrmDuplicateField,
    readonly existing: { id: string; deleted: boolean } | null,
  ) {
    const message = duplicateMessage(field, existing?.deleted ?? false);
    super(
      message,
      field === "id" ? {} : { [field === "domain" ? "domains" : "emails"]: [message] },
    );
  }
}

function duplicateMessage(field: CrmDuplicateField, deleted: boolean): string {
  const suffix = deleted ? " (fiche archivée)" : "";
  if (field === "domain") return `Une entreprise utilise déjà ce domaine${suffix}.`;
  if (field === "email") return `Une personne utilise déjà cette adresse e-mail${suffix}.`;
  return `Cet enregistrement existe déjà${suffix}.`;
}

// --- Types communs -------------------------------------------------------------------------------

export type CrmRecordMeta = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Renseigné uniquement pour un enregistrement archivé (`includeDeleted`). */
  deletedAt: string | null;
};

export type CrmPageOptions = {
  /** Enregistrements modifiés à cette date ou après (inclusif : prévoir un rejeu idempotent). */
  updatedSince?: string;
  /** Curseur de la page précédente, à utiliser avec les mêmes `updatedSince` et `includeDeleted`. */
  cursor?: string;
  /** 60 par défaut, 200 au maximum. */
  limit?: number;
  /** Inclut les enregistrements archivés (nécessaire à la réconciliation de la projection). */
  includeDeleted?: boolean;
};

/** Trié par `updatedAt` croissant puis par identifiant. */
export type CrmPage<T> = {
  items: T[];
  /** `null` sur la dernière page. */
  nextCursor: string | null;
};

export type CrmMergeResult<T> = {
  merged: T;
  /** Enregistrements absorbés, supprimés définitivement : invisibles ensuite, même archivés. */
  removedIds: string[];
};

/** Valeur principale et valeurs secondaires, toujours transmises ensemble. */
export type CrmMultiValue = {
  primary: string | null;
  additional: string[];
};

// --- Entreprises ---------------------------------------------------------------------------------

export type CrmAddress = {
  street1: string | null;
  street2: string | null;
  city: string | null;
  postcode: string | null;
  state: string | null;
  country: string | null;
};

export type CrmCompany = CrmRecordMeta & {
  name: string;
  /** Domaines normalisés par le CRM (minuscules, sans protocole, `www.` ni chemin). */
  domains: CrmMultiValue;
  linkedinUrl: string | null;
  address: CrmAddress;
};

export type CreateCompanyInput = {
  /** UUID fourni par l'appelant : rend la création rejouable sans doublon. */
  id?: string;
  name: string;
  domains?: CrmMultiValue;
  linkedinUrl?: string | null;
  address?: Partial<CrmAddress>;
};

export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, "id">>;

// --- Personnes -----------------------------------------------------------------------------------

export type CrmPerson = CrmRecordMeta & {
  firstName: string;
  lastName: string;
  /** Adresses en minuscules. */
  emails: CrmMultiValue;
  /** Numéros au format international (`+33612345678`). */
  phones: CrmMultiValue;
  jobTitle: string | null;
  companyId: string | null;
};

export type CreatePersonInput = {
  id?: string;
  firstName: string;
  lastName: string;
  emails?: CrmMultiValue;
  /** Format international obligatoire : un numéro national (`06…`) est refusé. */
  phones?: CrmMultiValue;
  jobTitle?: string | null;
  companyId?: string | null;
};

export type UpdatePersonInput = Partial<Omit<CreatePersonInput, "id">>;

// --- Opportunités --------------------------------------------------------------------------------

export type CrmAmount = {
  cents: number;
  /** Toujours `EUR` pour ce qu'écrit Nuera OS ; un dossier saisi dans Twenty peut différer. */
  currency: string;
};

export type CrmOpportunity = CrmRecordMeta & {
  name: string;
  stage: OpportunityStage;
  amount: CrmAmount | null;
  /** `AAAA-MM-JJ`. */
  closeDate: string | null;
  companyId: string | null;
  pointOfContactId: string | null;
};

export type CreateOpportunityInput = {
  id?: string;
  name: string;
  /** `NEW` par défaut. */
  stage?: OpportunityStage;
  amount?: { cents: number; currency: "EUR" } | null;
  closeDate?: string | null;
  companyId?: string | null;
  pointOfContactId?: string | null;
};

export type UpdateOpportunityInput = Partial<Omit<CreateOpportunityInput, "id">>;

// --- Notes et tâches -----------------------------------------------------------------------------

export type CrmActivityTargetType = "company" | "person" | "opportunity";

export type CrmActivityTarget = {
  type: CrmActivityTargetType;
  id: string;
};

export type CrmNote = CrmRecordMeta & {
  title: string;
  bodyMarkdown: string | null;
  /** Liens actifs ; vide pour une note archivée (l'archivage archive aussi ses liens). */
  targets: CrmActivityTarget[];
};

export type CreateNoteInput = {
  id?: string;
  title: string;
  bodyMarkdown?: string | null;
  /** Au moins une cible. */
  targets: CrmActivityTarget[];
};

export type UpdateNoteInput = {
  title?: string;
  bodyMarkdown?: string | null;
  /** Remplace l'ensemble des cibles (au moins une). */
  targets?: CrmActivityTarget[];
};

export type CrmTask = CrmRecordMeta & {
  title: string;
  bodyMarkdown: string | null;
  status: TaskStatus;
  dueAt: string | null;
  targets: CrmActivityTarget[];
};

export type CreateTaskInput = {
  id?: string;
  title: string;
  bodyMarkdown?: string | null;
  /** `TODO` par défaut. */
  status?: TaskStatus;
  dueAt?: string | null;
  /** Au moins une cible. */
  targets: CrmActivityTarget[];
};

export type UpdateTaskInput = {
  title?: string;
  bodyMarkdown?: string | null;
  status?: TaskStatus;
  dueAt?: string | null;
  /** Remplace l'ensemble des cibles (au moins une). */
  targets?: CrmActivityTarget[];
};

/**
 * Lien entre une activité et sa cible. À réconcilier à part : un lien ajouté ou retiré depuis
 * l'interface Twenty ne modifie pas le `updatedAt` de la note ou de la tâche.
 */
export type CrmActivityLink = CrmRecordMeta & {
  activityType: "note" | "task";
  activityId: string;
  target: CrmActivityTarget | null;
};

// --- Santé ---------------------------------------------------------------------------------------

export type CrmHealth = {
  reachable: boolean;
  authenticated: boolean;
  version: string | null;
};

// --- Port ----------------------------------------------------------------------------------------

/**
 * Erreurs levées : `IntegrationUnavailableError` (indisponible), `NotFoundError` (absent ou archivé),
 * `CrmDuplicateError` (unicité), `ValidationError` (entrée refusée, cible inexistante),
 * `IntegrationError` (réponse inattendue).
 */
export interface CrmGateway {
  /** `false` : tout appel, y compris `health()`, échoue avec `IntegrationUnavailableError`. */
  readonly isConfigured: boolean;

  /** Ne lève pas si l'instance est injoignable : l'état est décrit par le résultat. */
  health(): Promise<CrmHealth>;

  createCompany(input: CreateCompanyInput): Promise<CrmCompany>;
  updateCompany(id: string, input: UpdateCompanyInput): Promise<CrmCompany>;
  getCompany(id: string): Promise<CrmCompany>;
  listCompanies(options?: CrmPageOptions): Promise<CrmPage<CrmCompany>>;
  /** Archive (suppression douce) ; le domaine reste réservé tant que la fiche n'est pas purgée. */
  deleteCompany(id: string): Promise<void>;
  restoreCompany(id: string): Promise<CrmCompany>;
  /** 2 à 9 fiches au total. Les fiches liées sont rattachées au gagnant, qui garde son identifiant. */
  mergeCompanies(input: {
    winnerId: string;
    loserIds: string[];
  }): Promise<CrmMergeResult<CrmCompany>>;

  createPerson(input: CreatePersonInput): Promise<CrmPerson>;
  updatePerson(id: string, input: UpdatePersonInput): Promise<CrmPerson>;
  getPerson(id: string): Promise<CrmPerson>;
  listPeople(options?: CrmPageOptions): Promise<CrmPage<CrmPerson>>;
  deletePerson(id: string): Promise<void>;
  restorePerson(id: string): Promise<CrmPerson>;
  mergePeople(input: { winnerId: string; loserIds: string[] }): Promise<CrmMergeResult<CrmPerson>>;

  createOpportunity(input: CreateOpportunityInput): Promise<CrmOpportunity>;
  updateOpportunity(id: string, input: UpdateOpportunityInput): Promise<CrmOpportunity>;
  getOpportunity(id: string): Promise<CrmOpportunity>;
  listOpportunities(options?: CrmPageOptions): Promise<CrmPage<CrmOpportunity>>;
  deleteOpportunity(id: string): Promise<void>;
  restoreOpportunity(id: string): Promise<CrmOpportunity>;

  createNote(input: CreateNoteInput): Promise<CrmNote>;
  updateNote(id: string, input: UpdateNoteInput): Promise<CrmNote>;
  getNote(id: string): Promise<CrmNote>;
  listNotes(options?: CrmPageOptions): Promise<CrmPage<CrmNote>>;
  deleteNote(id: string): Promise<void>;

  createTask(input: CreateTaskInput): Promise<CrmTask>;
  updateTask(id: string, input: UpdateTaskInput): Promise<CrmTask>;
  completeTask(id: string): Promise<CrmTask>;
  getTask(id: string): Promise<CrmTask>;
  listTasks(options?: CrmPageOptions): Promise<CrmPage<CrmTask>>;
  deleteTask(id: string): Promise<void>;

  listActivityLinks(
    options: CrmPageOptions & { activityType: "note" | "task" },
  ): Promise<CrmPage<CrmActivityLink>>;
}
