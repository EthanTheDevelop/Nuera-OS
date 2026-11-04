import "server-only";
import { getEnv } from "@/server/config/env";
import { storageUnavailable, type FileStorage } from "./file-storage";
import { LocalDiskStorage } from "./local-disk";

export { type FileStorage, type StoredObject, StoredFileMissingError } from "./file-storage";
export { ingestFile, discardStoredFile, assertAcceptableFilename, type StoredFile } from "./ingest";

const DEFAULT_MAX_UPLOAD_MB = 50;

let cached: { directory: string; storage: FileStorage } | undefined;

/** Stockage configuré dans cet environnement ? Sert l'état « connexion requise » de l'interface. */
export function isStorageConfigured(): boolean {
  return Boolean(getEnv().STORAGE_DIR);
}

/** Taille maximale d'un fichier déposé, en octets. */
export function getMaxUploadBytes(): number {
  return (getEnv().STORAGE_MAX_UPLOAD_MB ?? DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024;
}

/** Stockage de l'environnement. Sans `STORAGE_DIR` : « connexion requise », jamais de succès simulé. */
export function getStorage(): FileStorage {
  const directory = getEnv().STORAGE_DIR;
  if (!directory) {
    throw storageUnavailable(
      "not_configured",
      "Connexion requise : le stockage des fichiers n'est pas configuré.",
    );
  }
  if (cached?.directory !== directory) {
    cached = { directory, storage: new LocalDiskStorage(directory) };
  }
  return cached.storage;
}
