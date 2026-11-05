import { crc32 } from "node:zlib";
import {
  getDocumentStorageStatus,
  listDocumentsForPortal,
  openDocumentDownload,
} from "@/modules/documents/document.service";
import type { FileStorage } from "@/integrations/storage/file-storage";
import type { PortalContext } from "@/server/context";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * « Tout télécharger » (C6) : une archive ZIP des documents partagés à ce client, sans dépendance
 * nouvelle. Fichiers stockés sans compression (photos et PDF ne gagnent presque rien), écrits au fil
 * de l'eau : rien n'est chargé en mémoire. Chaque fichier passe par `openDocumentDownload`, la seule
 * porte vers un fichier : même contrôle et même journal qu'un téléchargement à l'unité.
 */
export const ARCHIVE_MAX_FILES = 200;
export const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;

const encoder = new TextEncoder();
const FLAGS_UTF8_AND_DESCRIPTOR = 0x0808;
const METHOD_STORE = 0;
const VERSION_NEEDED = 20;

function dosDateTime(value: Date): { time: number; date: number } {
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date:
      ((Math.max(value.getFullYear(), 1980) - 1980) << 9) |
      ((value.getMonth() + 1) << 5) |
      value.getDate(),
  };
}

/** Nom sûr dans une archive : ni dossier, ni chemin relatif, ni caractère de contrôle. */
export function safeArchiveName(filename: string, taken: Set<string>): string {
  const cleaned =
    filename
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "")
      .trim() || "document";
  const dot = cleaned.lastIndexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  let name = cleaned;
  for (let n = 2; taken.has(name.toLocaleLowerCase("fr-FR")); n += 1) {
    name = `${stem} (${n})${extension}`;
  }
  taken.add(name.toLocaleLowerCase("fr-FR"));
  return name;
}

interface ArchiveEntry {
  name: string;
  open: () => Promise<ReadableStream<Uint8Array>>;
}

function localHeader(nameBytes: Uint8Array, now: { time: number; date: number }): Uint8Array {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(VERSION_NEEDED, 4);
  buffer.writeUInt16LE(FLAGS_UTF8_AND_DESCRIPTOR, 6);
  buffer.writeUInt16LE(METHOD_STORE, 8);
  buffer.writeUInt16LE(now.time, 10);
  buffer.writeUInt16LE(now.date, 12);
  // CRC et tailles à zéro : ils suivent le contenu, dans le descripteur.
  buffer.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([buffer, nameBytes]);
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(0x08074b50, 0);
  buffer.writeUInt32LE(crc, 4);
  buffer.writeUInt32LE(size, 8);
  buffer.writeUInt32LE(size, 12);
  return buffer;
}

interface CentralRecord {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function centralHeader(record: CentralRecord, now: { time: number; date: number }): Uint8Array {
  const buffer = Buffer.alloc(46);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(VERSION_NEEDED, 4);
  buffer.writeUInt16LE(VERSION_NEEDED, 6);
  buffer.writeUInt16LE(FLAGS_UTF8_AND_DESCRIPTOR, 8);
  buffer.writeUInt16LE(METHOD_STORE, 10);
  buffer.writeUInt16LE(now.time, 12);
  buffer.writeUInt16LE(now.date, 14);
  buffer.writeUInt32LE(record.crc, 16);
  buffer.writeUInt32LE(record.size, 20);
  buffer.writeUInt32LE(record.size, 24);
  buffer.writeUInt16LE(record.nameBytes.length, 28);
  buffer.writeUInt32LE(record.offset, 42);
  return Buffer.concat([buffer, record.nameBytes]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(count, 8);
  buffer.writeUInt16LE(count, 10);
  buffer.writeUInt32LE(size, 12);
  buffer.writeUInt32LE(offset, 16);
  return buffer;
}

/** Une entrée complète, au fil de l'eau : en-tête, contenu, descripteur. */
async function* writeEntry(
  name: string,
  stream: AsyncIterable<Uint8Array>,
  now: { time: number; date: number },
  offset: number,
  onDone: (record: CentralRecord, end: number) => void,
): AsyncGenerator<Uint8Array> {
  const nameBytes = encoder.encode(name);
  const header = localHeader(nameBytes, now);
  yield header;
  let crc = 0;
  let size = 0;
  for await (const chunk of stream) {
    crc = crc32(chunk, crc);
    size += chunk.length;
    yield chunk;
  }
  const descriptor = dataDescriptor(crc, size);
  yield descriptor;
  onDone({ nameBytes, crc, size, offset }, offset + header.length + size + descriptor.length);
}

async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/**
 * Un fichier illisible (absent du stockage) ne coupe pas l'archive : il est écarté avant d'écrire son
 * en-tête, et une note dans l'archive le dit. Une archive incomplète ne se fait pas passer pour entière.
 */
async function* zipEntries(entries: readonly ArchiveEntry[]): AsyncGenerator<Uint8Array> {
  const now = dosDateTime(new Date());
  const records: CentralRecord[] = [];
  const unavailable: string[] = [];
  let offset = 0;
  const done = (record: CentralRecord, end: number) => {
    records.push(record);
    offset = end;
  };
  for (const entry of entries) {
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await entry.open();
    } catch (error) {
      logger.warn("portal.archive_file_unavailable", { error });
      unavailable.push(entry.name);
      continue;
    }
    yield* writeEntry(
      entry.name,
      stream as unknown as AsyncIterable<Uint8Array>,
      now,
      offset,
      done,
    );
  }
  if (unavailable.length > 0) {
    const note = `Ces fichiers n'ont pas pu être ajoutés. Écrivez-nous : nous vous les transmettrons.\n\n${unavailable.join("\n")}\n`;
    yield* writeEntry(
      "fichiers-indisponibles.txt",
      oneChunk(encoder.encode(note)),
      now,
      offset,
      done,
    );
  }
  const directoryOffset = offset;
  let directorySize = 0;
  for (const record of records) {
    const central = centralHeader(record, now);
    yield central;
    directorySize += central.length;
  }
  yield endOfCentralDirectory(records.length, directorySize, directoryOffset);
}

function toStream(source: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await source.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await source.return(undefined);
    },
  });
}

export interface PortalArchive {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  fileCount: number;
}

/**
 * Prépare l'archive du client connecté : limites vérifiées avant le premier octet, pour répondre une
 * vraie erreur plutôt qu'un fichier coupé.
 */
export async function openPortalArchive(
  ctx: PortalContext,
  deps: { storage?: FileStorage } = {},
): Promise<PortalArchive> {
  if (!deps.storage && !getDocumentStorageStatus().configured) {
    throw new ServiceUnavailableError(
      "storage",
      "not_configured",
      "Stockage des documents : connexion requise.",
    );
  }

  const rows = [];
  for (let page = 1; ; page += 1) {
    const { items, total } = await listDocumentsForPortal(ctx, {}, { page, pageSize: 100 });
    rows.push(...items);
    if (rows.length > ARCHIVE_MAX_FILES) {
      throw new ConflictError(
        `L'archive est limitée à ${ARCHIVE_MAX_FILES} fichiers : téléchargez-les par petits groupes.`,
      );
    }
    if (rows.length >= total || items.length === 0) break;
  }
  if (rows.length === 0) throw new NotFoundError("Aucun document à télécharger pour l'instant.");

  const totalBytes = rows.reduce((sum, row) => sum + (row.sizeBytes ?? 0), 0);
  if (totalBytes > ARCHIVE_MAX_BYTES) {
    throw new ConflictError("Ces documents sont trop volumineux pour une seule archive.");
  }

  const taken = new Set<string>();
  const entries: ArchiveEntry[] = rows.map((row) => ({
    name: safeArchiveName(row.filename ?? row.title, taken),
    open: async () => {
      const file = await openDocumentDownload(ctx, row.id, {}, deps);
      return file.stream;
    },
  }));
  return {
    stream: toStream(zipEntries(entries)),
    filename: "documents-nuera.zip",
    fileCount: entries.length,
  };
}
