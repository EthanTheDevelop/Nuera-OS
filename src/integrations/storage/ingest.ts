import { createHash } from "node:crypto";
import { ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { generateStorageKey, type FileStorage } from "./file-storage";
import {
  ALLOWED_TYPES_LABEL,
  allowedTypeFor,
  sanitizeFilename,
  SNIFF_BYTES,
  type AllowedFileType,
} from "./file-types";

/** Fichier déposé : ce que `document_versions` enregistre. */
export interface StoredFile {
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export function formatMaxSize(maxBytes: number): string {
  return `${Math.round(maxBytes / (1024 * 1024))} Mo`;
}

function fileError(message: string): ValidationError {
  return new ValidationError(message, { file: [message] });
}

/** Refuse tout de suite un nom ou une extension hors de la liste, avant de lire un seul octet. */
export function assertAcceptableFilename(filename: string): {
  filename: string;
  type: AllowedFileType;
} {
  const safeName = sanitizeFilename(filename);
  if (!safeName) throw fileError("Le nom du fichier est invalide.");
  const type = allowedTypeFor(safeName);
  if (!type) throw fileError(`Ce type de fichier n'est pas accepté (${ALLOWED_TYPES_LABEL}).`);
  return { filename: safeName, type };
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Dépose un flux dans le stockage, sans jamais le garder en mémoire : calcule le sha256 au fil de
 * l'eau, coupe dès que la taille maximale est dépassée et contrôle le contenu réel avant d'écrire
 * le premier octet. En cas de refus, rien ne reste dans le stockage.
 */
export async function ingestFile(
  storage: FileStorage,
  source: ReadableStream<Uint8Array>,
  options: { filename: string; maxBytes: number },
): Promise<StoredFile> {
  const { filename, type } = assertAcceptableFilename(options.filename);
  const storageKey = generateStorageKey();
  const hash = createHash("sha256");

  let sizeBytes = 0;
  let pending: Uint8Array[] = [];
  let pendingLength = 0;
  let inspected = false;

  function inspect(controller: TransformStreamDefaultController<Uint8Array>) {
    const head = concat(pending, pendingLength);
    if (!type.matches(head.subarray(0, SNIFF_BYTES))) {
      throw fileError("Le contenu de ce fichier ne correspond pas à son extension.");
    }
    inspected = true;
    controller.enqueue(head);
    pending = [];
    pendingLength = 0;
  }

  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sizeBytes += chunk.length;
      if (sizeBytes > options.maxBytes) {
        throw fileError(
          `Ce fichier dépasse la taille maximale de ${formatMaxSize(options.maxBytes)}.`,
        );
      }
      hash.update(chunk);
      if (inspected) {
        controller.enqueue(chunk);
        return;
      }
      pending.push(chunk);
      pendingLength += chunk.length;
      if (pendingLength >= SNIFF_BYTES) inspect(controller);
    },
    flush(controller) {
      if (sizeBytes === 0) throw fileError("Ce fichier est vide.");
      if (!inspected) inspect(controller);
    },
  });

  try {
    await storage.write(storageKey, source.pipeThrough(guard));
  } catch (error) {
    await discardStoredFile(storage, storageKey);
    throw error;
  }

  return {
    storageKey,
    filename,
    mimeType: type.mimeType,
    sizeBytes,
    sha256: hash.digest("hex"),
  };
}

/** Retire un fichier orphelin. Un échec ici n'annule pas le résultat de l'opération. */
export async function discardStoredFile(storage: FileStorage, storageKey: string): Promise<void> {
  try {
    await storage.remove(storageKey);
  } catch (error) {
    logger.error("storage.discard_failed", { error });
  }
}
