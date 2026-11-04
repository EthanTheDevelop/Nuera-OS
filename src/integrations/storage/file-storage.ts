import { randomUUID } from "node:crypto";
import {
  NotFoundError,
  ServiceUnavailableError,
  type ServiceUnavailableReason,
} from "@/server/errors";

/**
 * Port de stockage des fichiers. Aujourd'hui un disque local (volume persistant en production),
 * demain un stockage S3 sans changer les services : une clé opaque, un flux en entrée, un flux en
 * sortie. Aucun fichier n'est jamais servi statiquement : tout passe par la route de téléchargement.
 */
export interface StoredObject {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
}

export interface FileStorage {
  /** Écrit le flux sous cette clé, entièrement ou pas du tout. Relance l'erreur du flux source. */
  write(key: string, source: ReadableStream<Uint8Array>): Promise<void>;
  /** Lève `StoredFileMissingError` si l'objet n'existe pas. */
  read(key: string): Promise<StoredObject>;
  /** Sans effet si l'objet n'existe pas. */
  remove(key: string): Promise<void>;
}

export const STORAGE_SERVICE = "stockage";

export class StoredFileMissingError extends NotFoundError {
  constructor() {
    super("Le fichier n'est plus disponible dans le stockage.");
  }
}

export function storageUnavailable(
  reason: ServiceUnavailableReason,
  message: string,
  cause?: unknown,
): ServiceUnavailableError {
  return new ServiceUnavailableError(STORAGE_SERVICE, reason, message, { cause });
}

const STORAGE_KEY = /^\d{4}\/\d{2}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Clé générée : ni le nom du fichier ni aucune saisie n'y entrent. */
export function generateStorageKey(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}/${month}/${randomUUID()}`;
}

export function isValidStorageKey(key: string): boolean {
  return STORAGE_KEY.test(key);
}
