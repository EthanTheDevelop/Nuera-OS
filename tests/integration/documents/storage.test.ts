import { createHash } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  generateStorageKey,
  isValidStorageKey,
  StoredFileMissingError,
} from "@/integrations/storage/file-storage";
import { sanitizeFilename } from "@/integrations/storage/file-types";
import { discardStoredFile, ingestFile } from "@/integrations/storage/ingest";
import { LocalDiskStorage } from "@/integrations/storage/local-disk";
import { contentDisposition } from "@/modules/documents/document.format";
import { ServiceUnavailableError, ValidationError } from "@/server/errors";
import { createTempStorage, FailingStorage, PDF_BYTES, readAll, streamOf } from "./helpers";

const MAX = 1024 * 1024;

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe("stockage sur disque", () => {
  let temp: Awaited<ReturnType<typeof createTempStorage>>;

  beforeAll(async () => {
    temp = await createTempStorage();
  });
  afterAll(() => temp.cleanup());

  it("écrit, relit et retire un fichier sous une clé générée", async () => {
    const key = generateStorageKey();
    await temp.storage.write(key, streamOf(PDF_BYTES));
    const object = await temp.storage.read(key);
    expect(object.sizeBytes).toBe(PDF_BYTES.length);
    expect(await readAll(object.stream)).toEqual(Buffer.from(PDF_BYTES));
    await temp.storage.remove(key);
    await expect(temp.storage.read(key)).rejects.toBeInstanceOf(StoredFileMissingError);
  });

  it.each([
    "../secret",
    "..\\secret",
    "2026/11/../../../etc/passwd",
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "seed/abc/v1.pdf",
    "2026/11/pas-un-uuid",
    "",
  ])("refuse la clé %j sans toucher au disque", async (key) => {
    expect(isValidStorageKey(key)).toBe(false);
    await expect(temp.storage.write(key, streamOf(PDF_BYTES))).rejects.toThrow("invalide");
    await expect(temp.storage.read(key)).rejects.toBeInstanceOf(StoredFileMissingError);
    await expect(temp.storage.remove(key)).resolves.toBeUndefined();
  });

  it("une clé ne dépend jamais du nom du fichier", async () => {
    const stored = await ingestFile(temp.storage, streamOf(PDF_BYTES), {
      filename: "../../../etc/passwd.pdf",
      maxBytes: MAX,
    });
    expect(isValidStorageKey(stored.storageKey)).toBe(true);
    expect(stored.storageKey).not.toContain("passwd");
    expect(stored.filename).toBe("passwd.pdf");
  });

  it("ne laisse aucun fichier temporaire après une écriture interrompue", async () => {
    const before = await filesUnder(temp.directory);
    const key = generateStorageKey();
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PDF_BYTES);
        controller.error(new Error("Connexion coupée"));
      },
    });
    await expect(temp.storage.write(key, failing)).rejects.toThrow();
    expect(await filesUnder(temp.directory)).toEqual(before);
  });

  it("une panne du disque devient une indisponibilité du service, pas un succès", async () => {
    const occupied = join(temp.directory, "occupe");
    await writeFile(occupied, "un fichier à la place du dossier");
    const unusable = new LocalDiskStorage(join(occupied, "stockage"));
    const key = generateStorageKey();
    await expect(unusable.write(key, streamOf(PDF_BYTES))).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

describe("dépôt d'un flux", () => {
  let temp: Awaited<ReturnType<typeof createTempStorage>>;

  beforeAll(async () => {
    temp = await createTempStorage();
  });
  afterAll(() => temp.cleanup());

  it("calcule le sha256, la taille et le type réels", async () => {
    const stored = await ingestFile(temp.storage, streamOf(PDF_BYTES, 3), {
      filename: "contrat.pdf",
      maxBytes: MAX,
    });
    expect(stored).toMatchObject({
      filename: "contrat.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF_BYTES.length,
      sha256: createHash("sha256").update(PDF_BYTES).digest("hex"),
    });
    expect(await readAll((await temp.storage.read(stored.storageKey)).stream)).toEqual(
      Buffer.from(PDF_BYTES),
    );
  });

  it("garde un fichier plus long que la zone d'inspection, octet pour octet", async () => {
    const bytes = new Uint8Array(20_000).fill(65);
    bytes.set(PDF_BYTES);
    const stored = await ingestFile(temp.storage, streamOf(bytes, 1000), {
      filename: "long.pdf",
      maxBytes: MAX,
    });
    expect(stored.sizeBytes).toBe(20_000);
    expect(await readAll((await temp.storage.read(stored.storageKey)).stream)).toEqual(
      Buffer.from(bytes),
    );
  });

  it.each([
    ["exécutable renommé en PDF", "facture.pdf", Uint8Array.of(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0)],
    ["page HTML renommée en image", "photo.png", new TextEncoder().encode("<html><script>")],
    ["image renommée en JPEG", "photo.jpg", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)],
    ["binaire renommé en texte", "note.txt", Uint8Array.of(0x41, 0x00, 0x42)],
    ["page HTML renommée en SVG", "logo.svg", new TextEncoder().encode("<html></html>")],
    ["archive refusée sous Word", "brief.docx", new TextEncoder().encode("pas une archive")],
  ])("refuse un %s", async (_label, filename, bytes) => {
    const before = await filesUnder(temp.directory);
    await expect(
      ingestFile(temp.storage, streamOf(bytes), { filename, maxBytes: MAX }),
    ).rejects.toThrow("ne correspond pas");
    expect(await filesUnder(temp.directory)).toEqual(before);
  });

  it.each(["virus.exe", "page.html", "script.js", "macro.docm", "sans-extension", "image.php"])(
    "refuse l'extension de %s avant de lire le contenu",
    async (filename) => {
      const pull = vi.fn();
      const source = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
      await expect(ingestFile(temp.storage, source, { filename, maxBytes: MAX })).rejects.toThrow(
        "n'est pas accepté",
      );
      expect(pull).not.toHaveBeenCalled();
    },
  );

  it("coupe un fichier trop lourd et n'en garde rien", async () => {
    const before = await filesUnder(temp.directory);
    const bytes = new Uint8Array(10_000);
    bytes.set(PDF_BYTES);
    await expect(
      ingestFile(temp.storage, streamOf(bytes), { filename: "gros.pdf", maxBytes: 5_000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await filesUnder(temp.directory)).toEqual(before);
  });

  it("refuse un fichier vide", async () => {
    await expect(
      ingestFile(temp.storage, streamOf(new Uint8Array()), { filename: "v.pdf", maxBytes: MAX }),
    ).rejects.toThrow("vide");
  });

  it("retire l'objet si le stockage échoue en cours d'écriture", async () => {
    const storage = new FailingStorage(new Error("Panne"));
    await expect(
      ingestFile(storage, streamOf(PDF_BYTES), { filename: "a.pdf", maxBytes: MAX }),
    ).rejects.toThrow("Panne");
    expect(storage.removed).toHaveLength(1);
  });

  it("un retrait impossible n'interrompt pas l'opération", async () => {
    const storage = {
      remove: () => Promise.reject(new Error("Disque en lecture seule")),
    } as unknown as LocalDiskStorage;
    await expect(discardStoredFile(storage, generateStorageKey())).resolves.toBeUndefined();
  });
});

describe("noms de fichiers", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\moi\\photo.png", "photo.png"],
    ['fac"ture\r\n<x>.pdf', "facturex.pdf"],
    ["  ..cache.pdf ", "cache.pdf"],
    ["dossier/", ""],
    ["..", ""],
  ])("nettoie %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("borne la longueur en gardant l'extension", () => {
    const name = sanitizeFilename(`${"a".repeat(500)}.pdf`);
    expect(name).toHaveLength(180);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("n'autorise aucune injection dans Content-Disposition", () => {
    const header = contentDisposition('été "2026"\r\nX-Injecté: oui.pdf');
    expect(header).toMatch(/^attachment; filename="[^"\r\n]+"; filename\*=UTF-8''[^\s]+$/);
    expect(header).not.toMatch(/[\r\n]/);
    expect(contentDisposition("Brief été.pdf")).toContain(
      "filename*=UTF-8''Brief%20%C3%A9t%C3%A9.pdf",
    );
  });
});

describe("configuration", () => {
  const BASE = {
    DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
  };

  it("sans STORAGE_DIR : connexion requise, jamais de succès simulé", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv("STORAGE_DIR", "");
    const { getStorage, isStorageConfigured } = await import("@/integrations/storage");
    expect(isStorageConfigured()).toBe(false);
    let error: unknown;
    try {
      getStorage();
    } catch (caught) {
      error = caught;
    }
    expect((error as ServiceUnavailableError).reason).toBe("not_configured");
    expect((error as ServiceUnavailableError).connectionRequired).toBe(true);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("taille maximale par défaut, puis configurable", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv("STORAGE_DIR", "/tmp/x");
    vi.stubEnv("STORAGE_MAX_UPLOAD_MB", "");
    const first = await import("@/integrations/storage");
    expect(first.getMaxUploadBytes()).toBe(50 * 1024 * 1024);
    expect(first.getStorage()).toBeInstanceOf(Object);

    vi.resetModules();
    vi.stubEnv("STORAGE_MAX_UPLOAD_MB", "2");
    const second = await import("@/integrations/storage");
    expect(second.getMaxUploadBytes()).toBe(2 * 1024 * 1024);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
