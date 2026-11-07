import type { CompanyLinkOptions, DocumentRow, LinkOption } from "./document.types";

/** Fonctions pures d'affichage, partagées par les pages, les services et les autres lots. */
export function documentDownloadHref(documentId: string, version?: number): string {
  const base = `/api/documents/${documentId}/download`;
  return version === undefined ? base : `${base}?version=${version}`;
}

/** Documents commerciaux : hors de portée d'un prestataire, même sur son projet. */
export const COMMERCIAL_DOCUMENT_KINDS = ["quote", "contract", "invoice"] as const;

/**
 * Ouvert dans le navigateur, dans un nouvel onglet. Ni SVG ni texte : un SVG peut porter du script
 * et un texte peut être interprété. Ceux-là ne sortent qu'en pièce jointe.
 */
const PREVIEWABLE_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export const isPreviewable = (mimeType: string | null | undefined): boolean =>
  PREVIEWABLE_TYPES.includes(mimeType ?? "");

export function documentPreviewHref(documentId: string, version?: number): string {
  const params = new URLSearchParams({ apercu: "1" });
  if (version !== undefined) params.set("version", String(version));
  return `/api/documents/${documentId}/download?${params.toString()}`;
}

/**
 * En-tête `Content-Disposition`, en pièce jointe sauf aperçu. Le nom ne peut ni couper l'en-tête ni
 * sortir des guillemets : version ASCII de repli, plus le nom exact encodé (RFC 6266, RFC 8187).
 */
export function contentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_") || "document";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const SIZE_FORMAT = new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 1 });

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${SIZE_FORMAT.format(bytes / 1024)} Ko`;
  return `${SIZE_FORMAT.format(bytes / (1024 * 1024))} Mo`;
}

type LinkFields = Pick<
  DocumentRow,
  | "companyName"
  | "projectNumber"
  | "contractId"
  | "siteName"
  | "ticketNumber"
  | "quoteNumber"
  | "companyId"
>;

/** Colonne « Lié à » de l'écran 23 : l'objet le plus précis, ou « Interne » sans rattachement. */
export function documentLinkLabel(row: LinkFields): string {
  if (row.projectNumber) return `Projet ${row.projectNumber}`;
  if (row.contractId) return `Contrat · ${row.companyName ?? ""}`.trim();
  if (row.quoteNumber) return `Devis ${row.quoteNumber}`;
  if (row.ticketNumber) return `Demande ${row.ticketNumber}`;
  if (row.siteName) return `Site · ${row.siteName}`;
  if (row.companyId) return `Client · ${row.companyName ?? ""}`.trim();
  return "Interne";
}

/**
 * Colonne « Version » : « · référence » quand plusieurs versions existent et que celle-ci est
 * arrêtée. Un brouillon ou un document à valider n'est pas encore une référence.
 */
export function documentVersionLabel(
  row: Pick<DocumentRow, "version" | "versionCount" | "status">,
): string {
  if (row.version === null) return "—";
  const settled = row.status !== "draft" && row.status !== "to_validate";
  return row.versionCount > 1 && settled ? `v${row.version} · référence` : `v${row.version}`;
}

/** Ajoute l'option en place si la liste ne la contient pas (objet archivé depuis, liste bornée). */
export function withOption(
  options: readonly LinkOption[],
  id: string | null | undefined,
  label: string | null | undefined,
): LinkOption[] {
  if (!id || options.some((option) => option.id === id)) return [...options];
  return [{ id, label: label ?? id }, ...options];
}

const numbered = (number: string | null, name: string | null) =>
  [number, name].filter(Boolean).join(" · ");

/**
 * Sans cela, un formulaire de modification afficherait « Aucun » pour un lien dont l'objet a été
 * archivé, et l'enregistrement l'effacerait sans que personne l'ait demandé.
 */
export function withCurrentLinks(
  options: CompanyLinkOptions | null,
  row: DocumentRow,
): CompanyLinkOptions {
  return {
    projects: withOption(
      options?.projects ?? [],
      row.projectId,
      numbered(row.projectNumber, row.projectName),
    ),
    contracts: withOption(
      options?.contracts ?? [],
      row.contractId,
      numbered(row.contractNumber, row.contractName),
    ),
    sites: withOption(options?.sites ?? [], row.siteId, row.siteName),
    tickets: withOption(options?.tickets ?? [], row.ticketId, row.ticketNumber),
    quotes: withOption(options?.quotes ?? [], row.quoteId, row.quoteNumber),
  };
}

/** Prénom pour les historiques compacts (« 2 nov. · Ethan »). */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "—";
}

const count = (value: number, singular: string, plural: string) =>
  `${value} ${value > 1 ? plural : singular}`;

export const formatDocumentCount = (value: number) => count(value, "document", "documents");
export const formatTemplateCount = (value: number) => count(value, "modèle", "modèles");
export const formatArticleCount = (value: number) => count(value, "article", "articles");
