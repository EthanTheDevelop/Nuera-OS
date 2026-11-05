import { recordAudit } from "@/modules/audit/audit.service";
import {
  listAppointmentsForPortal,
  type PortalAppointment,
} from "@/modules/appointments/appointment.service";
import { listContractsForPortal } from "@/modules/contracts/contract.service";
import type { PortalContractRow } from "@/modules/contracts/contract.types";
import { getPortalIdentity, type PortalIdentity } from "@/modules/crm/contact.portal";
import {
  assertDocumentReadable,
  listDocumentsForPortal,
} from "@/modules/documents/document.service";
import type { PortalDocumentRow } from "@/modules/documents/document.types";
import { listInvoicesForPortal } from "@/modules/finance/finance.service";
import { getProjectPaymentsForPortal, type PortalPayments } from "@/modules/finance/finance.portal";
import { getPortalUnreadCount, sendPortalMessage } from "@/modules/messaging/message.service";
import {
  markRequirementReceived,
  recordDeliverableReview,
} from "@/modules/projects/project.service";
import {
  getProjectForPortal,
  listProjectsForPortal,
  type PortalDeliverable,
  type PortalProjectDetail,
  type PortalProjectSummary,
  type PortalReadScope,
} from "@/modules/projects/project.portal";
import { listSitesForPortal, type PortalSite } from "@/modules/sites/site.portal";
import {
  createTicketFromPortal,
  listTicketsForPortal,
  type PortalTicketRow,
} from "@/modules/support/ticket.service";
import {
  listClientDevices,
  renameClientAccount,
  type ClientDevice,
} from "@/modules/users/client-account.service";
import type { PortalContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { firstNameOf, joinNames } from "./portal.format";
import * as repository from "./portal.repository";
import {
  requirementTextSchema,
  siteChangeSchema,
  updateProfileSchema,
  type RequirementTextInput,
  type SiteChangeInput,
  type UpdateProfileInput,
} from "./portal.schema";

/** Plafond de lecture d'une fiche : un projet n'a pas des centaines de documents partagés. */
const PROJECT_DOCUMENTS_PAGE = { page: 1, pageSize: 100 };

// --- Préférences -------------------------------------------------------------------------------

export type PortalPreferenceValues = repository.PreferenceValues;

const DEFAULT_PREFERENCES: PortalPreferenceValues = {
  notifyMessage: true,
  notifyValidation: true,
  notifyInvoice: true,
  notifyRequirement: true,
  notifyReport: true,
};

/**
 * Préférences d'e-mail d'un client, pour les automatisations. Sans ligne : tout est activé, comme les
 * valeurs par défaut de la table.
 */
export async function getPortalPreferences(
  db: Database,
  userId: string,
): Promise<PortalPreferenceValues> {
  const row = await repository.findPreferences(db, userId);
  if (!row) return DEFAULT_PREFERENCES;
  return {
    notifyMessage: row.notifyMessage,
    notifyValidation: row.notifyValidation,
    notifyInvoice: row.notifyInvoice,
    notifyRequirement: row.notifyRequirement,
    notifyReport: row.notifyReport,
  };
}

export interface PortalRecipient {
  userId: string;
  email: string;
  name: string;
  preferences: PortalPreferenceValues;
}

/** Clients à l'accès valide d'une entreprise, avec leurs préférences (automatisations). */
export async function listPortalRecipients(
  db: Database,
  companyId: string,
): Promise<PortalRecipient[]> {
  const rows = await repository.listRecipients(db, companyId);
  return rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    name: row.name,
    preferences: {
      notifyMessage: row.notifyMessage ?? true,
      notifyValidation: row.notifyValidation ?? true,
      notifyInvoice: row.notifyInvoice ?? true,
      notifyRequirement: row.notifyRequirement ?? true,
      notifyReport: row.notifyReport ?? true,
    },
  }));
}

export async function updatePortalProfile(
  ctx: PortalContext,
  rawInput: UpdateProfileInput,
): Promise<void> {
  const { name, ...preferences } = parseInput(updateProfileSchema, rawInput);
  await ctx.db.transaction(async (tx) => {
    await renameClientAccount(tx, ctx.actor.userId, name);
    await repository.upsertPreferences(tx, ctx.actor.userId, preferences);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "portal.preferences_updated",
      entityType: "portal_preferences",
      entityId: ctx.actor.userId,
      metadata: { ...preferences },
    });
  });
}

export interface PortalProfile {
  identity: PortalIdentity;
  preferences: PortalPreferenceValues;
  devices: ClientDevice[];
}

export async function getPortalProfile(ctx: PortalContext): Promise<PortalProfile> {
  const [identity, preferences, devices] = await Promise.all([
    getPortalIdentity(ctx),
    getPortalPreferences(ctx.db, ctx.actor.userId),
    listClientDevices(ctx.db, ctx.actor.userId),
  ]);
  return { identity, preferences, devices };
}

// --- Mon projet --------------------------------------------------------------------------------

export interface PortalDeliverableView extends PortalDeliverable {
  /** Le fichier, seulement s'il est partagé au client : un document interne reste invisible. */
  document: Pick<
    PortalDocumentRow,
    "id" | "title" | "filename" | "mimeType" | "downloadHref"
  > | null;
}

export interface PortalProjectHome {
  project: Omit<PortalProjectDetail, "deliverables">;
  deliverables: PortalDeliverableView[];
  payments: PortalPayments;
  nextAppointment: PortalAppointment | null;
  /** « Hugo et Camille », à défaut « Nuera Studio ». */
  interlocutorNames: string;
}

/** Tout l'écran C3 pour un projet déjà contrôlé. Partagé avec l'aperçu de l'agence. */
export async function loadProjectHome(
  ctx: PortalContext,
  projectId: string,
  now: Date = new Date(),
): Promise<PortalProjectHome> {
  const detail = await getProjectForPortal(ctx, projectId);
  const [documents, payments, appointments] = await Promise.all([
    listDocumentsForPortal(ctx, { projectId: detail.id }, PROJECT_DOCUMENTS_PAGE),
    getProjectPaymentsForPortal(ctx, detail.id, { soldCents: detail.soldCents, now }),
    listAppointmentsForPortal(ctx, { limit: 50 }),
  ]);
  const readable = new Map(documents.items.map((row) => [row.id, row]));
  const { deliverables, ...project } = detail;
  const nextAppointment =
    appointments
      .filter((row) => row.status === "planned" && row.startsAt.getTime() >= now.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
  return {
    project,
    deliverables: deliverables.map((item) => ({
      ...item,
      document: item.documentId ? (readable.get(item.documentId) ?? null) : null,
    })),
    payments,
    nextAppointment,
    interlocutorNames: joinNames(detail.interlocutors.map((row) => firstNameOf(row.fullName))),
  };
}

export interface PortalNextAction {
  label: string;
  href: string;
}

const lowerFirst = (value: string) => value.charAt(0).toLocaleLowerCase("fr-FR") + value.slice(1);

export function nextActionOf(home: PortalProjectHome | null): PortalNextAction | null {
  if (!home) return null;
  const toValidate = home.deliverables.find((item) => item.status === "to_validate");
  if (toValidate) {
    return { label: `À vous : valider ${lowerFirst(toValidate.title)}`, href: "/espace#a-valider" };
  }
  const expected = home.project.requirements.find((item) => item.status === "expected");
  if (expected) {
    return { label: `À vous : ${lowerFirst(expected.label)}`, href: "/espace#a-vous" };
  }
  return null;
}

export interface PortalHome {
  identity: PortalIdentity;
  notificationsOn: boolean;
  unread: number;
  projects: PortalProjectSummary[];
  /** `null` : le compte n'a encore aucun projet. */
  home: PortalProjectHome | null;
  nextAction: PortalNextAction | null;
  sites: PortalSite[];
}

/** Le projet affiché : celui demandé s'il est bien à ce client, sinon le plus récent encore ouvert. */
function pickProject(
  projects: readonly PortalProjectSummary[],
  requested: string | null | undefined,
): PortalProjectSummary | null {
  return (
    projects.find((project) => project.id === requested) ??
    projects.find((project) => project.stage !== "closed") ??
    projects[0] ??
    null
  );
}

export async function getPortalHome(
  ctx: PortalContext,
  options: { selectedProjectId?: string | null; now?: Date } = {},
): Promise<PortalHome> {
  const [identity, preferences, unread, projects, sites] = await Promise.all([
    getPortalIdentity(ctx),
    getPortalPreferences(ctx.db, ctx.actor.userId),
    getPortalUnreadCount(ctx),
    listProjectsForPortal(ctx),
    listSitesForPortal(ctx),
  ]);
  const selected = pickProject(projects, options.selectedProjectId);
  const home = selected ? await loadProjectHome(ctx, selected.id, options.now) : null;
  return {
    identity,
    notificationsOn: Object.values(preferences).some(Boolean),
    unread,
    projects,
    home,
    nextAction: nextActionOf(home),
    sites,
  };
}

/** Le projet demandé est-il bien celui de ce client ? Sinon 404, comme partout. */
export async function assertPortalProject(
  scope: PortalReadScope,
  projectId: string,
): Promise<void> {
  const projects = await listProjectsForPortal(scope);
  if (!projects.some((project) => project.id === projectId)) {
    throw new NotFoundError("Projet introuvable.");
  }
}

// --- Écritures de Mon projet -------------------------------------------------------------------

export async function submitDeliverableReview(
  ctx: PortalContext,
  input: {
    deliverableId: string;
    decision: "validated" | "changes_requested";
    comment?: string | null;
  },
): Promise<{ overIncludedRounds: boolean }> {
  if (input.decision === "changes_requested" && !input.comment?.trim()) {
    const message = "Dites-nous ce que vous souhaitez changer.";
    throw new ValidationError(message, { comment: [message] });
  }
  const { outOfScopeChangeRequest } = await recordDeliverableReview(ctx, input);
  return { overIncludedRounds: outOfScopeChangeRequest !== null };
}

/** Un fichier déposé pour un contenu attendu : il doit être lisible par ce client et sur ce projet. */
export async function submitRequirementDocument(
  ctx: PortalContext,
  input: { requirementId: string; documentId: string },
): Promise<void> {
  await assertDocumentReadable(ctx, input.documentId);
  await markRequirementReceived(ctx, input);
}

/**
 * Un contenu transmis par écrit (horaires, adresse) : la table n'a pas de champ texte, il arrive donc
 * dans la conversation de l'agence, et le contenu passe à reçu.
 */
export async function submitRequirementText(
  ctx: PortalContext,
  rawInput: RequirementTextInput,
): Promise<void> {
  const input = parseInput(requirementTextSchema, rawInput);
  // D'abord le contrôle : le contenu d'un autre client répond 404, et aucun message ne part.
  const requirement = await markRequirementReceived(ctx, { requirementId: input.requirementId });
  await sendPortalMessage(ctx, { body: `${requirement.label}\n\n${input.text}` });
}

// --- Mon site ----------------------------------------------------------------------------------

export interface PortalSitePage {
  sites: PortalSite[];
  site: PortalSite | null;
  tickets: PortalTicketRow[];
  contracts: PortalContractRow[];
}

export async function getPortalSitePage(
  ctx: PortalContext,
  requestedSiteId?: string | null,
): Promise<PortalSitePage> {
  const [sites, tickets, contracts] = await Promise.all([
    listSitesForPortal(ctx),
    listTicketsForPortal(ctx, { limit: 50 }),
    listContractsForPortal(ctx),
  ]);
  const site = sites.find((row) => row.id === requestedSiteId) ?? sites[0] ?? null;
  return {
    sites,
    site,
    tickets: tickets.filter((row) => !site || row.siteId === null || row.siteId === site.id),
    contracts: contracts.filter(
      (row) => !site || row.sites.length === 0 || row.sites.some((link) => link.siteId === site.id),
    ),
  };
}

/** « Modifier mon site » : une demande de changement, reçue côté agence comme toute demande. */
export async function requestSiteChange(
  ctx: PortalContext,
  rawInput: SiteChangeInput,
): Promise<{ id: string; number: string }> {
  const input = parseInput(siteChangeSchema, rawInput);
  const summary = input.current.replace(/\s+/g, " ").slice(0, 120);
  const ticket = await createTicketFromPortal(ctx, {
    siteId: input.siteId,
    subject: summary,
    description: `Version actuelle :\n${input.current}\n\nNouvelle version :\n${input.next}`,
    category: "change",
  });
  return { id: ticket.id, number: ticket.number };
}

// --- Documents ---------------------------------------------------------------------------------

export const PORTAL_DOCUMENT_FILTERS = [
  "tous",
  "contrats",
  "factures",
  "maquettes",
  "fichiers",
] as const;
export type PortalDocumentFilter = (typeof PORTAL_DOCUMENT_FILTERS)[number];

export function parseDocumentFilter(value: string | undefined): PortalDocumentFilter {
  return PORTAL_DOCUMENT_FILTERS.find((filter) => filter === value) ?? "tous";
}

const COMMERCIAL_KINDS = ["quote", "contract"] as const;
const DESIGN_KINDS = ["mockup", "deliverable"] as const;
const OTHER_KINDS = [
  ...COMMERCIAL_KINDS,
  ...DESIGN_KINDS,
  "brief",
  "minutes",
  "client_file",
  "other",
] as const;

export interface PortalInvoiceCard {
  id: string;
  kind: "invoice" | "credit_note";
  label: string;
  amountCents: number;
  status: "issued" | "overdue" | "paid";
  issuedOn: string | null;
  dueOn: string | null;
  paidOn: string | null;
  /** Lien de téléchargement, seulement si le fichier est bien partagé à ce client. */
  downloadHref: string | null;
}

export interface PortalDocumentsPage {
  filter: PortalDocumentFilter;
  invoices: PortalInvoiceCard[];
  documents: PortalDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  hasAnyFile: boolean;
}

const toFilterInput = (filter: PortalDocumentFilter) => {
  switch (filter) {
    case "contrats":
      return { kinds: [...COMMERCIAL_KINDS] };
    case "maquettes":
      return { kinds: [...DESIGN_KINDS] };
    case "fichiers":
      return { uploadedByClient: true };
    case "factures":
      return { kinds: ["invoice" as const] };
    case "tous":
      return { kinds: [...OTHER_KINDS] };
  }
};

/**
 * C6. Une facture vient de `listInvoicesForPortal` (montant, état) ; son fichier éventuel n'apparaît
 * pas deux fois. Une facture sans fichier partagé reste listée, sans téléchargement.
 */
export async function getPortalDocumentsPage(
  ctx: PortalContext,
  options: { filter: PortalDocumentFilter; page?: number; now?: Date },
): Promise<PortalDocumentsPage> {
  const page = options.page ?? 1;
  const showInvoices = options.filter === "tous" || options.filter === "factures";
  const [listed, invoiceFiles, invoices, anyFile] = await Promise.all([
    listDocumentsForPortal(ctx, toFilterInput(options.filter), { page, pageSize: 24 }),
    showInvoices
      ? listDocumentsForPortal(ctx, { kinds: ["invoice"] }, { page: 1, pageSize: 100 })
      : null,
    showInvoices ? listInvoicesForPortal(ctx, options.now) : [],
    listDocumentsForPortal(ctx, {}, { page: 1, pageSize: 1 }),
  ]);
  const files = new Map((invoiceFiles?.items ?? []).map((row) => [row.id, row]));
  const linked = new Set(invoices.map((row) => row.documentId));
  return {
    filter: options.filter,
    invoices:
      page === 1
        ? invoices.flatMap((row) =>
            row.status === "cancelled"
              ? []
              : [
                  {
                    id: row.id,
                    kind: row.kind,
                    label: row.label ?? row.externalRef ?? "sans référence",
                    amountCents: row.amountCents,
                    status: row.status,
                    issuedOn: row.issuedOn,
                    dueOn: row.dueOn,
                    paidOn: row.paidOn,
                    downloadHref: row.documentId
                      ? (files.get(row.documentId)?.downloadHref ?? null)
                      : null,
                  },
                ],
          )
        : [],
    documents: [
      ...listed.items.filter((row) => !linked.has(row.id)),
      // « Tous » lit les autres types : une facture sans ligne financière y garde sa place.
      ...(options.filter === "tous" && page === 1
        ? (invoiceFiles?.items ?? []).filter((row) => !linked.has(row.id))
        : []),
    ],
    total: listed.total,
    page: listed.page,
    pageSize: listed.pageSize,
    hasAnyFile: anyFile.total > 0,
  };
}

/** Rendez-vous de ce client, pour le fichier agenda. Un autre ou un annulé : 404. */
export async function getPortalAppointment(
  ctx: PortalContext,
  appointmentId: string,
): Promise<PortalAppointment> {
  const rows = await listAppointmentsForPortal(ctx, { limit: 100 });
  const appointment = rows.find((row) => row.id === appointmentId);
  if (!appointment) throw new NotFoundError("Rendez-vous introuvable.");
  return appointment;
}
