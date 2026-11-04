import type { DocumentKind, DocumentVisibility } from "@/lib/domain-enums";
import type { PortalContext, ServiceContext } from "@/server/context";
import type { Document } from "@/server/db/schema";

export interface AttachDocumentInput {
  title: string;
  kind: DocumentKind;
  visibility?: DocumentVisibility;
  /** Obligatoire dès qu'un rattachement ci-dessous est fourni, ou pour un partage au client. */
  companyId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  siteId?: string | null;
  ticketId?: string | null;
  quoteId?: string | null;
  /** Fichier déjà déposé dans le stockage ; devient la version 1. */
  file: {
    storageKey: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  };
}

/** Crée un document et sa première version, rattachés à leur objet. */
export async function attachDocument(
  _ctx: ServiceContext,
  _input: AttachDocumentInput,
): Promise<Document> {
  throw new Error("attachDocument n'est pas implémenté : à livrer par le lot Documents.");
}

/**
 * Renvoie le document s'il est lisible, sinon lève `NotFoundError`. Un `PortalContext` ne lit que
 * les documents `visibility = client` de son `companyId` : le document d'un autre client répond
 * comme s'il n'existait pas. Un `ServiceContext` applique la permission et le périmètre du rôle.
 */
export async function assertDocumentReadable(
  _ctx: ServiceContext | PortalContext,
  _documentId: string,
): Promise<Document> {
  throw new Error("assertDocumentReadable n'est pas implémenté : à livrer par le lot Documents.");
}
