import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileStorage } from "@/integrations/storage/file-storage";
import { LocalDiskStorage } from "@/integrations/storage/local-disk";

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nContenu de test\n%%EOF\n");

export function pdfWith(text: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${text}\n%%EOF\n`);
}

/** Flux découpé en morceaux, comme un corps de requête réel. */
export function streamOf(bytes: Uint8Array, chunkSize = 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function createTempStorage(): Promise<{
  directory: string;
  storage: LocalDiskStorage;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "nuera-storage-"));
  return {
    directory,
    storage: new LocalDiskStorage(directory),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** Stockage en panne : écrit jamais, et compte les retraits demandés. */
export class FailingStorage implements FileStorage {
  removed: string[] = [];

  constructor(private readonly error: Error) {}

  async write(_key: string, source: ReadableStream<Uint8Array>): Promise<void> {
    await source.cancel();
    throw this.error;
  }

  async read(): Promise<never> {
    throw this.error;
  }

  async remove(key: string): Promise<void> {
    this.removed.push(key);
  }
}
