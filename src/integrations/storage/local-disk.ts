import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  isValidStorageKey,
  storageUnavailable,
  StoredFileMissingError,
  type FileStorage,
  type StoredObject,
} from "./file-storage";

/** Erreur du système de fichiers, à distinguer de celle du flux source, qui est relancée telle quelle. */
function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).errno === "number";
}

/**
 * Stockage sur disque, sous `STORAGE_DIR`. Une clé invalide ne touche jamais le disque : seules les
 * clés générées par `generateStorageKey` sont acceptées, sans composant de chemin libre.
 */
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private pathFor(key: string): string | null {
    if (!isValidStorageKey(key)) return null;
    const path = resolve(this.root, ...key.split("/"));
    return path.startsWith(`${this.root}${sep}`) ? path : null;
  }

  async write(key: string, source: ReadableStream<Uint8Array>): Promise<void> {
    const target = this.pathFor(key);
    if (!target) throw new Error("Clé de stockage invalide");

    const temporaryDirectory = join(this.root, ".tmp");
    const temporary = join(temporaryDirectory, randomUUID());
    try {
      await mkdir(temporaryDirectory, { recursive: true });
      await pipeline(
        Readable.fromWeb(source as NodeReadableStream<Uint8Array>),
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      await mkdir(dirname(target), { recursive: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      if (isFileSystemError(error)) {
        throw storageUnavailable(
          "unreachable",
          "Le stockage des fichiers ne répond pas. Réessayez ou contactez un administrateur.",
          error,
        );
      }
      throw error;
    }
  }

  async read(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    if (!path) throw new StoredFileMissingError();
    try {
      const { size } = await stat(path);
      const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
      return { stream, sizeBytes: size };
    } catch (error) {
      if (isFileSystemError(error) && error.code === "ENOENT") throw new StoredFileMissingError();
      throw storageUnavailable(
        "unreachable",
        "Le stockage des fichiers ne répond pas. Réessayez ou contactez un administrateur.",
        error,
      );
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    if (path) await rm(path, { force: true });
  }
}
