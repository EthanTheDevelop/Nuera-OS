import {
  assertAcceptableFilename,
  discardStoredFile,
  getMaxUploadBytes,
  getStorage,
  ingestFile,
  isStorageConfigured,
  type FileStorage,
  type StoredFile,
} from "@/integrations/storage";
import type { DocumentKind, DocumentVisibility } from "@/lib/domain-enums";
import { recordAudit } from "@/modules/audit/audit.service";
import { listCompanyOptions, type CompanyOption } from "@/modules/crm/company.lookup";
import { getAssignedProjectIds, getMemberIdForUser } from "@/modules/team/team.lookup";
import { assertCan, assertCanAny, can } from "@/server/auth/permissions";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Document, DocumentVersion } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parsePagination, type PageParams, type Paginated } from "@/server/pagination";
import { parseInput } from "@/server/validation";
import { documentDownloadHref, documentLinkLabel, isPreviewable } from "./document.format";
import * as repository from "./document.repository";
import {
  attachDocumentSchema,
  documentFilterSchema,
  documentIdSchema,
  documentReferenceSchema,
  documentsForSchema,
  documentStatusSchema,
  documentVisibilitySchema,
  portalDocumentFilterSchema,
  updateDocumentSchema,
  uploadClientFileSchema,
  uploadDocumentSchema,
  uploadVersionSchema,
  type DocumentFilterInput,
  type DocumentsForInput,
  type PortalDocumentFilterInput,
  type UpdateDocumentInput,
  type UploadClientFileInput,
  type UploadDocumentInput,
  type UploadVersionInput,
} from "./document.schema";
import { assertDocumentTransition, statusAfterNewVersion } from "./document.status";
import type {
  CompanyLinkOptions,
  DocumentRow,
  DocumentSummary,
  DocumentVersionRow,
  PortalDocumentRow,
  UploadedDocument,
} from "./document.types";

/** Stockage et limite, remplaçables par les tests ; par défaut ceux de l'environnement. */
export interface StorageDeps {
  storage?: FileStorage;
  maxBytes?: number;
}

function storageOf(deps: StorageDeps = {}) {
  return { storage: deps.storage ?? getStorage(), maxBytes: deps.maxBytes ?? getMaxUploadBytes() };
}

export interface UploadResult {
  document: Document;
  version: DocumentVersion;
  /** `false` : contenu identique déjà présent, rien n'a été créé. */
  created: boolean;
}

/** Réponse de la route de dépôt. */
export function toUploadedDocument(result: UploadResult): UploadedDocument {
  return {
    id: result.document.id,
    title: result.document.title,
    version: result.version.version,
    filename: result.version.filename,
    sizeBytes: result.version.sizeBytes,
    created: result.created,
  };
}

function isPortalContext(ctx: ServiceContext | PortalContext): ctx is PortalContext {
  return "companyId" in ctx && "contactId" in ctx;
}

const READ_PERMISSIONS = ["documents:read", "documents:read_assigned"] as const;

/** Périmètre de lecture du rôle. Le `read_assigned` d'un prestataire se résout dans la requête. */
async function readScope(ctx: ServiceContext): Promise<repository.DocumentScope> {
  assertCanAny(ctx.actor, READ_PERMISSIONS);
  if (can(ctx.actor, "documents:read")) {
    return can(ctx.actor, "finance:read")
      ? { kind: "all" }
      : { kind: "all", invoicesOfUserId: ctx.actor.userId };
  }
  return {
    kind: "assigned",
    projectIds: await getAssignedProjectIds(ctx.db, ctx.actor),
    memberId: await getMemberIdForUser(ctx.db, ctx.actor.userId),
  };
}

/**
 * Verrouille un document à modifier. Une facture est réservée à `finance:read` et à la personne qui
 * l'a déposée : pour les autres, elle n'existe pas, en écriture comme en lecture.
 */
async function requireDocument(ctx: ServiceContext, tx: Database, id: string): Promise<Document> {
  const document = await repository.lockDocument(tx, id);
  if (!document) throw new NotFoundError("Ce document n'existe pas.");
  if (
    document.kind === "invoice" &&
    !can(ctx.actor, "finance:read") &&
    !(await repository.hasUploadedVersion(tx, id, ctx.actor.userId))
  ) {
    throw new NotFoundError("Ce document n'existe pas.");
  }
  return document;
}

// --- Rattachements -----------------------------------------------------------------------------

interface LinkInput extends repository.LinkIds {
  companyId?: string | null;
}

const LINK_LABELS: Record<string, string> = {
  projectId: "Ce projet",
  contractId: "Ce contrat",
  siteId: "Ce site",
  ticketId: "Cette demande",
  quoteId: "Ce devis",
};

/**
 * Valide les rattachements et renvoie le client qu'ils désignent : un document n'est jamais lié à
 * l'objet d'un autre client. Sans client saisi, celui de l'objet lié est repris. À la modification,
 * `current` : un lien déjà en place reste valable même si son objet a été archivé depuis.
 */
async function resolveLinks(
  db: Database,
  input: LinkInput,
  current?: Document,
): Promise<Required<LinkInput>> {
  const kept = (field: keyof repository.LinkIds) =>
    Boolean(current && input[field] && input[field] === current[field]);
  const owners = await repository.findLinkCompanies(db, {
    projectId: kept("projectId") ? null : input.projectId,
    contractId: kept("contractId") ? null : input.contractId,
    siteId: kept("siteId") ? null : input.siteId,
    ticketId: kept("ticketId") ? null : input.ticketId,
    quoteId: kept("quoteId") ? null : input.quoteId,
  });
  const errors: Record<string, string[]> = {};
  let companyId = input.companyId ?? null;

  for (const field of Object.keys(LINK_LABELS)) {
    const requested = input[field as keyof repository.LinkIds];
    if (!requested) continue;
    const owner = kept(field as keyof repository.LinkIds) ? current?.companyId : owners[field];
    if (!owner) {
      errors[field] = [`${LINK_LABELS[field]} n'existe pas ou a été archivé.`];
      continue;
    }
    companyId ??= owner;
    if (owner !== companyId)
      errors[field] = [`${LINK_LABELS[field]} n'appartient pas à ce client.`];
  }
  if (
    companyId &&
    companyId !== current?.companyId &&
    !(await repository.isCompanyActive(db, companyId))
  ) {
    errors.companyId = ["Ce client n'existe pas ou a été archivé."];
  }
  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Certains rattachements sont invalides.", errors);
  }
  return {
    companyId,
    projectId: input.projectId ?? null,
    contractId: input.contractId ?? null,
    siteId: input.siteId ?? null,
    ticketId: input.ticketId ?? null,
    quoteId: input.quoteId ?? null,
  };
}

function assertShareable(visibility: DocumentVisibility, companyId: string | null): void {
  if (visibility === "client" && !companyId) {
    const message = "Choisissez un client pour partager ce document.";
    throw new ValidationError(message, { visibility: [message] });
  }
}

// --- Création ----------------------------------------------------------------------------------

interface NewDocument extends Required<LinkInput> {
  title: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  status: Document["status"];
  note?: string | null;
  uploadedByClient?: boolean;
  actorId: string;
  action: "document.created" | "portal.document_uploaded";
}

/**
 * Crée le document et sa première version dans une transaction. Un dépôt identique répété (double
 * clic, nouvelle tentative) renvoie le document existant : `created` vaut `false`.
 */
async function createDocument(
  db: Database,
  input: NewDocument,
  file: StoredFile,
): Promise<UploadResult> {
  return db.transaction(async (tx) => {
    const idempotencyKey = [
      input.title,
      file.sha256,
      input.companyId,
      input.projectId,
      input.contractId,
      input.siteId,
      input.ticketId,
      input.quoteId,
    ].join("|");
    await repository.lockIdempotencyKey(tx, idempotencyKey);

    const identical = await repository.findIdenticalDocument(tx, {
      title: input.title,
      sha256: file.sha256,
      uploadedByClient: input.uploadedByClient ?? false,
      companyId: input.companyId,
      projectId: input.projectId,
      contractId: input.contractId,
      siteId: input.siteId,
      ticketId: input.ticketId,
      quoteId: input.quoteId,
    });
    if (identical) return { ...identical, created: false };

    const created = await repository.insertDocument(tx, {
      companyId: input.companyId,
      projectId: input.projectId,
      contractId: input.contractId,
      siteId: input.siteId,
      ticketId: input.ticketId,
      quoteId: input.quoteId,
      title: input.title,
      kind: input.kind,
      visibility: input.visibility,
      status: input.status,
      uploadedByClient: input.uploadedByClient ?? false,
    });
    const version = await repository.insertVersion(tx, {
      documentId: created.id,
      version: 1,
      storageKey: file.storageKey,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      uploadedByUserId: input.actorId,
      note: input.note ?? null,
    });
    const document = await repository.updateDocument(tx, created.id, {
      currentVersionId: version.id,
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: input.action,
      entityType: "document",
      entityId: document.id,
      metadata: {
        title: document.title,
        kind: document.kind,
        visibility: document.visibility,
        companyId: document.companyId,
        projectId: document.projectId,
        sha256: file.sha256,
      },
    });
    return { document, version, created: true };
  });
}

/**
 * Dépose un fichier dans le stockage et renvoie sa description, pour un service qui l'attache
 * ensuite (`attachDocument`). Préférer `uploadDocument`, qui fait les deux.
 */
export async function storeDocumentFile(
  ctx: ServiceContext,
  input: { filename: string },
  source: ReadableStream<Uint8Array>,
  deps?: StorageDeps,
): Promise<StoredFile> {
  assertCanAny(ctx.actor, ["documents:create", "documents:update"]);
  const { storage, maxBytes } = storageOf(deps);
  return ingestFile(storage, source, { filename: input.filename, maxBytes });
}

/** Dépose un fichier et crée le document qui le porte, en version 1. */
export async function uploadDocument(
  ctx: ServiceContext,
  input: UploadDocumentInput,
  source: ReadableStream<Uint8Array>,
  deps?: StorageDeps,
): Promise<UploadResult> {
  assertCan(ctx.actor, "documents:create");
  const data = parseInput(uploadDocumentSchema, input);
  assertAcceptableFilename(data.filename);
  const links = await resolveLinks(ctx.db, data);
  assertShareable(data.visibility, links.companyId);

  const { storage, maxBytes } = storageOf(deps);
  const file = await ingestFile(storage, source, { filename: data.filename, maxBytes });
  try {
    const result = await createDocument(
      ctx.db,
      {
        ...links,
        title: data.title,
        kind: data.kind,
        visibility: data.visibility,
        status: data.status,
        note: data.note,
        actorId: ctx.actor.userId,
        action: "document.created",
      },
      file,
    );
    if (!result.created) await discardStoredFile(storage, file.storageKey);
    return result;
  } catch (error) {
    await discardStoredFile(storage, file.storageKey);
    throw error;
  }
}

/**
 * Crée un document et sa première version, rattachés à leur objet, à partir d'un fichier déjà
 * déposé (`storeDocumentFile`). Idempotent : la même clé de stockage renvoie le même document.
 */
export async function attachDocument(
  ctx: ServiceContext,
  input: AttachDocumentInput,
  deps?: Pick<StorageDeps, "storage">,
): Promise<Document> {
  assertCan(ctx.actor, "documents:create");
  const data = parseInput(attachDocumentSchema, input);

  const existing = await repository.findVersionByStorageKey(ctx.db, data.file.storageKey);
  if (existing) {
    const document = await repository.findDocument(ctx.db, existing.documentId, { kind: "all" });
    if (document) return document;
  }

  const links = await resolveLinks(ctx.db, data);
  assertShareable(data.visibility, links.companyId);
  const { document, created } = await createDocument(
    ctx.db,
    {
      ...links,
      title: data.title,
      kind: data.kind,
      visibility: data.visibility,
      status: data.status,
      note: data.note,
      actorId: ctx.actor.userId,
      action: "document.created",
    },
    data.file,
  );
  // Contenu déjà rattaché sous une autre clé : ce second fichier ne servira jamais.
  if (!created) await discardStoredFile(deps?.storage ?? getStorage(), data.file.storageKey);
  return document;
}

export interface AttachDocumentInput {
  title: string;
  kind: DocumentKind;
  visibility?: DocumentVisibility;
  status?: Document["status"];
  note?: string | null;
  /** Repris de l'objet lié s'il est absent ; obligatoire pour un partage sans autre rattachement. */
  companyId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
  /** Fichier déjà déposé dans le stockage ; devient la version 1. */
  file: StoredFile;
}

/**
 * Ajoute une version à un document. La nouvelle version devient la référence. Un fichier identique
 * à la référence ne crée rien (`created: false`).
 */
export async function uploadDocumentVersion(
  ctx: ServiceContext,
  input: UploadVersionInput,
  source: ReadableStream<Uint8Array>,
  deps?: StorageDeps,
): Promise<UploadResult> {
  assertCan(ctx.actor, "documents:update");
  const data = parseInput(uploadVersionSchema, input);
  assertAcceptableFilename(data.filename);

  const target = await repository.findDocument(ctx.db, data.documentId, { kind: "all" });
  if (!target) throw new NotFoundError("Ce document n'existe pas.");
  if (target.archivedAt) throw new ConflictError("Restaurez ce document avant de le modifier.");

  const { storage, maxBytes } = storageOf(deps);
  const file = await ingestFile(storage, source, { filename: data.filename, maxBytes });
  try {
    const result = await ctx.db.transaction(async (tx): Promise<UploadResult> => {
      const document = await requireDocument(ctx, tx, data.documentId);
      if (document.archivedAt) {
        throw new ConflictError("Restaurez ce document avant de le modifier.");
      }
      const current = await repository.findCurrentVersion(tx, document);
      if (current?.sha256 === file.sha256) {
        return { document, version: current, created: false };
      }
      const version = await repository.insertVersion(tx, {
        documentId: document.id,
        version: await repository.nextVersionNumber(tx, document.id),
        storageKey: file.storageKey,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        uploadedByUserId: ctx.actor.userId,
        note: data.note ?? null,
      });
      const updated = await repository.updateDocument(tx, document.id, {
        currentVersionId: version.id,
        status: statusAfterNewVersion(document.status),
      });
      await recordAudit(tx, {
        actorId: ctx.actor.userId,
        action: "document.version_added",
        entityType: "document",
        entityId: document.id,
        metadata: { version: version.version, sha256: file.sha256 },
      });
      return { document: updated, version, created: true };
    });
    if (!result.created) await discardStoredFile(storage, file.storageKey);
    return result;
  } catch (error) {
    await discardStoredFile(storage, file.storageKey);
    throw error;
  }
}

/**
 * Fichier déposé par un client depuis le portail. Le client, la visibilité et l'origine sont
 * imposés par le contexte, jamais par la saisie. Un projet ou une demande d'un autre client répond
 * comme s'il n'existait pas.
 */
export async function uploadClientFile(
  ctx: PortalContext,
  input: UploadClientFileInput,
  source: ReadableStream<Uint8Array>,
  deps?: StorageDeps,
): Promise<UploadResult> {
  const data = parseInput(uploadClientFileSchema, input);
  const { filename } = assertAcceptableFilename(data.filename);

  const owners = await repository.findLinkCompanies(ctx.db, {
    projectId: data.projectId,
    ticketId: data.ticketId,
  });
  for (const [field, requested] of [
    ["projectId", data.projectId],
    ["ticketId", data.ticketId],
  ] as const) {
    if (requested && owners[field] !== ctx.companyId) {
      throw new NotFoundError("Ce dossier n'existe pas.");
    }
  }

  const { storage, maxBytes } = storageOf(deps);
  const file = await ingestFile(storage, source, { filename, maxBytes });
  try {
    const result = await createDocument(
      ctx.db,
      {
        companyId: ctx.companyId,
        projectId: data.projectId ?? null,
        contractId: null,
        siteId: null,
        ticketId: data.ticketId ?? null,
        quoteId: null,
        title: data.title ?? filename,
        kind: "client_file",
        visibility: "client",
        status: "final",
        note: data.note,
        uploadedByClient: true,
        actorId: ctx.actor.userId,
        action: "portal.document_uploaded",
      },
      file,
    );
    if (!result.created) await discardStoredFile(storage, file.storageKey);
    return result;
  } catch (error) {
    await discardStoredFile(storage, file.storageKey);
    throw error;
  }
}

// --- Lecture -----------------------------------------------------------------------------------

/**
 * Renvoie le document s'il est lisible, sinon lève `NotFoundError`. Un `PortalContext` ne lit que
 * les documents `visibility = client` de son `companyId` : le document d'un autre client répond
 * comme s'il n'existait pas. Un `ServiceContext` applique la permission et le périmètre du rôle.
 */
export async function assertDocumentReadable(
  ctx: ServiceContext | PortalContext,
  documentId: string,
): Promise<Document> {
  const scope = isPortalContext(ctx)
    ? ({ kind: "portal", companyId: ctx.companyId } as const)
    : await readScope(ctx);
  const { id } = parseScopedId(documentId);
  const document = await repository.findDocument(ctx.db, id, scope);
  if (!document) throw new NotFoundError("Ce document n'existe pas.");
  return document;
}

/** Un identifiant mal formé est un document qui n'existe pas, pas une erreur de saisie. */
function parseScopedId(id: string): { id: string } {
  const parsed = documentIdSchema.safeParse({ id });
  if (!parsed.success) throw new NotFoundError("Ce document n'existe pas.");
  return parsed.data;
}

const toSummary = (row: DocumentRow): DocumentSummary => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  visibility: row.visibility,
  status: row.status,
  uploadedByClient: row.uploadedByClient,
  version: row.version,
  filename: row.filename,
  sizeBytes: row.sizeBytes,
  updatedAt: row.updatedAt,
  linkLabel: documentLinkLabel(row),
  downloadHref: documentDownloadHref(row.id),
});

/** Liste paginée et recherche de l'écran 23, dans le périmètre du rôle. */
export async function searchDocuments(
  ctx: ServiceContext,
  filter: DocumentFilterInput = {},
  page?: Partial<PageParams>,
): Promise<Paginated<DocumentRow>> {
  const scope = await readScope(ctx);
  const data = parseInput(documentFilterSchema, filter);
  // Un prestataire ne voit pas les archives : `scopeCondition` les exclut déjà.
  return repository.listDocuments(ctx.db, { scope, ...data }, parsePagination(page));
}

const DEFAULT_LIST_LIMIT = 50;

/**
 * Documents d'un objet : la fiche d'un client, d'un projet, d'un contrat, d'un site ou d'une
 * demande les affiche avec cette fonction. Périmètre du rôle compris.
 */
export async function listDocumentsFor(
  ctx: ServiceContext,
  input: DocumentsForInput,
): Promise<DocumentSummary[]> {
  const scope = await readScope(ctx);
  const { limit = DEFAULT_LIST_LIMIT, ...links } = parseInput(documentsForSchema, input);
  const { items } = await repository.listDocuments(
    ctx.db,
    { scope, ...links },
    { page: 1, pageSize: limit },
  );
  return items.map(toSummary);
}

/** Fiche client 360° : documents de ce client, en lignes compactes. */
export async function listDocumentsForCompany(
  ctx: ServiceContext,
  companyId: string,
  options: { limit?: number } = {},
): Promise<DocumentSummary[]> {
  return listDocumentsFor(ctx, { companyId, limit: options.limit });
}

/** Documents visibles par le client connecté. Le filtre ne peut que restreindre, jamais élargir. */
export async function listDocumentsForPortal(
  ctx: PortalContext,
  filter: PortalDocumentFilterInput = {},
  page?: Partial<PageParams>,
): Promise<Paginated<PortalDocumentRow>> {
  const data = parseInput(portalDocumentFilterSchema, filter);
  const result = await repository.listDocuments(
    ctx.db,
    {
      scope: { kind: "portal", companyId: ctx.companyId },
      kinds: data.kinds,
      uploadedByClient: data.uploadedByClient,
      projectId: data.projectId,
      ticketId: data.ticketId,
    },
    parsePagination(page),
  );
  return {
    ...result,
    items: result.items.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      uploadedByClient: row.uploadedByClient,
      projectId: row.projectId,
      version: row.version,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      updatedAt: row.updatedAt,
      downloadHref: documentDownloadHref(row.id),
    })),
  };
}

export interface DocumentDetail {
  document: DocumentRow;
  versions: DocumentVersionRow[];
}

/** Fiche d'un document, 404 hors périmètre. */
export async function getDocumentDetail(
  ctx: ServiceContext,
  documentId: string,
): Promise<DocumentDetail> {
  const scope = await readScope(ctx);
  const { id } = parseScopedId(documentId);
  const document = await repository.findDocumentRow(ctx.db, id, scope);
  if (!document) throw new NotFoundError("Ce document n'existe pas.");
  return { document, versions: await repository.listVersions(ctx.db, id) };
}

/** Historique d'un document pour la carte de l'écran 23. */
export async function listDocumentVersions(
  ctx: ServiceContext,
  documentId: string,
): Promise<DocumentVersionRow[]> {
  const { id } = await assertDocumentReadable(ctx, documentId);
  return repository.listVersions(ctx.db, id);
}

/** Objets d'un client, pour les listes de rattachement d'un formulaire. */
export async function listDocumentLinkOptions(
  ctx: ServiceContext,
  companyId: string,
): Promise<CompanyLinkOptions> {
  assertCanAny(ctx.actor, ["documents:create", "documents:update"]);
  const { id } = parseScopedId(companyId);
  return repository.listCompanyLinkOptions(ctx.db, id);
}

const COMPANY_OPTION_LIMIT = 2000;

/** Clients proposés par un formulaire de rattachement. */
export async function listDocumentCompanyOptions(ctx: ServiceContext): Promise<CompanyOption[]> {
  assertCanAny(ctx.actor, ["documents:create", "documents:update"]);
  return listCompanyOptions(ctx.db, { limit: COMPANY_OPTION_LIMIT });
}

/** Le stockage est-il configuré ? Une fenêtre de dépôt affiche sinon « connexion requise ». */
export function getDocumentStorageStatus(): { configured: boolean; maxBytes: number } {
  return { configured: isStorageConfigured(), maxBytes: getMaxUploadBytes() };
}

// --- Téléchargement ----------------------------------------------------------------------------

export interface DocumentDownload {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Aperçu demandé et permis pour ce type : le navigateur l'ouvre au lieu de l'enregistrer. */
  inline: boolean;
}

/**
 * Ouvre un fichier à télécharger, après `assertDocumentReadable`. Le portail ne reçoit que la
 * version de référence : l'historique reste interne. Chaque téléchargement ou aperçu est journalisé.
 */
export async function openDocumentDownload(
  ctx: ServiceContext | PortalContext,
  documentId: string,
  options: { version?: number; preview?: boolean } = {},
  deps: Pick<StorageDeps, "storage"> = {},
): Promise<DocumentDownload> {
  const document = await assertDocumentReadable(ctx, documentId);
  const portal = isPortalContext(ctx);
  const version =
    options.version !== undefined && !portal
      ? await repository.findVersionByNumber(ctx.db, document.id, options.version)
      : await repository.findCurrentVersion(ctx.db, document);
  if (!version) throw new NotFoundError("Cette version n'existe pas.");

  const storage = deps.storage ?? getStorage();
  const object = await storage.read(version.storageKey);
  const inline = Boolean(options.preview) && isPreviewable(version.mimeType);

  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "document.downloaded",
    entityType: "document",
    entityId: document.id,
    metadata: { version: version.version, portal, ...(inline ? { preview: true } : {}) },
  });

  return {
    stream: object.stream,
    filename: version.filename,
    mimeType: version.mimeType,
    sizeBytes: object.sizeBytes,
    inline,
  };
}

// --- Modification ------------------------------------------------------------------------------

/** Titre, type et rattachements. Le partage et le statut ont leurs propres opérations. */
export async function updateDocument(
  ctx: ServiceContext,
  input: UpdateDocumentInput,
): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id, title, kind, ...linkInput } = parseInput(updateDocumentSchema, input);
  const before = await repository.findDocument(ctx.db, id, { kind: "all" });
  if (!before) throw new NotFoundError("Ce document n'existe pas.");
  const links = await resolveLinks(ctx.db, linkInput, before);

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (document.archivedAt) throw new ConflictError("Restaurez ce document avant de le modifier.");
    if (document.companyId !== links.companyId) {
      if (document.uploadedByClient) {
        throw new ConflictError("Un fichier déposé par un client reste rattaché à ce client.");
      }
      if (document.visibility === "client") {
        const message = "Repassez ce document en interne avant de changer de client.";
        throw new ConflictError(message, { companyId: [message] });
      }
    }
    const updated = await repository.updateDocument(tx, id, { title, kind, ...links });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.updated",
      entityType: "document",
      entityId: id,
      metadata: { title, kind, ...links },
    });
    return updated;
  });
}

/** Partage au client ou retour en interne. Répéter le même choix ne change rien. */
export async function setDocumentVisibility(
  ctx: ServiceContext,
  input: { id: string; visibility: DocumentVisibility },
): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id, visibility } = parseInput(documentVisibilitySchema, input);

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (document.visibility === visibility) return document;
    if (document.archivedAt) throw new ConflictError("Restaurez ce document avant de le modifier.");
    if (document.uploadedByClient) {
      throw new ConflictError("Un fichier déposé par un client reste visible par ce client.");
    }
    assertShareable(visibility, document.companyId);
    const updated = await repository.updateDocument(tx, id, { visibility });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.visibility_changed",
      entityType: "document",
      entityId: id,
      metadata: { from: document.visibility, to: visibility, companyId: document.companyId },
    });
    return updated;
  });
}

/** Changement de statut, par la machine de `document.status.ts`. */
export async function setDocumentStatus(
  ctx: ServiceContext,
  input: { id: string; status: Document["status"] },
): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id, status } = parseInput(documentStatusSchema, input);

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (document.status === status) return document;
    if (document.archivedAt) throw new ConflictError("Restaurez ce document avant de le modifier.");
    assertDocumentTransition(document.status, status);
    const updated = await repository.updateDocument(tx, id, { status });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.updated",
      entityType: "document",
      entityId: id,
      metadata: { fromStatus: document.status, toStatus: status },
    });
    return updated;
  });
}

/** Désigne la version de référence parmi celles du document. */
export async function setReferenceVersion(
  ctx: ServiceContext,
  input: { id: string; versionId: string },
): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id, versionId } = parseInput(documentReferenceSchema, input);

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (document.currentVersionId === versionId) return document;
    if (document.archivedAt) throw new ConflictError("Restaurez ce document avant de le modifier.");
    const version = await repository.findVersionById(tx, id, versionId);
    if (!version) throw new NotFoundError("Cette version n'existe pas.");
    // Un accord porte sur une version : changer de référence le fait retomber, comme un nouveau fichier.
    const status = statusAfterNewVersion(document.status);
    const updated = await repository.updateDocument(tx, id, {
      currentVersionId: versionId,
      status,
    });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.updated",
      entityType: "document",
      entityId: id,
      metadata: {
        referenceVersion: version.version,
        fromStatus: document.status,
        toStatus: status,
      },
    });
    return updated;
  });
}

/** Archive sans rien supprimer, fichiers compris. Le portail et les prestataires ne le voient plus. */
export async function archiveDocument(ctx: ServiceContext, documentId: string): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id } = parseInput(documentIdSchema, { id: documentId });

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (document.archivedAt) return document;
    const updated = await repository.updateDocument(tx, id, { archivedAt: new Date() });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.archived",
      entityType: "document",
      entityId: id,
      metadata: { title: document.title },
    });
    return updated;
  });
}

export async function restoreDocument(ctx: ServiceContext, documentId: string): Promise<Document> {
  assertCan(ctx.actor, "documents:update");
  const { id } = parseInput(documentIdSchema, { id: documentId });

  return ctx.db.transaction(async (tx) => {
    const document = await requireDocument(ctx, tx, id);
    if (!document.archivedAt) return document;
    const updated = await repository.updateDocument(tx, id, { archivedAt: null });
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "document.restored",
      entityType: "document",
      entityId: id,
      metadata: { title: document.title },
    });
    return updated;
  });
}
