/**
 * Fausse passerelle CRM en mémoire : RÉSERVÉE AUX TESTS, jamais importée par l'application.
 *
 * Reproduit le comportement observé sur Twenty v2.55.0 : le même contrat
 * (`crm-gateway.contract.ts`) s'exécute sur elle et sur l'instance réelle (`npm run test:live`).
 * `simulateOutage()` provoque la même erreur qu'une vraie panne.
 */
import { randomUUID } from "node:crypto";
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
  type CrmAddress,
  type CrmCompany,
  type CrmGateway,
  type CrmHealth,
  type CrmMergeResult,
  type CrmMultiValue,
  type CrmNote,
  type CrmOpportunity,
  type CrmPage,
  type CrmPageOptions,
  type CrmPerson,
  type CrmTask,
  type CrmUnavailableReason,
  type UpdateCompanyInput,
  type UpdateNoteInput,
  type UpdateOpportunityInput,
  type UpdatePersonInput,
  type UpdateTaskInput,
} from "@/integrations/twenty/crm-gateway";
import {
  fromAmount,
  fromCloseDate,
  fromPhones,
  isSameTarget,
  normalizeDomain,
} from "@/integrations/twenty/twenty.mappers";
import { NotFoundError, ValidationError } from "@/server/errors";

const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MERGE_RECORDS = 9;
const DEFAULT_PAGE_SIZE = 60;
const MAX_PAGE_SIZE = 200;

const EMPTY_ADDRESS: CrmAddress = {
  street1: null,
  street2: null,
  city: null,
  postcode: null,
  state: null,
  country: null,
};

type Stored = { id: string; updatedAt: string; deletedAt: string | null };
type StoredNote = Omit<CrmNote, "targets">;
type StoredTask = Omit<CrmTask, "targets">;

export class FakeCrmGateway implements CrmGateway {
  readonly isConfigured = true;

  readonly companies = new Map<string, CrmCompany>();
  readonly people = new Map<string, CrmPerson>();
  readonly opportunities = new Map<string, CrmOpportunity>();
  private readonly notes = new Map<string, StoredNote>();
  private readonly tasks = new Map<string, StoredTask>();
  private readonly links = new Map<string, CrmActivityLink>();

  private outage: CrmUnavailableReason | null = null;
  /** Horloge strictement croissante : deux écritures n'ont jamais le même `updatedAt`. */
  private lastTick = 0;

  /** Toute méthode lève `IntegrationUnavailableError` jusqu'à `endOutage()`. */
  simulateOutage(reason: CrmUnavailableReason = "unreachable"): void {
    this.outage = reason;
  }

  endOutage(): void {
    this.outage = null;
  }

  private guard(): void {
    if (this.outage) throw new IntegrationUnavailableError(this.outage);
  }

  private now(): string {
    this.lastTick = Math.max(this.lastTick + 1, Date.now());
    return new Date(this.lastTick).toISOString();
  }

  private assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) throw new ValidationError("Identifiant invalide.");
  }

  private live<T extends Stored>(store: Map<string, T>, id: string): T {
    this.assertId(id);
    const record = store.get(id);
    if (!record || record.deletedAt) throw new NotFoundError();
    return record;
  }

  /** Comme Twenty : une écriture atteint aussi une fiche archivée. */
  private existing<T extends Stored>(store: Map<string, T>, id: string): T {
    this.assertId(id);
    const record = store.get(id);
    if (!record) throw new NotFoundError();
    return record;
  }

  // --- Santé -------------------------------------------------------------------------------------

  async health(): Promise<CrmHealth> {
    this.guard();
    return { reachable: true, authenticated: true, version: "fake" };
  }

  // --- Entreprises -------------------------------------------------------------------------------

  private normalizeDomains(domains: CrmMultiValue): CrmMultiValue {
    const primary = domains.primary ? normalizeDomain(domains.primary) : null;
    if (primary && !DOMAIN_PATTERN.test(primary)) {
      throw new ValidationError("Nom de domaine invalide.", {
        domains: ["Saisissez un domaine valide, par exemple nuera.studio."],
      });
    }
    return { primary, additional: domains.additional };
  }

  private assertDomainFree(primary: string | null, ownId: string): void {
    if (!primary) return;
    // Un enregistrement archivé garde son domaine.
    for (const company of this.companies.values()) {
      if (company.id !== ownId && company.domains.primary === primary) {
        throw new CrmDuplicateError("domain", {
          id: company.id,
          deleted: company.deletedAt !== null,
        });
      }
    }
  }

  private replayOr<T extends { id: string }>(
    store: Map<string, T>,
    id: string | undefined,
    create: (id: string) => T,
  ): T {
    if (id !== undefined) {
      this.assertId(id);
      const existing = store.get(id);
      if (existing) {
        if ((existing as T & Stored).deletedAt)
          throw new CrmDuplicateError("id", { id, deleted: true });
        return existing;
      }
    }
    const record = create(id ?? randomUUID());
    store.set(record.id, record);
    return record;
  }

  async createCompany(input: CreateCompanyInput): Promise<CrmCompany> {
    this.guard();
    return this.replayOr(this.companies, input.id, (id) => {
      const domains = this.normalizeDomains(input.domains ?? { primary: null, additional: [] });
      this.assertDomainFree(domains.primary, id);
      const now = this.now();
      return {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        name: input.name,
        domains,
        linkedinUrl: input.linkedinUrl ?? null,
        address: { ...EMPTY_ADDRESS, ...input.address },
      };
    });
  }

  async updateCompany(id: string, input: UpdateCompanyInput): Promise<CrmCompany> {
    this.guard();
    const company = this.existing(this.companies, id);
    const domains = input.domains ? this.normalizeDomains(input.domains) : company.domains;
    this.assertDomainFree(domains.primary, id);
    const updated: CrmCompany = {
      ...company,
      name: input.name ?? company.name,
      domains,
      linkedinUrl: input.linkedinUrl === undefined ? company.linkedinUrl : input.linkedinUrl,
      address: { ...company.address, ...input.address },
      updatedAt: this.now(),
    };
    this.companies.set(id, updated);
    return updated;
  }

  async getCompany(id: string): Promise<CrmCompany> {
    this.guard();
    return this.live(this.companies, id);
  }

  async listCompanies(options?: CrmPageOptions): Promise<CrmPage<CrmCompany>> {
    this.guard();
    return this.page([...this.companies.values()], options);
  }

  async deleteCompany(id: string): Promise<void> {
    this.guard();
    this.softDelete(this.companies, id);
  }

  async restoreCompany(id: string): Promise<CrmCompany> {
    this.guard();
    return this.restore(this.companies, id);
  }

  async mergeCompanies(input: {
    winnerId: string;
    loserIds: string[];
  }): Promise<CrmMergeResult<CrmCompany>> {
    this.guard();
    const { winner, losers, removedIds } = this.prepareMerge(this.companies, input);

    const merged = losers.reduce<CrmCompany>((current, loser) => {
      const address = { ...current.address };
      for (const key of Object.keys(address) as (keyof CrmAddress)[]) {
        address[key] = address[key] ?? loser.address[key];
      }
      return {
        ...current,
        domains: mergeValues(current.domains, loser.domains),
        linkedinUrl: current.linkedinUrl ?? loser.linkedinUrl,
        address,
      };
    }, winner);

    for (const loserId of removedIds) {
      this.companies.delete(loserId);
      this.repoint("company", loserId, winner.id);
      this.reassign(this.people, loserId, winner.id, "companyId");
      this.reassign(this.opportunities, loserId, winner.id, "companyId");
    }
    return { merged: this.save(this.companies, merged), removedIds };
  }

  // --- Personnes ---------------------------------------------------------------------------------

  private normalizeEmails(emails: CrmMultiValue): CrmMultiValue {
    const primary = emails.primary ? emails.primary.trim().toLowerCase() : null;
    if (primary && !EMAIL_PATTERN.test(primary)) {
      throw new ValidationError("Adresse e-mail invalide.", {
        emails: ["Saisissez une adresse e-mail valide."],
      });
    }
    return { primary, additional: emails.additional };
  }

  private assertEmailFree(primary: string | null, ownId: string): void {
    if (!primary) return;
    // Seul l'e-mail principal est unique ; un enregistrement archivé garde le sien.
    for (const person of this.people.values()) {
      if (person.id !== ownId && person.emails.primary === primary) {
        throw new CrmDuplicateError("email", {
          id: person.id,
          deleted: person.deletedAt !== null,
        });
      }
    }
  }

  private assertCompanyExists(id: string | null | undefined): void {
    // Une fiche archivée reste une cible valide : seule une clé étrangère inexistante est refusée.
    if (id && !this.companies.has(id)) throw new ValidationError("La fiche liée n'existe pas.");
  }

  private assertPersonExists(id: string | null | undefined): void {
    if (id && !this.people.has(id)) throw new ValidationError("La fiche liée n'existe pas.");
  }

  async createPerson(input: CreatePersonInput): Promise<CrmPerson> {
    this.guard();
    return this.replayOr(this.people, input.id, (id) => {
      const emails = this.normalizeEmails(input.emails ?? { primary: null, additional: [] });
      const phones = input.phones ?? { primary: null, additional: [] };
      fromPhones(phones);
      this.assertEmailFree(emails.primary, id);
      this.assertCompanyExists(input.companyId);
      const now = this.now();
      return {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        firstName: input.firstName,
        lastName: input.lastName,
        emails,
        phones,
        jobTitle: input.jobTitle ?? null,
        companyId: input.companyId ?? null,
      };
    });
  }

  async updatePerson(id: string, input: UpdatePersonInput): Promise<CrmPerson> {
    this.guard();
    const person = this.existing(this.people, id);
    const emails = input.emails ? this.normalizeEmails(input.emails) : person.emails;
    if (input.phones) fromPhones(input.phones);
    this.assertEmailFree(emails.primary, id);
    this.assertCompanyExists(input.companyId);
    const updated: CrmPerson = {
      ...person,
      firstName: input.firstName ?? person.firstName,
      lastName: input.lastName ?? person.lastName,
      emails,
      phones: input.phones ?? person.phones,
      jobTitle: input.jobTitle === undefined ? person.jobTitle : input.jobTitle,
      companyId: input.companyId === undefined ? person.companyId : input.companyId,
      updatedAt: this.now(),
    };
    this.people.set(id, updated);
    return updated;
  }

  async getPerson(id: string): Promise<CrmPerson> {
    this.guard();
    return this.live(this.people, id);
  }

  async listPeople(options?: CrmPageOptions): Promise<CrmPage<CrmPerson>> {
    this.guard();
    return this.page([...this.people.values()], options);
  }

  async deletePerson(id: string): Promise<void> {
    this.guard();
    this.softDelete(this.people, id);
  }

  async restorePerson(id: string): Promise<CrmPerson> {
    this.guard();
    return this.restore(this.people, id);
  }

  async mergePeople(input: {
    winnerId: string;
    loserIds: string[];
  }): Promise<CrmMergeResult<CrmPerson>> {
    this.guard();
    const { winner, losers, removedIds } = this.prepareMerge(this.people, input);

    const merged = losers.reduce<CrmPerson>(
      (current, loser) => ({
        ...current,
        emails: mergeValues(current.emails, loser.emails),
        phones: mergeValues(current.phones, loser.phones),
        jobTitle: current.jobTitle ?? loser.jobTitle,
        companyId: current.companyId ?? loser.companyId,
      }),
      winner,
    );

    for (const loserId of removedIds) {
      this.people.delete(loserId);
      this.repoint("person", loserId, winner.id);
      this.reassign(this.opportunities, loserId, winner.id, "pointOfContactId");
    }
    return { merged: this.save(this.people, merged), removedIds };
  }

  // --- Opportunités ------------------------------------------------------------------------------

  async createOpportunity(input: CreateOpportunityInput): Promise<CrmOpportunity> {
    this.guard();
    if (input.amount) fromAmount(input.amount);
    if (input.closeDate) fromCloseDate(input.closeDate);
    this.assertCompanyExists(input.companyId);
    this.assertPersonExists(input.pointOfContactId);
    return this.replayOr(this.opportunities, input.id, (id) => {
      const now = this.now();
      return {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        name: input.name,
        stage: input.stage ?? "NEW",
        amount: input.amount ?? null,
        closeDate: input.closeDate ?? null,
        companyId: input.companyId ?? null,
        pointOfContactId: input.pointOfContactId ?? null,
      };
    });
  }

  async updateOpportunity(id: string, input: UpdateOpportunityInput): Promise<CrmOpportunity> {
    this.guard();
    const opportunity = this.existing(this.opportunities, id);
    if (input.amount) fromAmount(input.amount);
    if (input.closeDate) fromCloseDate(input.closeDate);
    this.assertCompanyExists(input.companyId);
    this.assertPersonExists(input.pointOfContactId);
    const updated: CrmOpportunity = {
      ...opportunity,
      name: input.name ?? opportunity.name,
      stage: input.stage ?? opportunity.stage,
      amount: input.amount === undefined ? opportunity.amount : input.amount,
      closeDate: input.closeDate === undefined ? opportunity.closeDate : input.closeDate,
      companyId: input.companyId === undefined ? opportunity.companyId : input.companyId,
      pointOfContactId:
        input.pointOfContactId === undefined
          ? opportunity.pointOfContactId
          : input.pointOfContactId,
      updatedAt: this.now(),
    };
    this.opportunities.set(id, updated);
    return updated;
  }

  async getOpportunity(id: string): Promise<CrmOpportunity> {
    this.guard();
    return this.live(this.opportunities, id);
  }

  async listOpportunities(options?: CrmPageOptions): Promise<CrmPage<CrmOpportunity>> {
    this.guard();
    return this.page([...this.opportunities.values()], options);
  }

  async deleteOpportunity(id: string): Promise<void> {
    this.guard();
    this.softDelete(this.opportunities, id);
  }

  async restoreOpportunity(id: string): Promise<CrmOpportunity> {
    this.guard();
    return this.restore(this.opportunities, id);
  }

  // --- Notes et tâches ---------------------------------------------------------------------------

  private assertTargets(targets: CrmActivityTarget[]): void {
    if (targets.length === 0) {
      throw new ValidationError("Une activité doit être liée à au moins une fiche.", {
        targets: ["Choisissez une entreprise, une personne ou une opportunité."],
      });
    }
    for (const target of targets) {
      const store =
        target.type === "company"
          ? this.companies
          : target.type === "person"
            ? this.people
            : this.opportunities;
      if (!store.has(target.id)) throw new ValidationError("La fiche liée n'existe pas.");
    }
  }

  private activeTargets(activityType: "note" | "task", activityId: string): CrmActivityTarget[] {
    return [...this.links.values()].flatMap((link) =>
      link.activityType === activityType &&
      link.activityId === activityId &&
      !link.deletedAt &&
      link.target
        ? [link.target]
        : [],
    );
  }

  /** Renvoie vrai si au moins un lien a changé. */
  private syncLinks(
    activityType: "note" | "task",
    activityId: string,
    desired: CrmActivityTarget[],
  ): boolean {
    const active = [...this.links.values()].filter(
      (link) =>
        link.activityType === activityType && link.activityId === activityId && !link.deletedAt,
    );
    let changed = false;
    for (const target of desired) {
      if (active.some((link) => link.target && isSameTarget(link.target, target))) continue;
      if (
        [...this.links.values()].some(
          (link) =>
            link.activityType === activityType &&
            link.activityId === activityId &&
            !link.deletedAt &&
            link.target &&
            isSameTarget(link.target, target),
        )
      ) {
        continue; // Cible citée deux fois dans `desired`.
      }
      const now = this.now();
      const id = randomUUID();
      this.links.set(id, {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        activityType,
        activityId,
        target,
      });
      changed = true;
    }
    for (const link of active) {
      if (link.target && desired.some((target) => isSameTarget(target, link.target!))) continue;
      const now = this.now();
      this.links.set(link.id, { ...link, deletedAt: now, updatedAt: now });
      changed = true;
    }
    return changed;
  }

  private setLinksDeleted(
    activityType: "note" | "task",
    activityId: string,
    deletedAt: string,
  ): void {
    for (const link of this.links.values()) {
      if (link.activityType === activityType && link.activityId === activityId && !link.deletedAt) {
        this.links.set(link.id, { ...link, deletedAt, updatedAt: deletedAt });
      }
    }
  }

  private withNoteTargets(note: StoredNote): CrmNote {
    return { ...note, targets: note.deletedAt ? [] : this.activeTargets("note", note.id) };
  }

  private withTaskTargets(task: StoredTask): CrmTask {
    return { ...task, targets: task.deletedAt ? [] : this.activeTargets("task", task.id) };
  }

  async createNote(input: CreateNoteInput): Promise<CrmNote> {
    this.guard();
    this.assertTargets(input.targets);
    const note = this.replayOr(this.notes, input.id, (id) => {
      const now = this.now();
      return {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        title: input.title,
        bodyMarkdown: input.bodyMarkdown ?? null,
      };
    });
    this.syncLinks("note", note.id, input.targets);
    return this.withNoteTargets(note);
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<CrmNote> {
    this.guard();
    const note = this.existing(this.notes, id);
    let changed = false;
    if (input.targets !== undefined) {
      this.assertTargets(input.targets);
      this.live(this.notes, id);
      changed = this.syncLinks("note", id, input.targets);
    }
    const hasFields = input.title !== undefined || input.bodyMarkdown !== undefined;
    if (!hasFields && !changed) return this.withNoteTargets(note);
    const updated: StoredNote = {
      ...note,
      title: input.title ?? note.title,
      bodyMarkdown: input.bodyMarkdown === undefined ? note.bodyMarkdown : input.bodyMarkdown,
      updatedAt: this.now(),
    };
    this.notes.set(id, updated);
    return this.withNoteTargets(updated);
  }

  async getNote(id: string): Promise<CrmNote> {
    this.guard();
    return this.withNoteTargets(this.live(this.notes, id));
  }

  async listNotes(options?: CrmPageOptions): Promise<CrmPage<CrmNote>> {
    this.guard();
    const page = this.page([...this.notes.values()], options);
    return { ...page, items: page.items.map((note) => this.withNoteTargets(note)) };
  }

  async deleteNote(id: string): Promise<void> {
    this.guard();
    const deletedAt = this.softDelete(this.notes, id);
    this.setLinksDeleted("note", id, deletedAt);
  }

  async createTask(input: CreateTaskInput): Promise<CrmTask> {
    this.guard();
    this.assertTargets(input.targets);
    const task = this.replayOr(this.tasks, input.id, (id) => {
      const now = this.now();
      return {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        title: input.title,
        bodyMarkdown: input.bodyMarkdown ?? null,
        status: input.status ?? "TODO",
        dueAt: input.dueAt ?? null,
      };
    });
    this.syncLinks("task", task.id, input.targets);
    return this.withTaskTargets(task);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<CrmTask> {
    this.guard();
    const task = this.existing(this.tasks, id);
    let changed = false;
    if (input.targets !== undefined) {
      this.assertTargets(input.targets);
      this.live(this.tasks, id);
      changed = this.syncLinks("task", id, input.targets);
    }
    const hasFields =
      input.title !== undefined ||
      input.bodyMarkdown !== undefined ||
      input.status !== undefined ||
      input.dueAt !== undefined;
    if (!hasFields && !changed) return this.withTaskTargets(task);
    const updated: StoredTask = {
      ...task,
      title: input.title ?? task.title,
      bodyMarkdown: input.bodyMarkdown === undefined ? task.bodyMarkdown : input.bodyMarkdown,
      status: input.status ?? task.status,
      dueAt: input.dueAt === undefined ? task.dueAt : input.dueAt,
      updatedAt: this.now(),
    };
    this.tasks.set(id, updated);
    return this.withTaskTargets(updated);
  }

  completeTask(id: string): Promise<CrmTask> {
    return this.updateTask(id, { status: "DONE" });
  }

  async getTask(id: string): Promise<CrmTask> {
    this.guard();
    return this.withTaskTargets(this.live(this.tasks, id));
  }

  async listTasks(options?: CrmPageOptions): Promise<CrmPage<CrmTask>> {
    this.guard();
    const page = this.page([...this.tasks.values()], options);
    return { ...page, items: page.items.map((task) => this.withTaskTargets(task)) };
  }

  async deleteTask(id: string): Promise<void> {
    this.guard();
    const deletedAt = this.softDelete(this.tasks, id);
    this.setLinksDeleted("task", id, deletedAt);
  }

  async listActivityLinks(
    options: CrmPageOptions & { activityType: "note" | "task" },
  ): Promise<CrmPage<CrmActivityLink>> {
    this.guard();
    const links = [...this.links.values()].filter(
      (link) => link.activityType === options.activityType,
    );
    return this.page(links, options);
  }

  // --- Mécanique commune --------------------------------------------------------------------------

  private page<T extends Stored>(records: T[], options: CrmPageOptions = {}): CrmPage<T> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const since = options.updatedSince ? Date.parse(options.updatedSince) : null;
    const sorted = records
      .filter((record) => options.includeDeleted || !record.deletedAt)
      .filter((record) => since === null || Date.parse(record.updatedAt) >= since)
      .sort(
        (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || a.id.localeCompare(b.id),
      );
    const start = options.cursor ? Number(options.cursor) : 0;
    const items = sorted.slice(start, start + limit);
    const end = start + items.length;
    return { items, nextCursor: end < sorted.length ? String(end) : null };
  }

  private softDelete<T extends Stored>(store: Map<string, T>, id: string): string {
    const record = this.live(store, id);
    const now = this.now();
    store.set(id, { ...record, deletedAt: now, updatedAt: now });
    return now;
  }

  private restore<T extends Stored>(store: Map<string, T>, id: string): T {
    const record = this.existing(store, id);
    return this.save(store, { ...record, deletedAt: null });
  }

  private save<T extends Stored>(store: Map<string, T>, record: T): T {
    const saved = { ...record, updatedAt: this.now() };
    store.set(record.id, saved);
    return saved;
  }

  private prepareMerge<T extends Stored>(
    store: Map<string, T>,
    { winnerId, loserIds }: { winnerId: string; loserIds: string[] },
  ): { winner: T; losers: T[]; removedIds: string[] } {
    const removedIds = [...new Set(loserIds)].filter((id) => id !== winnerId);
    if (removedIds.length === 0 || removedIds.length + 1 > MAX_MERGE_RECORDS) {
      throw new ValidationError(`Une fusion porte sur 2 à ${MAX_MERGE_RECORDS} fiches.`);
    }
    return {
      winner: this.live(store, winnerId),
      losers: removedIds.map((id) => this.live(store, id)),
      removedIds,
    };
  }

  private repoint(type: CrmActivityTarget["type"], fromId: string, toId: string): void {
    for (const link of this.links.values()) {
      if (link.target?.type === type && link.target.id === fromId) {
        this.links.set(link.id, {
          ...link,
          target: { type, id: toId },
          updatedAt: this.now(),
        });
      }
    }
  }

  private reassign<T extends Stored, K extends keyof T>(
    store: Map<string, T>,
    fromId: string,
    toId: string,
    key: K,
  ): void {
    for (const record of store.values()) {
      if (record[key] === fromId) {
        store.set(record.id, { ...record, [key]: toId, updatedAt: this.now() });
      }
    }
  }
}

function mergeValues(winner: CrmMultiValue, loser: CrmMultiValue): CrmMultiValue {
  const primary = winner.primary ?? loser.primary;
  const candidates = [
    ...winner.additional,
    ...(loser.primary && loser.primary !== primary ? [loser.primary] : []),
    ...loser.additional,
  ];
  return { primary, additional: [...new Set(candidates)] };
}
