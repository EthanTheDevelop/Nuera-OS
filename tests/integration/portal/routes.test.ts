import { crc32 } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { safeArchiveName } from "@/modules/portal/portal-archive";
import { resolvePortalContext } from "@/server/auth/portal-context";
import type { Actor } from "@/server/auth/permissions";
import { portalMemberships } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import { createClientWorld, type ClientWorld } from "./helpers";

/** Toutes les routes HTTP qu'un client peut appeler, avec une vraie adhésion et de vrais fichiers. */
const state = vi.hoisted(() => ({
  actor: null as unknown,
  db: null as unknown,
  env: {
    BETTER_AUTH_URL: "http://localhost",
    STORAGE_DIR: undefined as string | undefined,
    STORAGE_MAX_UPLOAD_MB: 5 as number | undefined,
  },
}));

vi.mock("@/server/auth/session", async () => {
  const { redirect } = await import("next/navigation");
  return {
    getCurrentActor: async () => state.actor,
    getPortalContext: async () => {
      // Comme la vraie session : un membre de l'équipe repart vers l'agence.
      if ((state.actor as Actor | null)?.role !== "client") redirect("/");
      return resolvePortalContext(state.db as Database, state.actor as Actor);
    },
  };
});
vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/config/env", () => ({ getEnv: () => state.env }));

const { POST: upload } = await import("@/app/api/documents/upload/route");
const { GET: download } = await import("@/app/api/documents/[id]/download/route");
const { GET: archive } = await import("@/app/(portal)/espace/(client)/documents/archive/route");
const { GET: agenda } =
  await import("@/app/(portal)/espace/(client)/rendez-vous/[id]/agenda/route");

const ORIGIN = "http://localhost";

function post(path: string, body: BodyInit) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    body,
    headers: { origin: ORIGIN },
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Lecteur d'archive de contrôle, indépendant de l'écriture : répertoire central, CRC, tailles. */
function readZip(bytes: Buffer): { name: string; content: Buffer }[] {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const files: { name: string; content: Buffer }[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const crc = bytes.readUInt32LE(cursor + 16);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const start = offset + 30 + localNameLength;
    const content = bytes.subarray(start, start + size);
    expect(crc32(content)).toBe(crc);
    files.push({ name, content });
    cursor += 46 + nameLength;
  }
  return files;
}

describe("routes du portail", () => {
  let db: Database;
  let close: () => Promise<void>;
  let directory: string;
  let a: ClientWorld;
  let b: ClientWorld;
  let aFile: string;
  let bFile: string;

  const as = (world: ClientWorld | null) => {
    state.actor = world?.ctx.actor ?? null;
  };

  async function deposit(world: ClientWorld, name: string, text: string): Promise<string> {
    as(world);
    const response = await upload(
      post(
        `/api/documents/upload?filename=${encodeURIComponent(name)}&projectId=${world.project.id}`,
        Buffer.from(`%PDF-1.7\n${text}\n%%EOF\n`),
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { document: { id: string } };
    return body.document.id;
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
    directory = await mkdtemp(join(tmpdir(), "nuera-portal-"));
    state.env.STORAGE_DIR = directory;
    a = await createClientWorld(db, "Alpha");
    b = await createClientWorld(db, "Beta");
    aFile = await deposit(a, "photos-alpha.pdf", "contenu alpha");
    bFile = await deposit(b, "photos-beta.pdf", "contenu beta");
  });
  beforeEach(() => {
    state.env.STORAGE_DIR = directory;
    as(a);
  });
  afterAll(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });

  it("le dépôt impose le client : un companyId dans l'URL ne change rien", async () => {
    as(a);
    const response = await upload(
      post(
        `/api/documents/upload?filename=forge.pdf&companyId=${b.ctx.companyId}&visibility=internal`,
        Buffer.from("%PDF-1.7\nforge\n%%EOF\n"),
      ),
    );
    expect(response.status).toBe(201);
    const { document } = (await response.json()) as { document: { id: string } };
    const own = await download(new NextRequest(`${ORIGIN}/x`), params(document.id));
    expect(own.status).toBe(200);
    as(b);
    const other = await download(new NextRequest(`${ORIGIN}/x`), params(document.id));
    expect(other.status).toBe(404);
  });

  it("déposer sur le projet d'un autre client répond 404", async () => {
    as(a);
    const response = await upload(
      post(
        `/api/documents/upload?filename=croise.pdf&projectId=${b.project.id}`,
        Buffer.from("%PDF-1.7\ncroise\n%%EOF\n"),
      ),
    );
    expect(response.status).toBe(404);
  });

  it("télécharger un fichier de B répond 404, le sien 200", async () => {
    expect((await download(new NextRequest(`${ORIGIN}/x`), params(aFile))).status).toBe(200);
    expect((await download(new NextRequest(`${ORIGIN}/x`), params(bFile))).status).toBe(404);
  });

  it("l'historique des versions reste interne au portail", async () => {
    const response = await download(new NextRequest(`${ORIGIN}/x?version=99`), params(aFile));
    expect(response.status).toBe(200);
  });

  it("l'archive ne contient que les fichiers lisibles du client", async () => {
    // Le client lit le stockage réel pour ses dépôts : les fichiers d'exemple du monde n'existent
    // pas sur disque, l'archive de contrôle se fait donc sur un client qui n'a que ses dépôts.
    const { createPortalTestContext } = await import("../../helpers/factories");
    const client = await createPortalTestContext(db);
    state.actor = client.actor;
    const first = await upload(
      post("/api/documents/upload?filename=un.pdf", Buffer.from("%PDF-1.7\nun\n%%EOF\n")),
    );
    const second = await upload(
      post(
        "/api/documents/upload?filename=un.pdf&title=autre",
        Buffer.from("%PDF-1.7\ndeux\n%%EOF\n"),
      ),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const response = await archive();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = readZip(Buffer.from(await response.arrayBuffer()));
    expect(files.map((file) => file.name).sort()).toEqual(["un (2).pdf", "un.pdf"]);
    expect(files.map((file) => file.content.toString()).join("")).toContain("deux");
    expect(files.map((file) => file.content.toString()).join("")).not.toContain("beta");
  });

  it("l'archive sans document répond 404, sans session 401", async () => {
    const { createPortalTestContext } = await import("../../helpers/factories");
    const empty = await createPortalTestContext(db);
    state.actor = empty.actor;
    expect((await archive()).status).toBe(404);
    as(null);
    expect((await archive()).status).toBe(401);
  });

  it("archive sans stockage : connexion requise, pas de succès simulé", async () => {
    state.env.STORAGE_DIR = undefined;
    const response = await archive();
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("connexion requise");
  });

  it("agenda : le sien en .ics, celui de B 404", async () => {
    const own = await agenda(new Request(`${ORIGIN}/x`), params(a.appointment.id));
    expect(own.status).toBe(200);
    const text = await own.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("SUMMARY:Rendez-vous Alpha");
    expect(text).toContain("DTSTART:20990115T090000Z");
    expect(text).toContain("DTEND:20990115T093000Z");
    const other = await agenda(new Request(`${ORIGIN}/x`), params(b.appointment.id));
    expect(other.status).toBe(404);
  });

  it("déposer sur la demande d'un autre client répond 404", async () => {
    as(a);
    const response = await upload(
      post(
        `/api/documents/upload?filename=intrus.pdf&ticketId=${b.ticket.id}`,
        Buffer.from("%PDF-1.7\nintrus\n%%EOF\n"),
      ),
    );
    expect(response.status).toBe(404);
  });

  it("un membre de l'équipe repart vers l'agence : pas de 500 sur ces routes", async () => {
    state.actor = { userId: "u", role: "admin", name: "Associé", email: "a@test.local" };
    const digests = await Promise.all(
      [archive(), agenda(new Request(`${ORIGIN}/x`), params(a.appointment.id))].map((run) =>
        run.then(
          () => "",
          (error: { digest?: string }) => error.digest ?? "",
        ),
      ),
    );
    for (const digest of digests) expect(digest).toContain("NEXT_REDIRECT");
  });

  it("un accès révoqué perd tout, immédiatement, sur chaque route", async () => {
    const world = await createClientWorld(db, "Gamma");
    const file = await deposit(world, "photos-gamma.pdf", "contenu gamma");
    as(world);
    expect((await download(new NextRequest(`${ORIGIN}/x`), params(file))).status).toBe(200);

    await db
      .update(portalMemberships)
      .set({ status: "revoked" })
      .where(eq(portalMemberships.userId, world.ctx.actor.userId));

    expect((await download(new NextRequest(`${ORIGIN}/x`), params(file))).status).toBe(404);
    expect((await archive()).status).toBe(404);
    expect((await agenda(new Request(`${ORIGIN}/x`), params(world.appointment.id))).status).toBe(
      404,
    );
    const denied = await upload(
      post("/api/documents/upload?filename=apres.pdf", Buffer.from("%PDF-1.7\napres\n%%EOF\n")),
    );
    expect(denied.status).toBe(403);
  });
});

describe("noms dans l'archive", () => {
  it("ne laisse sortir aucun chemin, et ne garde aucun doublon", () => {
    const taken = new Set<string>();
    expect(safeArchiveName("../../etc/passwd", taken)).toBe("_.._etc_passwd");
    expect(safeArchiveName("C:\\Windows\\x.pdf", taken)).toBe("C__Windows_x.pdf");
    expect(safeArchiveName("devis.pdf", taken)).toBe("devis.pdf");
    expect(safeArchiveName("DEVIS.pdf", taken)).toBe("DEVIS (2).pdf");
    expect(safeArchiveName("", taken)).toBe("document");
  });
});
