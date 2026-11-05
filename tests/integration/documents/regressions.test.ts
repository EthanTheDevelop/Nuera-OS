import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contentDisposition,
  isPreviewable,
  withCurrentLinks,
} from "@/modules/documents/document.format";
import {
  attachDocument,
  assertDocumentReadable,
  getDocumentDetail,
  listDocumentsFor,
  openDocumentDownload,
  searchDocuments,
  setDocumentStatus,
  setReferenceVersion,
  storeDocumentFile,
  updateDocument,
  uploadDocument,
  uploadDocumentVersion,
} from "@/modules/documents/document.service";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  restoreKnowledgeArticle,
  updateKnowledgeArticle,
} from "@/modules/documents/knowledge.service";
import {
  createTemplate,
  setTemplateActive,
  updateTemplate,
} from "@/modules/documents/template.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import {
  createCompany,
  createContract,
  createDocument,
  createMemberContext,
  createProject,
  createQuote,
  createSite,
  createTicket,
} from "../../helpers/factories";
import { createTempStorage, pdfWith, readAll, streamOf } from "./helpers";

/** Défauts trouvés à l'audit du lot : chaque test échouait avant sa correction. */
describe("documents et connaissances : régressions", () => {
  let db: Database;
  let close: () => Promise<void>;
  let temp: Awaited<ReturnType<typeof createTempStorage>>;
  let deps: { storage: typeof temp.storage; maxBytes: number };
  let admin: ServiceContext;
  let member: ServiceContext;
  let counter = 0;
  const unique = () => pdfWith(`régression ${(counter += 1)}`);

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    temp = await createTempStorage();
    deps = { storage: temp.storage, maxBytes: 1024 * 1024 };
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
  });

  afterAll(async () => {
    await close();
    await temp.cleanup();
  });

  const audits = (entityId: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));

  const upload = (input: Partial<Parameters<typeof uploadDocument>[1]> = {}) =>
    uploadDocument(
      admin,
      { title: "Brief", filename: "brief.pdf", kind: "brief", ...input },
      streamOf(unique()),
      deps,
    );

  describe("périmètre d'un prestataire", () => {
    let contractor: Awaited<ReturnType<typeof createMemberContext>>;
    let project: schema.Project;

    beforeAll(async () => {
      contractor = await createMemberContext(db, "contractor");
      project = await createProject(db);
      await db
        .insert(schema.projectMembers)
        .values({ projectId: project.id, memberId: contractor.member.id });
    });

    it("lit les pièces de la demande qui lui est assignée, et pas celles des autres", async () => {
      const company = await createCompany(db);
      const mine = await createTicket(db, {
        companyId: company.id,
        assigneeMemberId: contractor.member.id,
      });
      const other = await createTicket(db, { companyId: company.id });
      const { document: attached } = await createDocument(db, {
        companyId: company.id,
        ticketId: mine.id,
        title: "Capture de la panne",
      });
      const { document: foreign } = await createDocument(db, {
        companyId: company.id,
        ticketId: other.id,
        title: "Capture d'un autre",
      });

      const rows = await listDocumentsFor(contractor, { ticketId: mine.id });
      expect(rows.map((row) => row.id)).toEqual([attached.id]);
      await expect(assertDocumentReadable(contractor, attached.id)).resolves.toMatchObject({
        id: attached.id,
      });
      expect(await listDocumentsFor(contractor, { ticketId: other.id })).toEqual([]);
      await expect(assertDocumentReadable(contractor, foreign.id)).rejects.toThrow(NotFoundError);
    });

    it("perd les pièces d'une demande réattribuée", async () => {
      const ticket = await createTicket(db, { assigneeMemberId: contractor.member.id });
      const { document } = await createDocument(db, {
        companyId: ticket.companyId,
        ticketId: ticket.id,
      });
      await expect(assertDocumentReadable(contractor, document.id)).resolves.toBeDefined();
      await db
        .update(schema.tickets)
        .set({ assigneeMemberId: null })
        .where(eq(schema.tickets.id, ticket.id));
      await expect(assertDocumentReadable(contractor, document.id)).rejects.toThrow(NotFoundError);
    });

    it("ne voit ni devis, ni contrat, ni facture de son projet : il n'a pas ces droits", async () => {
      const contract = await createContract(db, { companyId: project.companyId });
      const { quote } = await createQuote(db, { companyId: project.companyId });
      const commercial = [
        { kind: "quote", title: "Devis signé" },
        { kind: "contract", title: "Contrat cadre" },
        { kind: "invoice", title: "Facture" },
        { kind: "other", title: "Annexe au contrat", contractId: contract.id },
        { kind: "other", title: "Annexe au devis", quoteId: quote.id },
      ] as const;
      const ids: string[] = [];
      for (const values of commercial) {
        const { document } = await createDocument(db, {
          companyId: project.companyId,
          projectId: project.id,
          ...values,
        });
        ids.push(document.id);
      }
      const { document: brief } = await createDocument(db, {
        companyId: project.companyId,
        projectId: project.id,
        kind: "brief",
        title: "Brief lisible",
      });

      const { items } = await searchDocuments(contractor, { projectId: project.id });
      expect(items.map((row) => row.id)).toEqual([brief.id]);
      for (const id of ids) {
        await expect(assertDocumentReadable(contractor, id)).rejects.toThrow(NotFoundError);
        await expect(getDocumentDetail(contractor, id)).rejects.toThrow(NotFoundError);
        await expect(openDocumentDownload(contractor, id, {}, deps)).rejects.toThrow(NotFoundError);
      }
      // Une personne avec `finance:read` les voit tous.
      expect((await searchDocuments(admin, { projectId: project.id })).total).toBe(6);
    });
  });

  describe("version de référence", () => {
    it.each(["validated", "signed"] as const)(
      "changer la référence d'un document %s le fait retomber en brouillon",
      async (status) => {
        const { document, version: v1 } = await upload({ title: `Accord ${status}`, status });
        const second = await uploadDocumentVersion(
          admin,
          { documentId: document.id, filename: "v2.pdf" },
          streamOf(unique()),
          deps,
        );
        expect(second.document.status).toBe("draft");
        await setDocumentStatus(admin, { id: document.id, status: "to_validate" });
        await setDocumentStatus(admin, { id: document.id, status: "validated" });
        if (status === "signed") {
          await setDocumentStatus(admin, { id: document.id, status: "signed" });
        }

        const updated = await setReferenceVersion(admin, {
          id: document.id,
          versionId: v1.id,
        });
        expect(updated.currentVersionId).toBe(v1.id);
        expect(updated.status).toBe("draft");
      },
    );

    it("un document définitif garde son statut", async () => {
      const { document, version: v1 } = await upload({ title: "Définitif" });
      await uploadDocumentVersion(
        admin,
        { documentId: document.id, filename: "v2.pdf" },
        streamOf(unique()),
        deps,
      );
      const updated = await setReferenceVersion(admin, { id: document.id, versionId: v1.id });
      expect(updated.status).toBe("final");
    });
  });

  describe("rattachements devenus archivés", () => {
    it("renommer un document garde le projet archivé entre-temps", async () => {
      const project = await createProject(db);
      const { document } = await upload({ title: "Sur projet", projectId: project.id });
      await db
        .update(schema.projects)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projects.id, project.id));

      const updated = await updateDocument(member, {
        id: document.id,
        title: "Sur projet renommé",
        kind: "brief",
        companyId: project.companyId,
        projectId: project.id,
      });
      expect(updated).toMatchObject({ title: "Sur projet renommé", projectId: project.id });
    });

    it("renommer un document garde le client archivé entre-temps", async () => {
      const company = await createCompany(db);
      const { document } = await upload({ title: "Chez un ancien client", companyId: company.id });
      await db
        .update(schema.companies)
        .set({ archivedAt: new Date() })
        .where(eq(schema.companies.id, company.id));

      const updated = await updateDocument(member, {
        id: document.id,
        title: "Chez un ancien client, renommé",
        kind: "brief",
        companyId: company.id,
      });
      expect(updated.companyId).toBe(company.id);
    });

    it("refuse toujours de se rattacher à un nouvel objet archivé", async () => {
      const company = await createCompany(db);
      const project = await createProject(db, { companyId: company.id });
      const { document } = await upload({ title: "Nouveau lien", companyId: company.id });
      await db
        .update(schema.projects)
        .set({ archivedAt: new Date() })
        .where(eq(schema.projects.id, project.id));

      await expect(
        updateDocument(member, {
          id: document.id,
          title: "Nouveau lien",
          kind: "brief",
          companyId: company.id,
          projectId: project.id,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("refuse de garder un lien vers l'objet d'un autre client en changeant de client", async () => {
      const project = await createProject(db);
      const other = await createCompany(db);
      const { document } = await upload({ title: "Change de client", projectId: project.id });

      await expect(
        updateDocument(member, {
          id: document.id,
          title: "Change de client",
          kind: "brief",
          companyId: other.id,
          projectId: project.id,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("modifier un article garde le site archivé entre-temps", async () => {
      const site = await createSite(db);
      const article = await createKnowledgeArticle(member, {
        kind: "technical",
        title: "Procédure d'un site archivé",
        body: "Étape 1",
        siteId: site.id,
      });
      await db
        .update(schema.sites)
        .set({ archivedAt: new Date() })
        .where(eq(schema.sites.id, site.id));

      const updated = await updateKnowledgeArticle(member, {
        id: article.id,
        expectedVersion: article.version,
        kind: "technical",
        title: "Procédure d'un site archivé",
        body: "Étape 1 et 2",
        siteId: site.id,
      });
      expect(updated).toMatchObject({ siteId: site.id, version: 2 });
    });
  });

  describe("un seul article par titre", () => {
    it("refuse de renommer un article avec le titre d'un autre", async () => {
      await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Titre déjà pris",
        body: "Contenu A",
      });
      const other = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Titre libre",
        body: "Contenu B",
      });
      await expect(
        updateKnowledgeArticle(member, {
          id: other.id,
          expectedVersion: other.version,
          kind: "internal",
          title: "Titre déjà pris",
          body: "Contenu B",
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("refuse de restaurer un article dont le titre a été repris", async () => {
      const first = await createKnowledgeArticle(member, {
        kind: "faq",
        title: "Titre repris",
        body: "Ancien",
      });
      await archiveKnowledgeArticle(member, first.id);
      await createKnowledgeArticle(member, { kind: "faq", title: "Titre repris", body: "Nouveau" });

      await expect(restoreKnowledgeArticle(member, first.id)).rejects.toThrow(ConflictError);
    });
  });

  describe("modèles", () => {
    it("répéter la même modification n'écrit rien", async () => {
      const template = await createTemplate(member, {
        kind: "checklist",
        name: "Recette",
        items: ["Liens", "Formulaires"],
      });
      const input = {
        id: template.id,
        kind: "checklist" as const,
        name: "Recette v2",
        items: ["Liens", "Formulaires"],
      };
      const first = await updateTemplate(member, input);
      const logged = (await audits(template.id)).length;
      const second = await updateTemplate(member, input);

      expect(second.updatedAt).toEqual(first.updatedAt);
      expect(await audits(template.id)).toHaveLength(logged);
    });

    it("réactiver reste refusé si le nom a été repris", async () => {
      const template = await createTemplate(member, {
        kind: "message",
        name: "Relance",
        body: "Bonjour",
      });
      await setTemplateActive(member, { id: template.id, active: false });
      await createTemplate(member, { kind: "message", name: "Relance", body: "Autre" });
      await expect(setTemplateActive(member, { id: template.id, active: true })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe("attachDocument", () => {
    it("un contenu déjà rattaché ne laisse pas de fichier orphelin", async () => {
      const company = await createCompany(db);
      const bytes = unique();
      const store = () =>
        storeDocumentFile(admin, { filename: "piece.pdf" }, streamOf(bytes), deps);
      const first = await store();
      const second = await store();
      const input = { title: "Pièce", kind: "other" as const, companyId: company.id };

      const a = await attachDocument(admin, { ...input, file: first }, deps);
      const b = await attachDocument(admin, { ...input, file: second }, deps);

      expect(b.id).toBe(a.id);
      await expect(deps.storage.read(second.storageKey)).rejects.toThrow();
      const kept = await deps.storage.read(first.storageKey);
      expect(await readAll(kept.stream)).toEqual(Buffer.from(bytes));
    });
  });

  describe("listDocumentsFor", () => {
    it("filtre aussi par devis, pour la fiche d'un devis signé", async () => {
      const { quote } = await createQuote(db);
      const { document } = await upload({ title: "Devis signé", quoteId: quote.id });
      await upload({ title: "Autre" });
      const rows = await listDocumentsFor(member, { quoteId: quote.id });
      expect(rows.map((row) => row.id)).toEqual([document.id]);
    });
  });

  describe("formulaire de modification", () => {
    it("propose le lien en place, même absent de la liste, sans doublon", async () => {
      const project = await createProject(db);
      const { document } = await upload({ title: "Lien en place", projectId: project.id });
      const { document: row } = await getDocumentDetail(member, document.id);

      const missing = withCurrentLinks(null, row);
      expect(missing.projects.map((option) => option.id)).toEqual([project.id]);
      expect(missing.projects[0]?.label).toContain(project.number);

      const present = withCurrentLinks(
        { projects: missing.projects, contracts: [], sites: [], tickets: [], quotes: [] },
        row,
      );
      expect(present.projects).toHaveLength(1);
    });
  });

  describe("aperçu", () => {
    it("n'ouvre dans le navigateur que les PDF et les images matricielles", () => {
      for (const type of [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
      ]) {
        expect(isPreviewable(type)).toBe(true);
      }
      for (const type of ["image/svg+xml", "text/plain", "text/markdown", "application/zip"]) {
        expect(isPreviewable(type)).toBe(false);
      }
    });

    it("garde un en-tête sûr pour un nom piégé", () => {
      expect(contentDisposition('a"\r\nX: y.pdf', "inline")).toMatch(/^inline; filename="a___X: y/);
      expect(contentDisposition("a.pdf")).toMatch(/^attachment;/);
    });

    it("journalise l'aperçu à part d'un téléchargement", async () => {
      const { document } = await upload({ title: "À prévisualiser" });
      const file = await openDocumentDownload(member, document.id, { preview: true }, deps);
      await readAll(file.stream);
      const logged = (await audits(document.id)).filter(
        (row) => row.action === "document.downloaded",
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]?.metadata).toMatchObject({ preview: true, version: 1 });
    });
  });
});
