import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  getKnowledgeArticle,
  listKnowledgeArticles,
  listKnowledgeLinkOptions,
  restoreKnowledgeArticle,
  restoreKnowledgeArticleVersion,
  updateKnowledgeArticle,
} from "@/modules/documents/knowledge.service";
import {
  createTemplate,
  getTemplate,
  listProjectPlanTemplates,
  listTemplates,
  setTemplateActive,
  updateTemplate,
} from "@/modules/documents/template.service";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createTestContext, createTestDatabase } from "../../helpers/db";
import { createProject, createSite } from "../../helpers/factories";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("connaissances et modèles", () => {
  let db: Database;
  let close: () => Promise<void>;
  let admin: ServiceContext;
  let member: ServiceContext;
  let viewer: ServiceContext;
  let contractor: ServiceContext;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    admin = await createTestContext(db, "admin");
    member = await createTestContext(db, "member");
    viewer = await createTestContext(db, "viewer");
    contractor = await createTestContext(db, "contractor");
  });
  afterAll(() => close());

  const audits = (entityId: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));

  describe("articles", () => {
    it("crée un article et sa version 1, lié à un site ou un projet", async () => {
      const site = await createSite(db);
      const project = await createProject(db);
      const article = await createKnowledgeArticle(member, {
        kind: "technical",
        title: "Restaurer une sauvegarde",
        body: "Étape 1",
        siteId: site.id,
        projectId: project.id,
      });
      expect(article).toMatchObject({ version: 1, siteId: site.id, projectId: project.id });

      const { article: detail, versions } = await getKnowledgeArticle(viewer, article.id);
      expect(detail.authorName).toBe(member.actor.name);
      expect(detail.siteName).toBe(site.name);
      expect(detail.projectNumber).toBe(project.number);
      expect(versions.map((row) => row.version)).toEqual([1]);
      expect((await audits(article.id)).map((row) => row.action)).toEqual([
        "knowledge_article.created",
      ]);
    });

    it("refuse un site ou un projet inconnu", async () => {
      await expect(
        createKnowledgeArticle(member, {
          kind: "technical",
          title: "Lien cassé",
          body: "x",
          siteId: MISSING_ID,
        }),
      ).rejects.toSatisfy((error: ValidationError) => error.fieldErrors.siteId !== undefined);
      await expect(
        createKnowledgeArticle(member, {
          kind: "technical",
          title: "Lien cassé",
          body: "x",
          projectId: MISSING_ID,
        }),
      ).rejects.toSatisfy((error: ValidationError) => error.fieldErrors.projectId !== undefined);
    });

    it("deux créations simultanées ne donnent qu'un article et qu'un journal", async () => {
      const input = { kind: "internal" as const, title: "Double clic", body: "Contenu" };
      const [first, second] = await Promise.all([
        createKnowledgeArticle(member, input),
        createKnowledgeArticle(member, input),
      ]);
      expect(second.id).toBe(first.id);
      expect(await audits(first.id)).toHaveLength(1);
    });

    it("filtre par site et par projet liés", async () => {
      const site = await createSite(db);
      const project = await createProject(db);
      const onSite = await createKnowledgeArticle(member, {
        kind: "technical",
        title: "Restauration du site",
        body: "Étapes",
        siteId: site.id,
      });
      const onProject = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Cadrage du projet",
        body: "Étapes",
        projectId: project.id,
      });
      const bySite = await listKnowledgeArticles(viewer, { siteId: site.id });
      expect(bySite.items.map((row) => row.id)).toEqual([onSite.id]);
      const byProject = await listKnowledgeArticles(viewer, { projectId: project.id });
      expect(byProject.items.map((row) => row.id)).toEqual([onProject.id]);
    });

    it("répéter la création renvoie le même article ; un autre contenu est refusé", async () => {
      const input = { kind: "faq" as const, title: "Formulaire muet", body: "Vérifier SMTP" };
      const first = await createKnowledgeArticle(member, input);
      const second = await createKnowledgeArticle(member, input);
      expect(second.id).toBe(first.id);
      await expect(
        createKnowledgeArticle(member, { ...input, body: "Autre réponse" }),
      ).rejects.toThrow(ConflictError);
    });

    it("un nouveau contenu ajoute une version, le reste non", async () => {
      const article = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Mise en ligne",
        body: "v1",
      });
      const edited = await updateKnowledgeArticle(admin, {
        id: article.id,
        expectedVersion: 1,
        kind: "internal",
        title: "Mise en ligne",
        body: "v2",
      });
      expect(edited.version).toBe(2);
      expect(edited.authorUserId).toBe(admin.actor.userId);

      const renamed = await updateKnowledgeArticle(member, {
        id: article.id,
        expectedVersion: 2,
        kind: "technical",
        title: "Mettre en ligne",
        body: "v2",
      });
      expect(renamed.version).toBe(2);
      expect(renamed.title).toBe("Mettre en ligne");
      expect(renamed.authorUserId).toBe(admin.actor.userId);

      const { versions } = await getKnowledgeArticle(viewer, article.id);
      expect(versions.map((row) => [row.version, row.body])).toEqual([
        [2, "v2"],
        [1, "v1"],
      ]);
    });

    it("une répétition de la même modification ne change rien", async () => {
      const article = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Répétition",
        body: "v1",
      });
      const input = {
        id: article.id,
        expectedVersion: 1,
        kind: "internal" as const,
        title: "Répétition",
        body: "v2",
      };
      await updateKnowledgeArticle(member, input);
      const repeated = await updateKnowledgeArticle(member, input);
      expect(repeated.version).toBe(2);
      expect((await getKnowledgeArticle(viewer, article.id)).versions).toHaveLength(2);
    });

    it("une modification depuis une version périmée est refusée, pas écrasée", async () => {
      const article = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Concurrence",
        body: "v1",
      });
      const base = { id: article.id, kind: "internal" as const, title: "Concurrence" };
      await updateKnowledgeArticle(member, { ...base, expectedVersion: 1, body: "de Hugo" });
      await expect(
        updateKnowledgeArticle(admin, { ...base, expectedVersion: 1, body: "de Camille" }),
      ).rejects.toThrow(ConflictError);
      const { article: detail } = await getKnowledgeArticle(viewer, article.id);
      expect(detail.body).toBe("de Hugo");
    });

    it("reprendre une ancienne version en crée une nouvelle, sans réécrire l'historique", async () => {
      const article = await createKnowledgeArticle(member, {
        kind: "internal",
        title: "Reprise",
        body: "ancien",
      });
      await updateKnowledgeArticle(member, {
        id: article.id,
        expectedVersion: 1,
        kind: "internal",
        title: "Reprise",
        body: "nouveau",
      });
      const restored = await restoreKnowledgeArticleVersion(member, { id: article.id, version: 1 });
      expect(restored).toMatchObject({ version: 3, body: "ancien" });
      const again = await restoreKnowledgeArticleVersion(member, { id: article.id, version: 1 });
      expect(again.version).toBe(3);
      const { versions } = await getKnowledgeArticle(viewer, article.id);
      expect(versions.map((row) => row.body)).toEqual(["ancien", "nouveau", "ancien"]);
      await expect(
        restoreKnowledgeArticleVersion(member, { id: article.id, version: 42 }),
      ).rejects.toThrow(NotFoundError);
    });

    it("archive et restaure, sans doublon de journal, et bloque la modification", async () => {
      const article = await createKnowledgeArticle(member, {
        kind: "faq",
        title: "Archive",
        body: "x",
      });
      await archiveKnowledgeArticle(member, article.id);
      await archiveKnowledgeArticle(member, article.id);
      await expect(
        updateKnowledgeArticle(member, {
          id: article.id,
          expectedVersion: 1,
          kind: "faq",
          title: "Archive",
          body: "y",
        }),
      ).rejects.toThrow(ConflictError);
      await expect(
        restoreKnowledgeArticleVersion(member, { id: article.id, version: 1 }),
      ).rejects.toThrow(ConflictError);

      const active = await listKnowledgeArticles(viewer, { search: "Archive" });
      expect(active.items.map((row) => row.id)).not.toContain(article.id);
      const archived = await listKnowledgeArticles(viewer, { search: "Archive", archived: true });
      expect(archived.items.map((row) => row.id)).toContain(article.id);

      await restoreKnowledgeArticle(member, article.id);
      const actions = (await audits(article.id)).map((row) => row.action);
      expect(actions.filter((action) => action === "knowledge_article.archived")).toHaveLength(1);
      expect(actions).toContain("knowledge_article.restored");
    });

    it("recherche par titre, contenu, type, site et sans accent, avec pagination", async () => {
      const site = await createSite(db, { name: "kine-rive-gauche" });
      await createKnowledgeArticle(member, {
        kind: "technical",
        title: "Procédure très spécifique",
        body: "Le certificat expire",
        siteId: site.id,
      });
      expect((await listKnowledgeArticles(viewer, { search: "procedure tres" })).total).toBe(1);
      expect((await listKnowledgeArticles(viewer, { search: "certificat" })).total).toBe(1);
      expect((await listKnowledgeArticles(viewer, { search: "rive" })).total).toBe(1);
      expect(
        (await listKnowledgeArticles(viewer, { kind: "technical", search: "zzz" })).total,
      ).toBe(0);
      const page = await listKnowledgeArticles(viewer, {}, { pageSize: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(1);
    });

    it("permissions par rôle", async () => {
      const input = { kind: "faq" as const, title: "Droits", body: "x" };
      await expect(createKnowledgeArticle(viewer, input)).rejects.toThrow(ForbiddenError);
      await expect(createKnowledgeArticle(contractor, input)).rejects.toThrow(ForbiddenError);
      await expect(listKnowledgeArticles(contractor)).rejects.toThrow(ForbiddenError);
      await expect(listKnowledgeLinkOptions(viewer)).rejects.toThrow(ForbiddenError);
      const article = await createKnowledgeArticle(member, input);
      await expect(getKnowledgeArticle(contractor, article.id)).rejects.toThrow(ForbiddenError);
      await expect(archiveKnowledgeArticle(viewer, article.id)).rejects.toThrow(ForbiddenError);
    });

    it("répond 404 sur un article inconnu ou un identifiant mal formé", async () => {
      await expect(getKnowledgeArticle(viewer, MISSING_ID)).rejects.toThrow(NotFoundError);
      await expect(getKnowledgeArticle(viewer, "pas-un-uuid")).rejects.toThrow(NotFoundError);
    });

    it("valide la saisie", async () => {
      await expect(
        createKnowledgeArticle(member, { kind: "faq", title: "x", body: "contenu" }),
      ).rejects.toThrow(ValidationError);
      await expect(
        createKnowledgeArticle(member, { kind: "faq", title: "Sans contenu", body: "   " }),
      ).rejects.toThrow(ValidationError);
      await expect(
        createKnowledgeArticle(member, { kind: "autre" as never, title: "Type", body: "x" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("modèles", () => {
    it("crée un modèle de chaque type, avec le bon contenu", async () => {
      const brief = await createTemplate(member, {
        kind: "brief",
        activity: "vitrine",
        name: "Brief vitrine",
        body: "Objectifs, cibles",
      });
      expect(brief).toMatchObject({ kind: "brief", activity: "vitrine", active: true, items: [] });

      const checklist = await createTemplate(member, {
        kind: "checklist",
        name: "Recette",
        items: "Formulaires testés\r\n\r\n  Certificat valide  \n",
      });
      expect(checklist.items).toEqual(["Formulaires testés", "Certificat valide"]);

      const message = await createTemplate(member, {
        kind: "message",
        name: "Relance",
        body: "Bonjour",
      });
      expect(message.activity).toBeNull();

      const plan = await createTemplate(member, {
        kind: "project_plan",
        activity: "ecommerce",
        name: "Plan boutique",
        items: ["Cadrage", "Recette"],
      });
      expect(plan.items).toEqual(["Cadrage", "Recette"]);
      expect((await audits(plan.id)).map((row) => row.action)).toEqual(["template.created"]);
    });

    it.each([
      ["checklist", { name: "Vide", items: "" }, "items"],
      ["project_plan", { name: "Vide", items: [] }, "items"],
      ["brief", { name: "Vide", body: "" }, "body"],
      ["message", { name: "Vide" }, "body"],
    ] as const)("%s sans contenu est refusé", async (kind, input, field) => {
      await expect(createTemplate(member, { kind, ...input } as never)).rejects.toSatisfy(
        (error: ValidationError) => error.fieldErrors[field] !== undefined,
      );
    });

    it("deux créations simultanées ne donnent qu'un modèle", async () => {
      const input = { kind: "brief" as const, name: "Double clic", body: "Structure" };
      const [first, second] = await Promise.all([
        createTemplate(member, input),
        createTemplate(member, input),
      ]);
      expect(second.id).toBe(first.id);
      expect(await audits(first.id)).toHaveLength(1);
    });

    it("la recherche trouve aussi un point de checklist", async () => {
      await createTemplate(member, {
        kind: "checklist",
        name: "Avant livraison",
        items: ["Contrôler les redirections"],
      });
      const found = await listTemplates(viewer, { search: "redirections" });
      expect(found.items.map((row) => row.name)).toEqual(["Avant livraison"]);
    });

    it("répéter la création renvoie le même modèle ; un autre contenu est refusé", async () => {
      const input = { kind: "message" as const, name: "Bienvenue", body: "Bonjour et bienvenue" };
      const first = await createTemplate(member, input);
      const second = await createTemplate(member, input);
      expect(second.id).toBe(first.id);
      expect(await audits(first.id)).toHaveLength(1);
      await expect(createTemplate(member, { ...input, body: "Autre" })).rejects.toThrow(
        ConflictError,
      );
    });

    it("le même nom est permis pour un autre type", async () => {
      await createTemplate(member, { kind: "message", name: "Mise en ligne", body: "Texte" });
      const checklist = await createTemplate(member, {
        kind: "checklist",
        name: "Mise en ligne",
        items: ["DNS"],
      });
      expect(checklist.kind).toBe("checklist");
    });

    it("modifie un modèle, sans prendre le nom d'un autre", async () => {
      const a = await createTemplate(member, { kind: "brief", name: "Brief A", body: "A" });
      await createTemplate(member, { kind: "brief", name: "Brief B", body: "B" });
      const updated = await updateTemplate(member, {
        id: a.id,
        kind: "brief",
        name: "Brief A2",
        body: "A2",
        activity: "landing",
      });
      expect(updated).toMatchObject({ name: "Brief A2", body: "A2", activity: "landing" });
      await expect(
        updateTemplate(member, { id: a.id, kind: "brief", name: "Brief B", body: "x" }),
      ).rejects.toThrow(ConflictError);
      await expect(
        updateTemplate(member, { id: MISSING_ID, kind: "brief", name: "Inconnu", body: "x" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("désactive puis réactive, sans doublon de journal", async () => {
      const template = await createTemplate(member, { kind: "brief", name: "Ancien", body: "x" });
      await setTemplateActive(member, { id: template.id, active: false });
      await setTemplateActive(member, { id: template.id, active: false });
      expect((await listTemplates(viewer, { search: "ancien" })).total).toBe(0);
      expect((await listTemplates(viewer, { search: "ancien", active: false })).total).toBe(1);

      const reactivated = await setTemplateActive(member, { id: template.id, active: true });
      expect(reactivated.active).toBe(true);
      const actions = (await audits(template.id)).map((row) => row.action);
      expect(actions.filter((action) => action === "template.deactivated")).toHaveLength(1);
    });

    it("refuse de réactiver un modèle si son nom a été repris", async () => {
      const first = await createTemplate(member, { kind: "message", name: "Doublon", body: "x" });
      await setTemplateActive(member, { id: first.id, active: false });
      await createTemplate(member, { kind: "message", name: "Doublon", body: "y" });
      await expect(setTemplateActive(member, { id: first.id, active: true })).rejects.toThrow(
        ConflictError,
      );
    });

    it("filtre par type et recherche, avec pagination", async () => {
      await createTemplate(member, { kind: "checklist", name: "Passation", items: ["Accès"] });
      const checklists = await listTemplates(viewer, { kinds: ["checklist"] });
      expect(checklists.items.every((row) => row.kind === "checklist")).toBe(true);
      expect((await listTemplates(viewer, { search: "passation" })).total).toBe(1);
      const page = await listTemplates(viewer, {}, { pageSize: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.total).toBeGreaterThan(1);
    });

    it("sert au lot Projets les plans de l'activité, puis les génériques", async () => {
      const generic = await createTemplate(admin, {
        kind: "project_plan",
        name: "Plan générique",
        items: ["Démarrage"],
      });
      const specific = await createTemplate(admin, {
        kind: "project_plan",
        activity: "landing",
        name: "Plan landing",
        items: ["Maquette"],
      });
      const plans = await listProjectPlanTemplates(member, { activity: "landing" });
      expect(plans[0]?.id).toBe(specific.id);
      expect(plans.map((row) => row.id)).toContain(generic.id);
      expect(plans.every((row) => row.kind === "project_plan")).toBe(true);
    });

    it("garde lisibles les éléments du seed et ignore ce qui n'est pas du texte", async () => {
      const [row] = await db
        .insert(schema.templates)
        .values({ kind: "checklist", name: "Mixte", items: ["ok", { name: "objet" }, 3] })
        .returning();
      if (!row) throw new Error("Insertion manquante");
      expect((await getTemplate(viewer, row.id)).items).toEqual(["ok"]);
    });

    it("permissions par rôle et 404", async () => {
      const input = { kind: "brief" as const, name: "Droits", body: "x" };
      await expect(createTemplate(viewer, input)).rejects.toThrow(ForbiddenError);
      await expect(createTemplate(contractor, input)).rejects.toThrow(ForbiddenError);
      await expect(listTemplates(contractor)).rejects.toThrow(ForbiddenError);
      await expect(listProjectPlanTemplates(contractor)).rejects.toThrow(ForbiddenError);
      const template = await createTemplate(member, input);
      await expect(getTemplate(contractor, template.id)).rejects.toThrow(ForbiddenError);
      await expect(setTemplateActive(viewer, { id: template.id, active: false })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(getTemplate(viewer, MISSING_ID)).rejects.toThrow(NotFoundError);
      await expect(getTemplate(viewer, "pas-un-uuid")).rejects.toThrow(NotFoundError);
    });
  });
});
