/**
 * Types de fichiers acceptés. Fichier pur, importable côté interface pour l'attribut `accept` ; le
 * contrôle qui fait foi est celui du serveur, sur l'extension ET sur le contenu.
 *
 * Le type enregistré vient de cette table, jamais de ce que déclare le navigateur.
 */
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

function startsWith(head: Uint8Array, signature: Uint8Array, offset = 0): boolean {
  if (head.length < offset + signature.length) return false;
  return signature.every((byte, index) => head[offset + index] === byte);
}

const PDF = ascii("%PDF-");
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff);
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
const FTYP = ascii("ftyp");

/** Texte lisible : aucun octet nul dans le début du fichier. Refuse un exécutable renommé. */
function isText(head: Uint8Array): boolean {
  return !head.includes(0);
}

function isSvg(head: Uint8Array): boolean {
  if (!isText(head)) return false;
  return new TextDecoder("utf-8", { fatal: false }).decode(head).toLowerCase().includes("<svg");
}

export interface AllowedFileType {
  extensions: readonly string[];
  mimeType: string;
  matches: (head: Uint8Array) => boolean;
}

const isZip = (head: Uint8Array) => startsWith(head, ZIP);
const isIsoMedia = (head: Uint8Array) => startsWith(head, FTYP, 4);

export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { extensions: ["pdf"], mimeType: "application/pdf", matches: (h) => startsWith(h, PDF) },
  { extensions: ["png"], mimeType: "image/png", matches: (h) => startsWith(h, PNG) },
  { extensions: ["jpg", "jpeg"], mimeType: "image/jpeg", matches: (h) => startsWith(h, JPEG) },
  {
    extensions: ["gif"],
    mimeType: "image/gif",
    matches: (h) => startsWith(h, GIF87) || startsWith(h, GIF89),
  },
  {
    extensions: ["webp"],
    mimeType: "image/webp",
    matches: (h) => startsWith(h, RIFF) && startsWith(h, WEBP, 8),
  },
  { extensions: ["heic", "heif"], mimeType: "image/heic", matches: isIsoMedia },
  { extensions: ["svg"], mimeType: "image/svg+xml", matches: isSvg },
  { extensions: ["mp4"], mimeType: "video/mp4", matches: isIsoMedia },
  { extensions: ["mov"], mimeType: "video/quicktime", matches: isIsoMedia },
  {
    extensions: ["docx"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: isZip,
  },
  {
    extensions: ["xlsx"],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    matches: isZip,
  },
  {
    extensions: ["pptx"],
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    matches: isZip,
  },
  { extensions: ["odt"], mimeType: "application/vnd.oasis.opendocument.text", matches: isZip },
  {
    extensions: ["ods"],
    mimeType: "application/vnd.oasis.opendocument.spreadsheet",
    matches: isZip,
  },
  {
    extensions: ["odp"],
    mimeType: "application/vnd.oasis.opendocument.presentation",
    matches: isZip,
  },
  { extensions: ["zip"], mimeType: "application/zip", matches: isZip },
  { extensions: ["txt"], mimeType: "text/plain", matches: isText },
  { extensions: ["md"], mimeType: "text/markdown", matches: isText },
  { extensions: ["csv"], mimeType: "text/csv", matches: isText },
];

/** Octets lus avant de décider : assez pour toutes les signatures et le début d'un SVG. */
export const SNIFF_BYTES = 4096;

export const ALLOWED_EXTENSIONS = ALLOWED_FILE_TYPES.flatMap((type) => type.extensions);

/** Valeur de l'attribut `accept` d'un `<input type="file">`. */
export const FILE_INPUT_ACCEPT = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** Liste lisible, pour un message d'erreur ou une aide. */
export const ALLOWED_TYPES_LABEL =
  "PDF, images, vidéos MP4 ou MOV, Office, OpenDocument, ZIP, texte";

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function allowedTypeFor(filename: string): AllowedFileType | undefined {
  const extension = extensionOf(filename);
  return ALLOWED_FILE_TYPES.find((type) => type.extensions.includes(extension));
}

const MAX_FILENAME_LENGTH = 180;

/**
 * Nom d'origine, gardé pour l'affichage et le téléchargement uniquement : la clé de stockage est
 * générée et n'en dépend jamais. Retire le chemin et les caractères de contrôle, borne la longueur
 * en gardant l'extension.
 */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}"<>|:*?]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
  const extension = extensionOf(cleaned);
  const suffix = extension ? `.${extension}` : "";
  return `${cleaned.slice(0, MAX_FILENAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}
