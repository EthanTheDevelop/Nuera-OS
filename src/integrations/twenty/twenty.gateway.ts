import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "@/lib/zod";
import { IntegrationError, NotFoundError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  CrmDuplicateError,
  IntegrationUnavailableError,
  type CreateCompanyInput,
  type CreateNoteInput,
  type CreateOpportunityInput,
  type CreatePersonInput,
  type CreateTaskInput,
  type CrmActivityLink,
  type CrmActivityTarget,
  type CrmCompany,
  type CrmDuplicateField,
  type CrmGateway,
  type CrmHealth,
  type CrmMergeResult,
  type CrmNote,
  type CrmOpportunity,
  type CrmPage,
  type CrmPageOptions,
  type CrmPerson,
  type CrmTask,
  type UpdateCompanyInput,
  type UpdateNoteInput,
  type UpdateOpportunityInput,
  type UpdatePersonInput,
  type UpdateTaskInput,
} from "./crm-gateway";
import { TwentyApiError, type TwentyClient, TwentyNetworkError } from "./twenty.client";
import {
  fromAddress,
  fromAmount,
  fromCloseDate,
  fromDomains,
  fromEmails,
  fromLinkedin,
  fromPhones,
  isSameTarget,
  normalizeDomain,
  noteTargetToLink,
  targetToFields,
  taskTargetToLink,
  toCrmCompany,
  toCrmNote,
  toCrmOpportunity,
  toCrmPerson,
  toCrmTask,
} from "./twenty.mappers";
import {
  twentyCompanySchema,
  twentyNoteSchema,
  twentyNoteTargetSchema,
  twentyOpportunitySchema,
  twentyPageInfoSchema,
  twentyPersonSchema,
  twentyTaskSchema,
  twentyTaskTargetSchema,
} from "./twenty.types";

const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;
const MAX_BATCH_SIZE = 60;
const MAX_MERGE_RECORDS = 9;
const INCLUDE_DELETED_FILTER = "or(deletedAt[is]:NULL,deletedAt[is]:NOT_NULL)";

/** Noms de ressource REST de Twenty : `plural` dans l'URL, `Name` dans les clés de réponse. */
type Resource<T> = {
  plural: string;
  singular: string;
  Name: string;
  /** Requêtes qui lisent des relations (`depth=1`) : liste de champs explicite. */
  read: { depth: 0 } | { depth: 1; fields: string };
  map: (body: unknown) => T;
};

function resource<S extends z.ZodType, T>(
  names: Pick<Resource<T>, "plural" | "singular" | "Name" | "read">,
  schema: S,
  mapper: (record: z.infer<S>) => T,
): Resource<T> {
  return { ...names, map: (body) => mapper(parseRecord(schema, body, names.singular)) };
}

function parseRecord<S extends z.ZodType>(schema: S, body: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new IntegrationError("twenty", `Réponse inattendue du CRM (${label}).`, {
      cause: result.error,
    });
  }
  return result.data;
}

const COMPANIES = resource(
  { plural: "companies", singular: "company", Name: "Company", read: { depth: 0 } },
  twentyCompanySchema,
  toCrmCompany,
);
const PEOPLE = resource(
  { plural: "people", singular: "person", Name: "Person", read: { depth: 0 } },
  twentyPersonSchema,
  toCrmPerson,
);
const OPPORTUNITIES = resource(
  { plural: "opportunities", singular: "opportunity", Name: "Opportunity", read: { depth: 0 } },
  twentyOpportunitySchema,
  toCrmOpportunity,
);
const NOTES = resource(
  {
    plural: "notes",
    singular: "note",
    Name: "Note",
    read: { depth: 1, fields: "id,createdAt,updatedAt,deletedAt,title,bodyV2,noteTargets" },
  },
  twentyNoteSchema,
  toCrmNote,
);
const TASKS = resource(
  {
    plural: "tasks",
    singular: "task",
    Name: "Task",
    read: {
      depth: 1,
      fields: "id,createdAt,updatedAt,deletedAt,title,bodyV2,dueAt,status,taskTargets",
    },
  },
  twentyTaskSchema,
  toCrmTask,
);
const NOTE_TARGETS = resource(
  { plural: "noteTargets", singular: "noteTarget", Name: "NoteTarget", read: { depth: 0 } },
  twentyNoteTargetSchema,
  noteTargetToLink,
);
const TASK_TARGETS = resource(
  { plural: "taskTargets", singular: "taskTarget", Name: "TaskTarget", read: { depth: 0 } },
  twentyTaskTargetSchema,
  taskTargetToLink,
);

type ActivityKind = {
  links: Resource<CrmActivityLink>;
  foreignKey: "noteId" | "taskId";
};
const NOTE_KIND: ActivityKind = { links: NOTE_TARGETS, foreignKey: "noteId" };
const TASK_KIND: ActivityKind = { links: TASK_TARGETS, foreignKey: "taskId" };

type ActivityRecord = { title: string; targets: CrmActivityTarget[] };

/** Valeur unique à rechercher pour désigner le propriétaire d'une contrainte violée. */
type UniqueLookup = { field: "domain"; domain: string } | { field: "email"; email: string };

function recordPath<T>({ plural }: Resource<T>, id: string): string {
  return `/rest/${plural}/${encodeURIComponent(id)}`;
}

function readQuery<T>({ read }: Resource<T>) {
  return read.depth === 0 ? { depth: 0 } : { depth: 1, fields: read.fields };
}

function dataOf(body: unknown, key: string): unknown {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  return data?.[key];
}

function assertTargets(targets: CrmActivityTarget[]): void {
  if (targets.length === 0) {
    throw new ValidationError("Une activité doit être liée à au moins une fiche.", {
      targets: ["Choisissez une entreprise, une personne ou une opportunité."],
    });
  }
}

function dedupeTargets(targets: CrmActivityTarget[]): CrmActivityTarget[] {
  return targets.filter(
    (target, index) => targets.findIndex((other) => isSameTarget(target, other)) === index,
  );
}

function toIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError("Date de reprise invalide.");
  return date.toISOString();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueConstraintOf(error: TwentyApiError): string | null {
  for (const message of error.messages) {
    const match = /unique constraint (\S+) was violated/.exec(message);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Traduit une erreur technique de Twenty en erreur du port (message français, sans détail interne). */
export function translateTwentyError(error: unknown): unknown {
  if (error instanceof TwentyNetworkError) {
    return new IntegrationUnavailableError("unreachable", { cause: error });
  }
  if (!(error instanceof TwentyApiError)) return error;

  const status = error.status ?? 0;
  const text = error.messages.join(" ");

  if (status === 401 || status === 403) {
    return new IntegrationUnavailableError("unauthorized", { cause: error, status });
  }
  if (status === 429) {
    return new IntegrationUnavailableError("rate_limited", {
      cause: error,
      status,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (status >= 500)
    return new IntegrationUnavailableError("unreachable", { cause: error, status });
  if (status === 404 || /records? (were )?not found/i.test(text)) return new NotFoundError();

  if (/is not a domain name/.test(text)) {
    return new ValidationError("Nom de domaine invalide.", {
      domains: ["Saisissez un domaine valide, par exemple nuera.studio."],
    });
  }
  if (/email field/.test(text)) {
    return new ValidationError("Adresse e-mail invalide.", {
      emails: ["Saisissez une adresse e-mail valide."],
    });
  }
  if (/phone number is invalid/.test(text)) {
    return new ValidationError("Numéro de téléphone invalide.", {
      phones: ["Format international attendu, par exemple +33612345678."],
    });
  }
  if (/violates foreign key constraint/.test(text)) {
    return new ValidationError("La fiche liée n'existe pas.");
  }
  if (/is not a valid UUID/.test(text)) return new ValidationError("Identifiant invalide.");
  if (/for field "stage"/.test(text)) {
    return new IntegrationError(
      "twenty",
      "Les étapes d'opportunité du CRM ne sont pas celles de Nuera : lancer `npm run twenty:bootstrap`.",
      { cause: error, status },
    );
  }
  return error;
}

export class TwentyCrmGateway implements CrmGateway {
  readonly isConfigured = true;

  constructor(private readonly client: TwentyClient) {}

  // --- Santé -------------------------------------------------------------------------------------

  async health(): Promise<CrmHealth> {
    try {
      const healthz = await this.client.publicGet("/healthz");
      if (!healthz.ok) return { reachable: false, authenticated: false, version: null };
    } catch {
      return { reachable: false, authenticated: false, version: null };
    }
    return {
      reachable: true,
      authenticated: await this.isAuthenticated(),
      version: await this.readVersion(),
    };
  }

  private async readVersion(): Promise<string | null> {
    try {
      const config = await this.client.publicGet("/client-config");
      const body = (await config.json()) as { appVersion?: unknown };
      return typeof body.appVersion === "string" ? body.appVersion : null;
    } catch {
      return null;
    }
  }

  private async isAuthenticated(): Promise<boolean> {
    try {
      await this.client.request({
        method: "GET",
        path: "/rest/companies",
        query: { limit: 1, depth: 0, fields: "id" },
      });
      return true;
    } catch (error) {
      // 429 : la limite est comptée par clé d'API, la clé a donc été acceptée.
      return error instanceof TwentyApiError && error.status === 429;
    }
  }

  // --- Entreprises -------------------------------------------------------------------------------

  async createCompany(input: CreateCompanyInput): Promise<CrmCompany> {
    return this.create(COMPANIES, input.id, companyBody(input), domainLookup(input.domains));
  }

  async updateCompany(id: string, input: UpdateCompanyInput): Promise<CrmCompany> {
    return this.update(COMPANIES, id, companyBody(input), domainLookup(input.domains));
  }

  getCompany(id: string): Promise<CrmCompany> {
    return this.get(COMPANIES, id);
  }

  listCompanies(options?: CrmPageOptions): Promise<CrmPage<CrmCompany>> {
    return this.list(COMPANIES, options);
  }

  deleteCompany(id: string): Promise<void> {
    return this.softDelete(COMPANIES, id);
  }

  restoreCompany(id: string): Promise<CrmCompany> {
    return this.restore(COMPANIES, id);
  }

  mergeCompanies(input: {
    winnerId: string;
    loserIds: string[];
  }): Promise<CrmMergeResult<CrmCompany>> {
    return this.merge(COMPANIES, input);
  }

  // --- Personnes ---------------------------------------------------------------------------------

  async createPerson(input: CreatePersonInput): Promise<CrmPerson> {
    return this.create(PEOPLE, input.id, personBody(input), emailLookup(input.emails));
  }

  async updatePerson(id: string, input: UpdatePersonInput): Promise<CrmPerson> {
    return this.update(PEOPLE, id, personBody(input), emailLookup(input.emails));
  }

  getPerson(id: string): Promise<CrmPerson> {
    return this.get(PEOPLE, id);
  }

  listPeople(options?: CrmPageOptions): Promise<CrmPage<CrmPerson>> {
    return this.list(PEOPLE, options);
  }

  deletePerson(id: string): Promise<void> {
    return this.softDelete(PEOPLE, id);
  }

  restorePerson(id: string): Promise<CrmPerson> {
    return this.restore(PEOPLE, id);
  }

  mergePeople(input: { winnerId: string; loserIds: string[] }): Promise<CrmMergeResult<CrmPerson>> {
    return this.merge(PEOPLE, input);
  }

  // --- Opportunités ------------------------------------------------------------------------------

  async createOpportunity(input: CreateOpportunityInput): Promise<CrmOpportunity> {
    return this.create(OPPORTUNITIES, input.id, opportunityBody(input));
  }

  async updateOpportunity(id: string, input: UpdateOpportunityInput): Promise<CrmOpportunity> {
    return this.update(OPPORTUNITIES, id, opportunityBody(input));
  }

  getOpportunity(id: string): Promise<CrmOpportunity> {
    return this.get(OPPORTUNITIES, id);
  }

  listOpportunities(options?: CrmPageOptions): Promise<CrmPage<CrmOpportunity>> {
    return this.list(OPPORTUNITIES, options);
  }

  deleteOpportunity(id: string): Promise<void> {
    return this.softDelete(OPPORTUNITIES, id);
  }

  restoreOpportunity(id: string): Promise<CrmOpportunity> {
    return this.restore(OPPORTUNITIES, id);
  }

  // --- Notes et tâches ---------------------------------------------------------------------------

  async createNote(input: CreateNoteInput): Promise<CrmNote> {
    return this.createActivity(NOTE_KIND, NOTES, input.id, noteBody(input), input.targets);
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<CrmNote> {
    return this.updateActivity(NOTE_KIND, NOTES, id, noteBody(input), input.targets);
  }

  getNote(id: string): Promise<CrmNote> {
    return this.get(NOTES, id);
  }

  listNotes(options?: CrmPageOptions): Promise<CrmPage<CrmNote>> {
    return this.list(NOTES, options);
  }

  deleteNote(id: string): Promise<void> {
    return this.softDelete(NOTES, id);
  }

  async createTask(input: CreateTaskInput): Promise<CrmTask> {
    return this.createActivity(TASK_KIND, TASKS, input.id, taskBody(input), input.targets);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<CrmTask> {
    return this.updateActivity(TASK_KIND, TASKS, id, taskBody(input), input.targets);
  }

  completeTask(id: string): Promise<CrmTask> {
    return this.updateActivity(TASK_KIND, TASKS, id, { status: "DONE" }, undefined);
  }

  getTask(id: string): Promise<CrmTask> {
    return this.get(TASKS, id);
  }

  listTasks(options?: CrmPageOptions): Promise<CrmPage<CrmTask>> {
    return this.list(TASKS, options);
  }

  deleteTask(id: string): Promise<void> {
    return this.softDelete(TASKS, id);
  }

  listActivityLinks(
    options: CrmPageOptions & { activityType: "note" | "task" },
  ): Promise<CrmPage<CrmActivityLink>> {
    return this.list(options.activityType === "note" ? NOTE_TARGETS : TASK_TARGETS, options);
  }

  // --- Mécanique générique -----------------------------------------------------------------------

  private async call(request: Parameters<TwentyClient["request"]>[0]): Promise<unknown> {
    try {
      return await this.client.request(request);
    } catch (error) {
      const translated = translateTwentyError(error);
      if (error instanceof TwentyApiError && translated === error) {
        logger.warn("twenty.request_rejected", {
          method: request.method,
          path: request.path,
          status: error.status,
          code: error.twentyCode,
        });
      }
      throw translated;
    }
  }

  /** L'identifiant est généré ici : la création reste rejouable après une coupure réseau. */
  private async create<T>(
    target: Resource<T>,
    id: string | undefined,
    body: Record<string, unknown>,
    lookup?: UniqueLookup,
  ): Promise<T> {
    const recordId = id ?? randomUUID();
    try {
      const response = await this.client.request({
        method: "POST",
        path: `/rest/${target.plural}`,
        query: { depth: 0 },
        body: { id: recordId, ...body },
        idempotent: true,
      });
      return target.map(dataOf(response, `create${target.Name}`));
    } catch (error) {
      const constraint = error instanceof TwentyApiError ? uniqueConstraintOf(error) : null;
      if (constraint?.endsWith("_pkey")) return this.getExistingAfterReplay(target, recordId);
      if (constraint) throw await this.duplicateError(lookup);
      throw translateTwentyError(error);
    }
  }

  /** Rejeu d'une création : renvoie l'enregistrement déjà créé avec cet identifiant. */
  private async getExistingAfterReplay<T>(target: Resource<T>, id: string): Promise<T> {
    try {
      return await this.get(target, id);
    } catch (error) {
      if (error instanceof NotFoundError) throw new CrmDuplicateError("id", { id, deleted: true });
      throw error;
    }
  }

  private async update<T>(
    target: Resource<T>,
    id: string,
    body: Record<string, unknown>,
    lookup?: UniqueLookup,
  ): Promise<T> {
    if (Object.keys(body).length === 0) return this.get(target, id);
    try {
      const response = await this.client.request({
        method: "PATCH",
        path: recordPath(target, id),
        query: readQuery(target),
        body,
      });
      return target.map(dataOf(response, `update${target.Name}`));
    } catch (error) {
      const constraint = error instanceof TwentyApiError ? uniqueConstraintOf(error) : null;
      if (constraint) throw await this.duplicateError(lookup);
      throw translateTwentyError(error);
    }
  }

  private async duplicateError(lookup: UniqueLookup | undefined): Promise<CrmDuplicateError> {
    const field: CrmDuplicateField = lookup?.field ?? "id";
    return new CrmDuplicateError(field, lookup ? await this.findOwner(lookup) : null);
  }

  /** Une requête de plus, uniquement sur doublon : permet de proposer la fiche existante. */
  private async findOwner(lookup: UniqueLookup): Promise<{ id: string; deleted: boolean } | null> {
    const [path, filter] =
      lookup.field === "domain"
        ? ["companies", `domainName.primaryLinkUrl[eq]:"${lookup.domain}"`]
        : ["people", `emails.primaryEmail[eq]:"${lookup.email}"`];
    try {
      const response = await this.client.request({
        method: "GET",
        path: `/rest/${path}`,
        query: {
          depth: 0,
          limit: 1,
          fields: "id,deletedAt",
          filter: `and(${filter},${INCLUDE_DELETED_FILTER})`,
        },
      });
      const owner = (dataOf(response, path) as { id: string; deletedAt: string | null }[])?.[0];
      return owner ? { id: owner.id, deleted: owner.deletedAt !== null } : null;
    } catch {
      return null;
    }
  }

  private async get<T>(target: Resource<T>, id: string): Promise<T> {
    const response = await this.call({
      method: "GET",
      path: recordPath(target, id),
      query: readQuery(target),
    });
    const record = dataOf(response, target.singular);
    if (record === null || record === undefined) throw new NotFoundError();
    return target.map(record);
  }

  private async list<T>(target: Resource<T>, options: CrmPageOptions = {}): Promise<CrmPage<T>> {
    const filters = [
      options.updatedSince ? `updatedAt[gte]:"${toIsoDate(options.updatedSince)}"` : null,
      options.includeDeleted ? INCLUDE_DELETED_FILTER : null,
    ].filter((filter): filter is string => filter !== null);

    const response = await this.call({
      method: "GET",
      path: `/rest/${target.plural}`,
      query: {
        ...readQuery(target),
        limit: Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
        order_by: "updatedAt[AscNullsLast],id[AscNullsLast]",
        filter: filters.length > 1 ? `and(${filters.join(",")})` : filters[0],
        starting_after: options.cursor,
      },
    });

    const records = dataOf(response, target.plural);
    if (!Array.isArray(records)) {
      throw new IntegrationError("twenty", `Réponse inattendue du CRM (${target.plural}).`);
    }
    const pageInfo = parseRecord(
      twentyPageInfoSchema,
      (response as { pageInfo?: unknown }).pageInfo,
      "pageInfo",
    );
    return {
      items: records.map((record) => target.map(record)),
      nextCursor: pageInfo.hasNextPage ? (pageInfo.endCursor ?? null) : null,
    };
  }

  /**
   * `soft_delete=true` obligatoire : sans ce paramètre, DELETE supprime définitivement.
   * Un 404 après rejeu signifie que la tentative précédente a abouti.
   */
  private async softDelete<T>(target: Resource<T>, id: string): Promise<void> {
    try {
      await this.client.request({
        method: "DELETE",
        path: recordPath(target, id),
        query: { soft_delete: true },
      });
    } catch (error) {
      if (error instanceof TwentyApiError && error.status === 404 && error.attempts > 1) return;
      throw translateTwentyError(error);
    }
  }

  private async restore<T>(target: Resource<T>, id: string): Promise<T> {
    const response = await this.call({
      method: "PATCH",
      path: `${recordPath(target, id)}/restore`,
      query: readQuery(target),
    });
    return target.map(dataOf(response, `restore${target.Name}`));
  }

  private async merge<T>(
    target: Resource<T>,
    { winnerId, loserIds }: { winnerId: string; loserIds: string[] },
  ): Promise<CrmMergeResult<T>> {
    const removedIds = [...new Set(loserIds)].filter((id) => id !== winnerId);
    if (removedIds.length === 0 || removedIds.length + 1 > MAX_MERGE_RECORDS) {
      throw new ValidationError(`Une fusion porte sur 2 à ${MAX_MERGE_RECORDS} fiches.`);
    }
    const response = await this.call({
      method: "PATCH",
      path: `/rest/${target.plural}/merge`,
      query: { depth: 0 },
      body: { ids: [winnerId, ...removedIds], conflictPriorityIndex: 0 },
      // Après une réponse perdue, un rejeu échouerait : les perdants n'existent plus.
      idempotent: false,
    });
    return { merged: target.map(dataOf(response, `merge${target.Name}`)), removedIds };
  }

  private async createActivity<T extends ActivityRecord>(
    kind: ActivityKind,
    target: Resource<T>,
    id: string | undefined,
    body: Record<string, unknown>,
    targets: CrmActivityTarget[],
  ): Promise<T> {
    assertTargets(targets);
    const desired = dedupeTargets(targets);
    const recordId = id ?? randomUUID();

    // Un identifiant fourni peut correspondre à un rejeu : on complète alors les liens manquants.
    if (id !== undefined) {
      const existing = await this.getOrNull(target, recordId);
      if (existing) {
        await this.syncLinks(kind, recordId, desired);
        return this.get(target, recordId);
      }
    }

    const created = await this.create(target, recordId, body);
    try {
      await this.createLinks(kind, recordId, desired);
    } catch (error) {
      await this.compensateCreate(target, recordId);
      throw error;
    }
    return { ...created, targets: desired };
  }

  private async getOrNull<T>(target: Resource<T>, id: string): Promise<T | null> {
    try {
      return await this.get(target, id);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  /** Twenty ne sait pas créer une note et ses liens atomiquement : on ne laisse pas d'orpheline. */
  private async compensateCreate<T>(target: Resource<T>, id: string): Promise<void> {
    try {
      await this.client.request({ method: "DELETE", path: recordPath(target, id) });
    } catch {
      logger.warn("twenty.compensation_failed", { resource: target.singular, id });
    }
  }

  private async updateActivity<T extends ActivityRecord>(
    kind: ActivityKind,
    target: Resource<T>,
    id: string,
    body: Record<string, unknown>,
    targets: CrmActivityTarget[] | undefined,
  ): Promise<T> {
    let changed = false;
    if (targets !== undefined) {
      assertTargets(targets);
      await this.get(target, id); // NotFoundError plutôt qu'un échec de clé étrangère sur les liens.
      changed = await this.syncLinks(kind, id, dedupeTargets(targets));
    }
    if (Object.keys(body).length > 0) return this.update(target, id, body);
    if (!changed) return this.get(target, id);

    // Un lien ne modifie pas le `updatedAt` de l'activité : on le force pour la réconciliation.
    const current = await this.get(target, id);
    return this.update(target, id, { title: current.title });
  }

  private async syncLinks(
    kind: ActivityKind,
    activityId: string,
    desired: CrmActivityTarget[],
  ): Promise<boolean> {
    const current = await this.activeLinks(kind, activityId);
    const toCreate = desired.filter(
      (target) => !current.some((link) => link.target && isSameTarget(link.target, target)),
    );
    const toRemove = current.filter(
      (link) => !link.target || !desired.some((target) => isSameTarget(link.target!, target)),
    );
    await this.createLinks(kind, activityId, toCreate);
    // Suppression douce : le retrait reste visible par la réconciliation des liens.
    for (const link of toRemove) await this.softDelete(kind.links, link.id);
    return toCreate.length > 0 || toRemove.length > 0;
  }

  private async activeLinks(kind: ActivityKind, activityId: string): Promise<CrmActivityLink[]> {
    const response = await this.call({
      method: "GET",
      path: `/rest/${kind.links.plural}`,
      query: {
        depth: 0,
        limit: MAX_PAGE_SIZE,
        filter: `${kind.foreignKey}[eq]:${activityId}`,
      },
    });
    const records = dataOf(response, kind.links.plural);
    if (!Array.isArray(records)) {
      throw new IntegrationError("twenty", `Réponse inattendue du CRM (${kind.links.plural}).`);
    }
    return records.map((record) => kind.links.map(record));
  }

  private async createLinks(
    kind: ActivityKind,
    activityId: string,
    targets: CrmActivityTarget[],
  ): Promise<void> {
    for (const batch of chunk(targets, MAX_BATCH_SIZE)) {
      await this.call({
        method: "POST",
        path: `/rest/batch/${kind.links.plural}`,
        query: { depth: 0 },
        body: batch.map((target) => ({
          [kind.foreignKey]: activityId,
          ...targetToFields(target),
        })),
      });
    }
  }
}

// --- Corps de requête ----------------------------------------------------------------------------

function defined(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function companyBody(input: UpdateCompanyInput): Record<string, unknown> {
  return defined({
    name: input.name,
    domainName: input.domains && fromDomains(input.domains),
    linkedinLink: input.linkedinUrl === undefined ? undefined : fromLinkedin(input.linkedinUrl),
    address: input.address && fromAddress(input.address),
  });
}

function personBody(input: UpdatePersonInput): Record<string, unknown> {
  const hasName = input.firstName !== undefined || input.lastName !== undefined;
  return defined({
    name: hasName ? defined({ firstName: input.firstName, lastName: input.lastName }) : undefined,
    emails: input.emails && fromEmails(input.emails),
    phones: input.phones && fromPhones(input.phones),
    jobTitle: input.jobTitle === undefined ? undefined : (input.jobTitle ?? ""),
    companyId: input.companyId,
  });
}

function opportunityBody(input: UpdateOpportunityInput): Record<string, unknown> {
  return defined({
    name: input.name,
    stage: input.stage,
    amount: input.amount === undefined ? undefined : fromAmount(input.amount),
    closeDate: input.closeDate === undefined ? undefined : fromCloseDate(input.closeDate),
    companyId: input.companyId,
    pointOfContactId: input.pointOfContactId,
  });
}

function noteBody(input: UpdateNoteInput): Record<string, unknown> {
  return defined({
    title: input.title,
    bodyV2: input.bodyMarkdown === undefined ? undefined : { markdown: input.bodyMarkdown ?? "" },
  });
}

function taskBody(input: UpdateTaskInput): Record<string, unknown> {
  return defined({
    ...noteBody(input),
    status: input.status,
    dueAt: input.dueAt,
  });
}

function domainLookup(domains: { primary: string | null } | undefined): UniqueLookup | undefined {
  return domains?.primary
    ? { field: "domain", domain: normalizeDomain(domains.primary) }
    : undefined;
}

function emailLookup(emails: { primary: string | null } | undefined): UniqueLookup | undefined {
  return emails?.primary ? { field: "email", email: emails.primary.toLowerCase() } : undefined;
}
