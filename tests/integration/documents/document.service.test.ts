import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCUMENT_STATUSES, type DocumentStatus } from "@/lib/domain-enums";
import {
  archiveDocument,
  assertDocumentReadable,
  attachDocument,
  getDocumentDetail,
  listDocumentCompanyOptions,
  listDocumentLinkOptions,
  listDocumentsFor,
  listDocumentsForCompany,
  listDocumentsForPortal,
  openDocumentDownload,
  restoreDocument,
  searchDocuments,
  setDocumentStatus,
  setDocumentVisibility,
  setReferenceVersion,
  storeDocumentFile,
  updateDocument,
  uploadClientFile,
  uploadDocument,
  uploadDocumentVersion,
} from "@/modules/documents/document.service";
import { canDocumentTransition, DOCUMENT_TRANSITIONS } from "@/modules/documents/document.status";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createDocument,
  createMemberContext,
  createPortalTestContext,
  createProject,
  createSite,
  createTicket,
} from "../../helpers/factories";
import {
  createTempStorage,
  FailingStorage,
  pdfWith,
  PDF_BYTES,
  readAll,
  streamOf,
} from "./helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("module Documents", () => {
  let db: Database;
  let close: () => Promise<void>;
  let temp: Awaited<ReturnType<typeof createTempStorage>>;
  let deps: { storage: typeof temp.storage; maxBytes: number };
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;

  /** Rend chaque contenu unique : sinon un dépôt répété serait reconnu comme identique. */
  let counter = 0;
  const unique = () => pdfWith(`contenu ${(counter += 1)}`);

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    temp = await createTempStorage();
    deps = { storage: temp.storage, maxBytes: 1024 * 1024 };
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
  });

  afterAll(async () => {
    await close();
    await temp.cleanup();
  });

  const upload = (
    ctx: ServiceContext,
    input: Partial<Parameters<typeof uploadDocument>[1]> = {},
    bytes: Uint8Array = unique(),
  ) =>
    uploadDocument(
      ctx,
      { title: "Brief", filename: "brief.pdf", kind: "brief", ...input },
      streamOf(bytes),
      deps,
    );

  const audits = (entityId: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));

  describe("dépôt", () => {
    it("crée le document, sa version 1 et l'audit dans la même opération", async () => {
      const company = await createCompany(db);
      const { document, version, created } = await upload(admin, {
        companyId: company.id,
        title: "Contrat cadre",
        kind: "contract",
      });

      expect(created).toBe(true);
      expect(document).toMatchObject({
        title: "Contrat cadre",
        kind: "contract",
        visibility: "internal",
        status: "final",
        uploadedByClient: false,
        currentVersionId: version.id,
      });
      expect(version).toMatchObject({
        version: 1,
        filename: "brief.pdf",
        mimeType: "application/pdf",
        uploadedByUserId: admin.actor.userId,
      });
      expect(version.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await audits(document.id)).map((row) => row.action)).toContain("document.created");
    });

    it("répéter le même dépôt ne crée rien et ne garde pas de fichier en double", async () => {
      const company = await createCompany(db);
      const bytes = unique();
      const first = await upload(member, { companyId: company.id }, bytes);
      const second = await upload(member, { companyId: company.id }, bytes);

      expect(second.created).toBe(false);
      expect(second.document.id).toBe(first.document.id);
      const versions = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, first.document.id));
      expect(versions).toHaveLength(1);
      expect((await audits(first.document.id)).length).toBe(1);
    });

    it("deux dépôts identiques simultanés ne créent qu'un document", async () => {
      const company = await createCompany(db);
      const bytes = unique();
      const [a, b] = await Promise.all([
        upload(admin, { companyId: company.id }, bytes),
        upload(admin, { companyId: company.id }, bytes),
      ]);
      expect(a.document.id).toBe(b.document.id);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    });

    it("le même fichier sur un autre projet est un autre document", async () => {
      const company = await createCompany(db);
      const [p1, p2] = await Promise.all([
        createProject(db, { companyId: company.id }),
        createProject(db, { companyId: company.id }),
      ]);
      const bytes = unique();
      const a = await upload(admin, { projectId: p1.id }, bytes);
      const b = await upload(admin, { projectId: p2.id }, bytes);
      expect(b.created).toBe(true);
      expect(b.document.id).not.toBe(a.document.id);
    });

    it("reprend le client de l'objet lié", async () => {
      const project = await createProject(db);
      const { document } = await upload(admin, { projectId: project.id });
      expect(document.companyId).toBe(project.companyId);
    });

    it("refuse un rattachement à l'objet d'un autre client", async () => {
      const company = await createCompany(db);
      const other = await createProject(db);
      const rows = await db.select().from(schema.documents);
      await expect(upload(admin, { companyId: company.id, projectId: other.id })).rejects.toThrow(
        ValidationError,
      );
      await expect(upload(admin, { companyId: company.id, projectId: other.id })).rejects.toSatisfy(
        (error: ValidationError) => error.fieldErrors.projectId !== undefined,
      );
      expect(await db.select().from(schema.documents)).toHaveLength(rows.length);
    });

    it("refuse deux rattachements de clients différents, sans client saisi", async () => {
      const [project, site] = await Promise.all([createProject(db), createSite(db)]);
      await expect(upload(admin, { projectId: project.id, siteId: site.id })).rejects.toThrow(
        ValidationError,
      );
    });

    it.each([
      ["projectId", "Ce projet"],
      ["contractId", "Ce contrat"],
      ["siteId", "Ce site"],
      ["ticketId", "Cette demande"],
      ["quoteId", "Ce devis"],
    ])("refuse %s inconnu", async (field) => {
      await expect(upload(admin, { [field]: MISSING_ID })).rejects.toSatisfy(
        (error: ValidationError) => error.fieldErrors[field] !== undefined,
      );
    });

    it("refuse un objet archivé et un client archivé", async () => {
      const project = await createProject(db, { archivedAt: new Date() });
      await expect(upload(admin, { projectId: project.id })).rejects.toThrow(ValidationError);
      const company = await createCompany(db, { archivedAt: new Date() });
      await expect(upload(admin, { companyId: company.id })).rejects.toThrow(ValidationError);
    });

    it("refuse de partager un document sans client", async () => {
      await expect(upload(admin, { visibility: "client" })).rejects.toSatisfy(
        (error: ValidationError) => error.fieldErrors.visibility !== undefined,
      );
    });

    it("refuse un contenu qui ne correspond pas et n'écrit rien en base", async () => {
      const before = await db.select().from(schema.documents);
      await expect(
        upload(admin, { filename: "faux.pdf" }, new TextEncoder().encode("<html>")),
      ).rejects.toThrow(ValidationError);
      expect(await db.select().from(schema.documents)).toHaveLength(before.length);
    });

    it("une panne du stockage n'écrit rien en base", async () => {
      const before = await db.select().from(schema.documents);
      const failure = new ServiceUnavailableError("stockage", "unreachable", "Hors service");
      await expect(
        uploadDocument(admin, { title: "Panne", filename: "panne.pdf" }, streamOf(PDF_BYTES), {
          storage: new FailingStorage(failure),
          maxBytes: 1024,
        }),
      ).rejects.toBe(failure);
      expect(await db.select().from(schema.documents)).toHaveLength(before.length);
    });

    it("un échec en base retire le fichier déjà déposé", async () => {
      const removed: string[] = [];
      const company = await createCompany(db);
      const storage = {
        write: temp.storage.write.bind(temp.storage),
        read: temp.storage.read.bind(temp.storage),
        remove: async (key: string) => {
          removed.push(key);
          await temp.storage.remove(key);
        },
      };
      const failing = {
        ...admin,
        db: new Proxy(db, {
          get(target, property) {
            if (property === "transaction") {
              return () => Promise.reject(new Error("Base hors service"));
            }
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
      await expect(
        uploadDocument(
          failing,
          { title: "Échec", filename: "echec.pdf", companyId: company.id },
          streamOf(unique()),
          { storage, maxBytes: 1024 * 1024 },
        ),
      ).rejects.toThrow("Base hors service");
      expect(removed).toHaveLength(1);
    });

    it.each(["contractor", "viewer"] as const)("refuse le dépôt à %s", async (role) => {
      const ctx = await createTestContext(db, role);
      await expect(upload(ctx)).rejects.toThrow(ForbiddenError);
    });

    it("exige un compte d'équipe pour déposer un fichier brut", async () => {
      const ctx = await createTestContext(db, "viewer");
      await expect(
        storeDocumentFile(ctx, { filename: "a.pdf" }, streamOf(PDF_BYTES), deps),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("attachDocument", () => {
    it("rattache un fichier déposé, de façon idempotente sur la clé", async () => {
      const project = await createProject(db);
      const file = await storeDocumentFile(
        member,
        { filename: "livrable.pdf" },
        streamOf(unique()),
        deps,
      );
      const first = await attachDocument(member, {
        title: "Livrable",
        kind: "deliverable",
        projectId: project.id,
        file,
      });
      const second = await attachDocument(member, {
        title: "Livrable",
        kind: "deliverable",
        projectId: project.id,
        file,
      });
      expect(first.companyId).toBe(project.companyId);
      expect(second.id).toBe(first.id);
    });

    it("refuse sans droit et hors du client", async () => {
      const file = {
        storageKey: "2026/11/00000000-0000-4000-8000-000000000001",
        filename: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "0".repeat(64),
      };
      await expect(attachDocument(viewer, { title: "Refus", kind: "other", file })).rejects.toThrow(
        ForbiddenError,
      );
      const company = await createCompany(db);
      const other = await createContract(db);
      await expect(
        attachDocument(admin, {
          title: "Croisé",
          kind: "contract",
          companyId: company.id,
          contractId: other.id,
          file,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("versions", () => {
    it("ajoute une version qui devient la référence, avec son audit", async () => {
      const { document } = await upload(admin, { title: "Maquette" });
      const { version, created } = await uploadDocumentVersion(
        member,
        { documentId: document.id, filename: "maquette-v2.pdf", note: "Corrections" },
        streamOf(unique()),
        deps,
      );
      expect(created).toBe(true);
      expect(version.version).toBe(2);

      const detail = await getDocumentDetail(admin, document.id);
      expect(detail.document.currentVersionId).toBe(version.id);
      expect(detail.versions.map((row) => row.version)).toEqual([2, 1]);
      expect(detail.versions[0]).toMatchObject({
        filename: "maquette-v2.pdf",
        note: "Corrections",
      });
      expect((await audits(document.id)).map((row) => row.action)).toContain(
        "document.version_added",
      );
    });

    it("un fichier identique à la référence ne crée pas de version", async () => {
      const bytes = unique();
      const { document } = await upload(admin, { title: "Identique" }, bytes);
      const { created, version } = await uploadDocumentVersion(
        admin,
        { documentId: document.id, filename: "brief.pdf" },
        streamOf(bytes),
        deps,
      );
      expect(created).toBe(false);
      expect(version.version).toBe(1);
    });

    it("deux envois simultanés ne se disputent pas un numéro", async () => {
      const { document } = await upload(admin, { title: "Concurrence" });
      const [a, b] = await Promise.all([
        uploadDocumentVersion(
          admin,
          { documentId: document.id, filename: "a.pdf" },
          streamOf(unique()),
          deps,
        ),
        uploadDocumentVersion(
          admin,
          { documentId: document.id, filename: "b.pdf" },
          streamOf(unique()),
          deps,
        ),
      ]);
      expect([a.version.version, b.version.version].sort()).toEqual([2, 3]);
    });

    it.each(["to_validate", "validated", "signed"] as const)(
      "un nouveau fichier fait retomber %s en brouillon",
      async (status) => {
        const { document } = await upload(admin, { title: `Accord ${status}`, status });
        const { document: updated } = await uploadDocumentVersion(
          admin,
          { documentId: document.id, filename: "v2.pdf" },
          streamOf(unique()),
          deps,
        );
        expect(updated.status).toBe("draft");
      },
    );

    it("un document définitif garde son statut", async () => {
      const { document } = await upload(admin, { title: "Définitif" });
      const { document: updated } = await uploadDocumentVersion(
        admin,
        { documentId: document.id, filename: "v2.pdf" },
        streamOf(unique()),
        deps,
      );
      expect(updated.status).toBe("final");
    });

    it("désigne une ancienne version comme référence, jamais celle d'un autre document", async () => {
      const { document, version: v1 } = await upload(admin, { title: "Référence" });
      await uploadDocumentVersion(
        admin,
        { documentId: document.id, filename: "v2.pdf" },
        streamOf(unique()),
        deps,
      );
      const updated = await setReferenceVersion(member, { id: document.id, versionId: v1.id });
      expect(updated.currentVersionId).toBe(v1.id);

      const other = await upload(admin, { title: "Autre" });
      await expect(
        setReferenceVersion(member, { id: document.id, versionId: other.version.id }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuse une version sur un document archivé ou inconnu", async () => {
      const { document } = await upload(admin, { title: "Archivé" });
      await archiveDocument(admin, document.id);
      await expect(
        uploadDocumentVersion(
          admin,
          { documentId: document.id, filename: "v2.pdf" },
          streamOf(unique()),
          deps,
        ),
      ).rejects.toThrow(ConflictError);
      await expect(
        uploadDocumentVersion(
          admin,
          { documentId: MISSING_ID, filename: "v2.pdf" },
          streamOf(unique()),
          deps,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuse à un lecteur", async () => {
      const { document } = await upload(admin, { title: "Lecteur" });
      await expect(
        uploadDocumentVersion(
          viewer,
          { documentId: document.id, filename: "v2.pdf" },
          streamOf(unique()),
          deps,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("machine à états", () => {
    const all = DOCUMENT_STATUSES as readonly DocumentStatus[];
    const paths = all.flatMap((from) => all.map((to) => [from, to] as const));

    it.each(paths.filter(([from, to]) => from !== to))(
      "de %s à %s suit la table",
      async (from, to) => {
        const { document } = await createDocument(db, { status: from });
        const allowed = DOCUMENT_TRANSITIONS[from].includes(to);
        expect(canDocumentTransition(from, to)).toBe(allowed);
        if (allowed) {
          expect((await setDocumentStatus(member, { id: document.id, status: to })).status).toBe(
            to,
          );
        } else {
          await expect(setDocumentStatus(member, { id: document.id, status: to })).rejects.toThrow(
            ConflictError,
          );
        }
      },
    );

    it("répéter le même statut ne journalise rien", async () => {
      const { document } = await createDocument(db, { status: "draft" });
      await setDocumentStatus(member, { id: document.id, status: "draft" });
      expect(await audits(document.id)).toHaveLength(0);
    });

    it("refuse à un lecteur et sur un document inconnu", async () => {
      const { document } = await createDocument(db);
      await expect(setDocumentStatus(viewer, { id: document.id, status: "draft" })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(setDocumentStatus(admin, { id: MISSING_ID, status: "draft" })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("partage et modification", () => {
    it("partage au client puis repasse en interne, chaque fois journalisé une fois", async () => {
      const company = await createCompany(db);
      const { document } = await createDocument(db, { companyId: company.id });
      expect(
        (await setDocumentVisibility(member, { id: document.id, visibility: "client" })).visibility,
      ).toBe("client");
      await setDocumentVisibility(member, { id: document.id, visibility: "client" });
      await setDocumentVisibility(member, { id: document.id, visibility: "internal" });
      const actions = (await audits(document.id)).map((row) => row.action);
      expect(actions.filter((action) => action === "document.visibility_changed")).toHaveLength(2);
    });

    it("refuse de partager un document sans client", async () => {
      const { document } = await createDocument(db);
      await expect(
        setDocumentVisibility(admin, { id: document.id, visibility: "client" }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuse de masquer à un client son propre fichier", async () => {
      const company = await createCompany(db);
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "client",
        uploadedByClient: true,
      });
      await expect(
        setDocumentVisibility(admin, { id: document.id, visibility: "internal" }),
      ).rejects.toThrow(ConflictError);
    });

    it("modifie titre, type et rattachements", async () => {
      const project = await createProject(db);
      const { document } = await createDocument(db);
      const updated = await updateDocument(member, {
        id: document.id,
        title: "Nouveau titre",
        kind: "minutes",
        companyId: project.companyId,
        projectId: project.id,
      });
      expect(updated).toMatchObject({
        title: "Nouveau titre",
        kind: "minutes",
        companyId: project.companyId,
        projectId: project.id,
      });
    });

    it("refuse un lien vers un autre client, et de changer le client d'un document partagé", async () => {
      const company = await createCompany(db);
      const other = await createCompany(db);
      const foreign = await createSite(db);
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "client",
      });
      await expect(
        updateDocument(member, {
          id: document.id,
          title: "Croisé",
          kind: "other",
          companyId: company.id,
          siteId: foreign.id,
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        updateDocument(member, {
          id: document.id,
          title: "Autre client",
          kind: "other",
          companyId: other.id,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("refuse de déplacer le fichier d'un client vers un autre", async () => {
      const company = await createCompany(db);
      const other = await createCompany(db);
      const { document } = await createDocument(db, {
        companyId: company.id,
        visibility: "client",
        uploadedByClient: true,
      });
      await expect(
        updateDocument(admin, {
          id: document.id,
          title: "Déplacé",
          kind: "client_file",
          companyId: other.id,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("archive et restaure sans rien supprimer, de façon idempotente", async () => {
      const { document, version } = await createDocument(db);
      const archived = await archiveDocument(member, document.id);
      expect(archived.archivedAt).toBeInstanceOf(Date);
      await archiveDocument(member, document.id);
      const restored = await restoreDocument(member, document.id);
      expect(restored.archivedAt).toBeNull();
      await restoreDocument(member, document.id);

      const actions = (await audits(document.id)).map((row) => row.action);
      expect(actions.filter((action) => action === "document.archived")).toHaveLength(1);
      expect(actions.filter((action) => action === "document.restored")).toHaveLength(1);
      expect(
        await db
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, version.id)),
      ).toHaveLength(1);
    });

    it.each(["contractor", "viewer"] as const)("refuse toute modification à %s", async (role) => {
      const ctx = await createTestContext(db, role);
      const { document } = await createDocument(db);
      const input = { id: document.id, title: "Refus", kind: "other" as const };
      await expect(updateDocument(ctx, input)).rejects.toThrow(ForbiddenError);
      await expect(archiveDocument(ctx, document.id)).rejects.toThrow(ForbiddenError);
      await expect(restoreDocument(ctx, document.id)).rejects.toThrow(ForbiddenError);
      await expect(
        setDocumentVisibility(ctx, { id: document.id, visibility: "internal" }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("recherche et listes", () => {
    let searchCompany: schema.Company;
    let searchProject: schema.Project;
    let searchContract: schema.Contract;

    beforeAll(async () => {
      searchCompany = await createCompany(db, { name: "Société Éphémère" });
      searchProject = await createProject(db, {
        companyId: searchCompany.id,
        number: "P-2099-042",
        name: "Refonte vitrine",
      });
      searchContract = await createContract(db, {
        companyId: searchCompany.id,
        number: "C-2099-007",
        name: "Maintenance annuelle",
      });
      await createDocument(db, { companyId: searchCompany.id, title: "Spécification zéphyr" });
      await createDocument(db, {
        companyId: searchCompany.id,
        projectId: searchProject.id,
        title: "Cahier projet",
      });
      await createDocument(db, {
        companyId: searchCompany.id,
        contractId: searchContract.id,
        title: "Avenant contrat",
      });
    });

    it.each([
      ["le titre", "zéphyr", ["Spécification zéphyr"]],
      ["le titre, sans accent", "zephyr", ["Spécification zéphyr"]],
      ["un préfixe", "cahi", ["Cahier projet"]],
      ["le numéro de projet", "P-2099-042", ["Cahier projet"]],
      ["le nom de projet", "refonte", ["Cahier projet"]],
      ["le numéro de contrat", "C-2099-007", ["Avenant contrat"]],
      ["le nom de contrat", "maintenance annuelle", ["Avenant contrat"]],
      ["plusieurs champs à la fois", "ephemere cahier", ["Cahier projet"]],
    ])("trouve par %s", async (_label, search, expected) => {
      const { items } = await searchDocuments(admin, { search });
      expect(items.map((row) => row.title)).toEqual(expected);
    });

    it("trouve par client, sans accent", async () => {
      const { items, total } = await searchDocuments(admin, { search: "societe" });
      expect(total).toBe(3);
      expect(items.every((row) => row.companyName === "Société Éphémère")).toBe(true);
    });

    it("une saisie sans mot utile ne filtre rien et n'injecte rien", async () => {
      const { total } = await searchDocuments(admin, { search: "'; DROP TABLE documents; --" });
      expect(total).toBe(0);
      const all = await searchDocuments(admin, { search: "&|!():*" });
      expect(all.total).toBeGreaterThan(0);
    });

    it("filtre par client, projet et contrat", async () => {
      expect((await searchDocuments(admin, { companyId: searchCompany.id })).total).toBe(3);
      expect((await searchDocuments(admin, { projectId: searchProject.id })).total).toBe(1);
      expect((await searchDocuments(admin, { contractId: searchContract.id })).total).toBe(1);
    });

    it("pagine côté serveur", async () => {
      const company = await createCompany(db);
      for (let index = 0; index < 5; index += 1) {
        await createDocument(db, { companyId: company.id, title: `Page ${index}` });
      }
      const first = await searchDocuments(admin, { companyId: company.id }, { pageSize: 2 });
      const second = await searchDocuments(
        admin,
        { companyId: company.id },
        { page: 2, pageSize: 2 },
      );
      expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(2);
      expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    });

    it("plafonne la taille d'une page", async () => {
      const result = await searchDocuments(admin, {}, { pageSize: 10_000 });
      expect(result.pageSize).toBe(100);
    });

    it("n'affiche les archives qu'à la demande", async () => {
      const company = await createCompany(db);
      const { document } = await createDocument(db, { companyId: company.id });
      await archiveDocument(admin, document.id);
      expect((await searchDocuments(admin, { companyId: company.id })).total).toBe(0);
      expect((await searchDocuments(admin, { companyId: company.id, archived: true })).total).toBe(
        1,
      );
    });

    it("décrit le rattachement et le nombre de versions", async () => {
      const { items } = await searchDocuments(admin, { projectId: searchProject.id });
      expect(items[0]).toMatchObject({
        companyName: "Société Éphémère",
        projectNumber: "P-2099-042",
        version: 1,
        versionCount: 1,
        filename: expect.stringMatching(/\.pdf$/),
      });
    });

    it("listDocumentsFor renvoie des lignes compactes, avec leur lien de téléchargement", async () => {
      const rows = await listDocumentsFor(viewer, { projectId: searchProject.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: "Cahier projet",
        linkLabel: "Projet P-2099-042",
        version: 1,
      });
      expect(rows[0]?.downloadHref).toBe(`/api/documents/${rows[0]?.id}/download`);
    });

    it("listDocumentsForCompany respecte la limite", async () => {
      const rows = await listDocumentsForCompany(viewer, searchCompany.id, { limit: 2 });
      expect(rows).toHaveLength(2);
    });

    it("listDocumentsFor filtre par site et par demande", async () => {
      const company = await createCompany(db);
      const [site, ticket] = await Promise.all([
        createSite(db, { companyId: company.id }),
        createTicket(db, { companyId: company.id }),
      ]);
      await createDocument(db, { companyId: company.id, siteId: site.id, title: "Doc site" });
      await createDocument(db, {
        companyId: company.id,
        ticketId: ticket.id,
        title: "Doc demande",
      });
      expect((await listDocumentsFor(admin, { siteId: site.id })).map((row) => row.title)).toEqual([
        "Doc site",
      ]);
      expect(
        (await listDocumentsFor(admin, { ticketId: ticket.id })).map((row) => row.title),
      ).toEqual(["Doc demande"]);
    });

    it("propose les objets du client seulement, sans les archivés", async () => {
      const company = await createCompany(db);
      await createProject(db, { companyId: company.id, number: "P-OPT-1", name: "Visible" });
      await createProject(db, {
        companyId: company.id,
        number: "P-OPT-2",
        archivedAt: new Date(),
      });
      await createProject(db, { number: "P-OPT-3" });
      const options = await listDocumentLinkOptions(member, company.id);
      expect(options.projects.map((row) => row.label)).toEqual(["P-OPT-1 · Visible"]);
      await expect(listDocumentLinkOptions(viewer, company.id)).rejects.toThrow(ForbiddenError);
      await expect(listDocumentCompanyOptions(viewer)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("périmètre d'un prestataire", () => {
    let contractor: Awaited<ReturnType<typeof createMemberContext>>;
    let assigned: schema.Project;
    let foreign: schema.Project;
    let assignedDocument: schema.Document;
    let foreignDocument: schema.Document;
    let clientlessDocument: schema.Document;

    beforeAll(async () => {
      contractor = await createMemberContext(db, "contractor");
      assigned = await createProject(db);
      foreign = await createProject(db);
      await db
        .insert(schema.projectMembers)
        .values({ projectId: assigned.id, memberId: contractor.member.id });
      ({ document: assignedDocument } = await createDocument(db, {
        companyId: assigned.companyId,
        projectId: assigned.id,
        title: "Brief du prestataire",
      }));
      ({ document: foreignDocument } = await createDocument(db, {
        companyId: foreign.companyId,
        projectId: foreign.id,
        title: "Brief interdit",
      }));
      ({ document: clientlessDocument } = await createDocument(db, { title: "Procédure interne" }));
    });

    it("lit le document de son projet, même interne", async () => {
      const document = await assertDocumentReadable(contractor, assignedDocument.id);
      expect(document.visibility).toBe("internal");
      expect((await getDocumentDetail(contractor, assignedDocument.id)).versions).toHaveLength(1);
    });

    it("répond 404 hors de ses projets", async () => {
      for (const id of [foreignDocument.id, clientlessDocument.id]) {
        await expect(assertDocumentReadable(contractor, id)).rejects.toThrow(NotFoundError);
        await expect(getDocumentDetail(contractor, id)).rejects.toThrow(NotFoundError);
      }
    });

    it("la liste ne contient que ses projets, dans la requête", async () => {
      const { items, total } = await searchDocuments(contractor, {});
      expect(total).toBe(1);
      expect(items.map((row) => row.id)).toEqual([assignedDocument.id]);
      expect(await listDocumentsFor(contractor, { projectId: foreign.id })).toEqual([]);
      expect(await listDocumentsForCompany(contractor, foreign.companyId)).toEqual([]);
    });

    it("sans fiche d'équipe ni projet, rien", async () => {
      const other = await createTestContext(db, "contractor");
      expect((await searchDocuments(other, {})).total).toBe(0);
      await expect(assertDocumentReadable(other, assignedDocument.id)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("ne voit plus un document archivé, ni par la liste ni par le lien", async () => {
      const { document } = await createDocument(db, {
        companyId: assigned.companyId,
        projectId: assigned.id,
      });
      await archiveDocument(admin, document.id);
      await expect(assertDocumentReadable(contractor, document.id)).rejects.toThrow(NotFoundError);
      expect((await searchDocuments(contractor, { archived: true })).total).toBe(0);
    });

    it("le rôle reste en lecture", async () => {
      await expect(archiveDocument(contractor, assignedDocument.id)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("portail client", () => {
    let portal: Awaited<ReturnType<typeof createPortalTestContext>>;
    let otherPortal: Awaited<ReturnType<typeof createPortalTestContext>>;
    let shared: schema.Document;
    let internal: schema.Document;
    let foreign: schema.Document;

    beforeAll(async () => {
      portal = await createPortalTestContext(db);
      otherPortal = await createPortalTestContext(db);
      ({ document: shared } = await createDocument(db, {
        companyId: portal.companyId,
        visibility: "client",
        title: "Devis partagé",
        kind: "quote",
      }));
      ({ document: internal } = await createDocument(db, {
        companyId: portal.companyId,
        visibility: "internal",
        title: "Note interne",
      }));
      ({ document: foreign } = await createDocument(db, {
        companyId: otherPortal.companyId,
        visibility: "client",
        title: "Devis d'un autre client",
      }));
    });

    it("ne lit que les documents partagés de son entreprise", async () => {
      await expect(assertDocumentReadable(portal, shared.id)).resolves.toMatchObject({
        id: shared.id,
      });
      await expect(assertDocumentReadable(portal, internal.id)).rejects.toThrow(NotFoundError);
      await expect(assertDocumentReadable(portal, foreign.id)).rejects.toThrow(NotFoundError);
      await expect(assertDocumentReadable(portal, MISSING_ID)).rejects.toThrow(NotFoundError);
      await expect(assertDocumentReadable(portal, "pas-un-uuid")).rejects.toThrow(NotFoundError);
    });

    it("n'a plus accès à un document archivé ou repassé en interne", async () => {
      const { document } = await createDocument(db, {
        companyId: portal.companyId,
        visibility: "client",
      });
      await setDocumentVisibility(admin, { id: document.id, visibility: "internal" });
      await expect(assertDocumentReadable(portal, document.id)).rejects.toThrow(NotFoundError);
      await setDocumentVisibility(admin, { id: document.id, visibility: "client" });
      await assertDocumentReadable(portal, document.id);
      await archiveDocument(admin, document.id);
      await expect(assertDocumentReadable(portal, document.id)).rejects.toThrow(NotFoundError);
    });

    it("la liste du portail est cloisonnée et n'expose rien d'interne", async () => {
      const { items, total } = await listDocumentsForPortal(portal);
      expect(items.map((row) => row.title)).toContain("Devis partagé");
      expect(items.map((row) => row.title)).not.toContain("Note interne");
      expect(items.map((row) => row.title)).not.toContain("Devis d'un autre client");
      expect(total).toBe(items.length);
      expect(Object.keys(items[0] ?? {})).not.toEqual(
        expect.arrayContaining(["visibility", "companyId", "note"]),
      );
    });

    it("filtre par type et par origine, sans jamais élargir", async () => {
      const quotes = await listDocumentsForPortal(portal, { kinds: ["quote"] });
      expect(quotes.items.every((row) => row.kind === "quote")).toBe(true);
      const foreignProject = await createProject(db, { companyId: otherPortal.companyId });
      const crossed = await listDocumentsForPortal(portal, { projectId: foreignProject.id });
      expect(crossed.total).toBe(0);
    });

    it("dépose un fichier : client, visibilité et origine imposés", async () => {
      const { document, version, created } = await uploadClientFile(
        portal,
        { filename: "photos.pdf", note: "Photos de la boutique" },
        streamOf(unique()),
        deps,
      );
      expect(created).toBe(true);
      expect(document).toMatchObject({
        companyId: portal.companyId,
        visibility: "client",
        uploadedByClient: true,
        kind: "client_file",
        title: "photos.pdf",
      });
      expect(version.uploadedByUserId).toBe(portal.actor.userId);
      expect((await audits(document.id)).map((row) => row.action)).toContain(
        "portal.document_uploaded",
      );
      const mine = await listDocumentsForPortal(portal, { uploadedByClient: true });
      expect(mine.items.map((row) => row.id)).toContain(document.id);
    });

    it("ignore toute tentative d'imposer un autre client ou une autre visibilité", async () => {
      const { document } = await uploadClientFile(
        portal,
        {
          filename: "tentative.pdf",
          companyId: otherPortal.companyId,
          visibility: "internal",
          uploadedByClient: false,
        } as never,
        streamOf(unique()),
        deps,
      );
      expect(document).toMatchObject({
        companyId: portal.companyId,
        visibility: "client",
        uploadedByClient: true,
      });
    });

    it("répond 404 sur le projet ou la demande d'un autre client, sans rien écrire", async () => {
      const before = await db.select().from(schema.documents);
      const project = await createProject(db, { companyId: otherPortal.companyId });
      const ticket = await createTicket(db, { companyId: otherPortal.companyId });
      await expect(
        uploadClientFile(
          portal,
          { filename: "a.pdf", projectId: project.id },
          streamOf(unique()),
          deps,
        ),
      ).rejects.toThrow(NotFoundError);
      await expect(
        uploadClientFile(
          portal,
          { filename: "a.pdf", ticketId: ticket.id },
          streamOf(unique()),
          deps,
        ),
      ).rejects.toThrow(NotFoundError);
      expect(await db.select().from(schema.documents)).toHaveLength(before.length);
    });

    it("rattache à son propre projet", async () => {
      const project = await createProject(db, { companyId: portal.companyId });
      const { document } = await uploadClientFile(
        portal,
        { filename: "contenu.pdf", projectId: project.id },
        streamOf(unique()),
        deps,
      );
      expect(document.projectId).toBe(project.id);
    });

    it("un nouveau dépôt identique ne crée rien", async () => {
      const bytes = unique();
      const first = await uploadClientFile(portal, { filename: "x.pdf" }, streamOf(bytes), deps);
      const second = await uploadClientFile(portal, { filename: "x.pdf" }, streamOf(bytes), deps);
      expect(second.created).toBe(false);
      expect(second.document.id).toBe(first.document.id);
    });

    it("n'est pas leurré par un document interne identique de l'équipe", async () => {
      const bytes = unique();
      const staff = await upload(
        admin,
        { companyId: portal.companyId, title: "miroir.pdf", filename: "miroir.pdf" },
        bytes,
      );
      const client = await uploadClientFile(
        portal,
        { filename: "miroir.pdf" },
        streamOf(bytes),
        deps,
      );
      expect(client.created).toBe(true);
      expect(client.document.id).not.toBe(staff.document.id);
    });
  });

  describe("téléchargement", () => {
    it("restitue le fichier, journalise et donne le nom d'origine", async () => {
      const bytes = unique();
      const { document } = await upload(
        admin,
        { filename: "Brief été.pdf", title: "Download" },
        bytes,
      );
      const file = await openDocumentDownload(viewer, document.id, {}, deps);
      expect(file).toMatchObject({
        filename: "Brief été.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
      });
      expect(await readAll(file.stream)).toEqual(Buffer.from(bytes));
      expect((await audits(document.id)).map((row) => row.action)).toContain("document.downloaded");
    });

    it("sert une ancienne version à l'équipe, la référence seule au portail", async () => {
      const portal = await createPortalTestContext(db);
      const v1 = unique();
      const v2 = unique();
      const { document } = await upload(
        admin,
        { companyId: portal.companyId, visibility: "client", title: "Versions" },
        v1,
      );
      await uploadDocumentVersion(
        admin,
        { documentId: document.id, filename: "v2.pdf" },
        streamOf(v2),
        deps,
      );

      const old = await openDocumentDownload(admin, document.id, { version: 1 }, deps);
      expect(await readAll(old.stream)).toEqual(Buffer.from(v1));

      const client = await openDocumentDownload(portal, document.id, { version: 1 }, deps);
      expect(await readAll(client.stream)).toEqual(Buffer.from(v2));
    });

    it("répond 404 hors périmètre, version inconnue, fichier disparu", async () => {
      const portal = await createPortalTestContext(db);
      const { document } = await upload(admin, { title: "Hors portail" });
      await expect(openDocumentDownload(portal, document.id, {}, deps)).rejects.toThrow(
        NotFoundError,
      );
      await expect(openDocumentDownload(admin, document.id, { version: 99 }, deps)).rejects.toThrow(
        NotFoundError,
      );
      const seeded = await createDocument(db);
      await expect(openDocumentDownload(admin, seeded.document.id, {}, deps)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("rien au journal si le fichier n'a pas pu être ouvert", async () => {
      const seeded = await createDocument(db);
      await expect(openDocumentDownload(admin, seeded.document.id, {}, deps)).rejects.toThrow();
      expect(await audits(seeded.document.id)).toHaveLength(0);
    });

    it("une panne du stockage reste une indisponibilité, sans journal", async () => {
      const { document, version } = await createDocument(db);
      const failure = new ServiceUnavailableError("stockage", "unreachable", "Hors service");
      await expect(
        openDocumentDownload(admin, document.id, {}, { storage: new FailingStorage(failure) }),
      ).rejects.toBe(failure);
      expect(version.documentId).toBe(document.id);
      expect(await audits(document.id)).toHaveLength(0);
    });
  });

  describe("permissions de lecture", () => {
    it("refuse le rôle client par un contexte de service", async () => {
      const ctx = await createTestContext(db, "client");
      const { document } = await createDocument(db);
      await expect(assertDocumentReadable(ctx, document.id)).rejects.toThrow(ForbiddenError);
      await expect(searchDocuments(ctx)).rejects.toThrow(ForbiddenError);
      await expect(listDocumentsFor(ctx, {})).rejects.toThrow(ForbiddenError);
    });

    it.each(["admin", "member", "viewer"] as const)("%s lit tout", async (role) => {
      const ctx = await createTestContext(db, role);
      const { document } = await createDocument(db);
      await expect(assertDocumentReadable(ctx, document.id)).resolves.toMatchObject({
        id: document.id,
      });
    });

    it("un identifiant mal formé répond 404, pas une erreur de validation", async () => {
      await expect(assertDocumentReadable(admin, "pas-un-uuid")).rejects.toThrow(NotFoundError);
      await expect(getDocumentDetail(admin, "pas-un-uuid")).rejects.toThrow(NotFoundError);
    });
  });
});
