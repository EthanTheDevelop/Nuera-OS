import type {
  DocumentKind,
  DocumentStatus,
  DocumentVisibility,
  KnowledgeKind,
  OfferActivity,
  TemplateKind,
} from "@/lib/domain-enums";

/** Formes de lecture du module. Fichier de types, importable depuis l'interface et d'autres lots. */
export interface DocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  uploadedByClient: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  contractName: string | null;
  siteId: string | null;
  siteName: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  currentVersionId: string | null;
  /** Numéro de la version de référence. */
  version: number | null;
  versionCount: number;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** Ligne compacte pour une fiche d'un autre lot : client, projet, contrat, site, demande. */
export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  uploadedByClient: boolean;
  version: number | null;
  filename: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
  linkLabel: string;
  downloadHref: string;
}

/** Ligne du portail client : rien d'interne, ni note, ni auteur, ni historique. */
export interface PortalDocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  status: DocumentStatus;
  uploadedByClient: boolean;
  projectId: string | null;
  version: number | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: Date;
  downloadHref: string;
}

export interface DocumentVersionRow {
  id: string;
  version: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  note: string | null;
  authorName: string | null;
  createdAt: Date;
}

export interface LinkOption {
  id: string;
  label: string;
}

/** Objets d'un client auxquels rattacher un document. */
export interface CompanyLinkOptions {
  projects: LinkOption[];
  contracts: LinkOption[];
  sites: LinkOption[];
  tickets: LinkOption[];
  quotes: LinkOption[];
}

export interface ArticleRow {
  id: string;
  kind: KnowledgeKind;
  title: string;
  siteId: string | null;
  siteName: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectName: string | null;
  authorName: string | null;
  version: number;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface ArticleDetail extends ArticleRow {
  body: string;
}

export interface ArticleVersionRow {
  id: string;
  version: number;
  body: string;
  authorName: string | null;
  at: Date;
}

export interface TemplateRow {
  id: string;
  kind: TemplateKind;
  activity: OfferActivity | null;
  name: string;
  body: string | null;
  items: string[];
  active: boolean;
  updatedAt: Date;
}

/** Réponse JSON de la route de dépôt, lue par `useFileUpload`. */
export interface UploadedDocument {
  id: string;
  title: string;
  version: number;
  filename: string;
  sizeBytes: number;
  /** `false` : fichier identique déjà présent, rien n'a été créé. */
  created: boolean;
}
