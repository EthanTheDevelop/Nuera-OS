import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createDocument,
  createMemberContext,
  createPortalTestContext,
} from "../../helpers/factories";
import { pdfWith } from "./helpers";

/** Les routes HTTP elles-mêmes : session, origine, en-têtes, codes de réponse. */
const state = vi.hoisted(() => ({
  actor: null as unknown,
  db: null as unknown,
  env: {
    BETTER_AUTH_URL: "http://localhost",
    STORAGE_DIR: undefined as string | undefined,
    STORAGE_MAX_UPLOAD_MB: 1 as number | undefined,
  },
}));

vi.mock("@/server/auth/session", () => ({ getCurrentActor: async () => state.actor }));
vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/server/config/env", () => ({ getEnv: () => state.env }));

const { POST: upload } = await import("@/app/api/documents/upload/route");
const { GET: download } = await import("@/app/api/documents/[id]/download/route");
const { POST: addVersion } = await import("@/app/api/documents/[id]/versions/route");

const ORIGIN = "http://localhost";

function post(path: string, body: BodyInit | null, origin: string | null = ORIGIN) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    body,
    headers: origin ? { origin } : {},
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

const get = (path: string) => new NextRequest(`${ORIGIN}${path}`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("routes de documents", () => {
  let db: Database;
  let close: () => Promise<void>;
  let directory: string;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let counter = 0;
  const unique = () => pdfWith(`route ${(counter += 1)}`);
  const as = (ctx: { actor: Actor } | null) => {
    state.actor = ctx?.actor ?? null;
  };

  async function uploaded(query = "title=Brief&filename=brief.pdf", bytes = unique()) {
    as(member);
    const response = await upload(post(`/api/documents/upload?${query}`, Buffer.from(bytes)));
    const body = (await response.json()) as { document: { id: string } };
    return { response, id: body.document.id };
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
    directory = await mkdtemp(join(tmpdir(), "nuera-routes-"));
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
  });

  beforeEach(() => {
    state.env.STORAGE_DIR = directory;
    state.actor = member.actor;
  });

  afterAll(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });

  describe("dépôt", () => {
    it("répond 401 sans session", async () => {
      as(null);
      const response = await upload(
        post("/api/documents/upload?title=Brief&filename=a.pdf", Buffer.from(unique())),
      );
      expect(response.status).toBe(401);
    });

    it("répond 403 à une autre origine ou sans origine", async () => {
      for (const origin of ["https://evil.test", null]) {
        const response = await upload(
          post("/api/documents/upload?title=Brief&filename=a.pdf", Buffer.from(unique()), origin),
        );
        expect(response.status).toBe(403);
      }
    });

    it("crée en 201, reconnaît le même dépôt en 200", async () => {
      const bytes = unique();
      const first = await uploaded("title=Répété&filename=a.pdf", bytes);
      const second = await uploaded("title=Répété&filename=a.pdf", bytes);
      expect(first.response.status).toBe(201);
      expect(second.response.status).toBe(200);
      expect(second.id).toBe(first.id);
    });

    it("répond 400 à une extension interdite, un faux contenu, un fichier trop gros", async () => {
      const refused = [
        ["filename=a.exe", Buffer.from(unique())],
        ["filename=a.pdf", Buffer.from("pas un pdf")],
        ["filename=a.pdf", Buffer.alloc(2 * 1024 * 1024, 0x25)],
      ] as const;
      for (const [query, body] of refused) {
        const response = await upload(post(`/api/documents/upload?title=Brief&${query}`, body));
        expect(response.status).toBe(400);
        const json = (await response.json()) as { error: { fieldErrors?: { file?: string[] } } };
        expect(json.error.fieldErrors?.file).toBeDefined();
      }
    });

    it("répond 403 à un lecteur et à un prestataire", async () => {
      const contractor = await createMemberContext(db, "contractor");
      for (const ctx of [viewer, contractor]) {
        as(ctx);
        const response = await upload(
          post("/api/documents/upload?title=Brief&filename=a.pdf", Buffer.from(unique())),
        );
        expect(response.status).toBe(403);
      }
    });

    it("sans stockage configuré : 503 et connexion requise, jamais de succès", async () => {
      state.env.STORAGE_DIR = undefined;
      const response = await upload(
        post("/api/documents/upload?title=Brief&filename=a.pdf", Buffer.from(unique())),
      );
      expect(response.status).toBe(503);
      const json = (await response.json()) as { error: { connectionRequired?: boolean } };
      expect(json.error.connectionRequired).toBe(true);
    });

    it("un client ne peut pas imposer un autre client ni un partage interne", async () => {
      const client = await createPortalTestContext(db);
      const other = await createCompany(db);
      as(client);
      const response = await upload(
        post(
          `/api/documents/upload?filename=photo.pdf&companyId=${other.id}&visibility=internal`,
          Buffer.from(unique()),
        ),
      );
      expect(response.status).toBe(201);
      const { document } = (await response.json()) as { document: { id: string } };
      const { assertDocumentReadable } = await import("@/modules/documents/document.service");
      await expect(assertDocumentReadable(client, document.id)).resolves.toMatchObject({
        companyId: client.companyId,
        visibility: "client",
        uploadedByClient: true,
      });
    });
  });

  describe("nouvelle version", () => {
    it("refuse un client comme si le document n'existait pas", async () => {
      const { id } = await uploaded();
      as(await createPortalTestContext(db));
      const response = await addVersion(
        post(`/api/documents/${id}/versions?filename=v2.pdf`, Buffer.from(unique())),
        params(id),
      );
      expect(response.status).toBe(404);
    });

    it("refuse une autre origine", async () => {
      const { id } = await uploaded();
      const response = await addVersion(
        post(
          `/api/documents/${id}/versions?filename=v2.pdf`,
          Buffer.from(unique()),
          "https://evil.test",
        ),
        params(id),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("téléchargement et aperçu", () => {
    it("répond 401 sans session", async () => {
      const { id } = await uploaded();
      as(null);
      expect((await download(get(`/api/documents/${id}/download`), params(id))).status).toBe(401);
    });

    it("sert une pièce jointe verrouillée, avec le contenu exact", async () => {
      const bytes = unique();
      const { id } = await uploaded("title=Exact&filename=exact.pdf", bytes);
      const response = await download(get(`/api/documents/${id}/download`), params(id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
    });

    it("l'aperçu ouvre un PDF dans le navigateur, sans script ni cadre", async () => {
      const { id } = await uploaded("title=Apercu&filename=apercu.pdf");
      const response = await download(get(`/api/documents/${id}/download?apercu=1`), params(id));
      await response.body?.cancel();
      expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("script-src");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("l'aperçu d'un SVG ou d'un texte reste une pièce jointe verrouillée", async () => {
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`);
      for (const [filename, bytes] of [
        ["logo.svg", svg],
        ["note.txt", Buffer.from("<script>x</script>")],
      ] as const) {
        const { id } = await uploaded(`title=${filename}&filename=${filename}`, bytes);
        const response = await download(get(`/api/documents/${id}/download?apercu=1`), params(id));
        await response.body?.cancel();
        expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
        expect(response.headers.get("content-security-policy")).toContain("sandbox");
      }
    });

    it("un client lit son document partagé, jamais celui d'un autre ni un interne", async () => {
      const client = await createPortalTestContext(db);
      const stranger = await createPortalTestContext(db);
      const { id: shared } = await uploaded(
        `title=Partagé&filename=p.pdf&companyId=${client.companyId}&visibility=client`,
      );
      const { id: internal } = await uploaded(
        `title=Interne&filename=i.pdf&companyId=${client.companyId}`,
      );

      as(client);
      const ok = await download(get(`/api/documents/${shared}/download`), params(shared));
      await ok.body?.cancel();
      expect(ok.status).toBe(200);
      const hidden = await download(get(`/api/documents/${internal}/download`), params(internal));
      expect(hidden.status).toBe(404);

      as(stranger);
      const foreign = await download(get(`/api/documents/${shared}/download`), params(shared));
      expect(foreign.status).toBe(404);
    });

    it("répond 404 hors périmètre, identifiant ou version mal formés", async () => {
      const contractor = await createMemberContext(db, "contractor");
      const { document } = await createDocument(db, { title: "Hors périmètre" });
      as(contractor);
      expect(
        (await download(get(`/api/documents/${document.id}/download`), params(document.id))).status,
      ).toBe(404);

      as(member);
      expect(
        (await download(get("/api/documents/pas-un-id/download"), params("pas-un-id"))).status,
      ).toBe(404);
      const { id } = await uploaded();
      for (const version of ["0", "abc", "999"]) {
        const response = await download(
          get(`/api/documents/${id}/download?version=${version}`),
          params(id),
        );
        expect(response.status).toBe(404);
      }
    });

    it("le fichier disparu du stockage répond 404, sans détail", async () => {
      const { document } = await createDocument(db, { title: "Fichier perdu" });
      const response = await download(
        get(`/api/documents/${document.id}/download`),
        params(document.id),
      );
      expect(response.status).toBe(404);
    });
  });
});
