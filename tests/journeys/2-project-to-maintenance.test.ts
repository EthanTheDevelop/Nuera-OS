import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContractRecord, linkContractSite } from "@/modules/contracts/contract.service";
import { createContract } from "@/modules/contracts/contract.service";
import { dispatchPendingEvents } from "@/modules/platform/automation.service";
import {
  getPortalHome,
  getPortalSitePage,
  submitDeliverableReview,
} from "@/modules/portal/portal.service";
import { createDeliverable, submitDeliverable } from "@/modules/projects/production.service";
import {
  changeProjectStatus,
  getProjectDetail,
  goLiveProject,
} from "@/modules/projects/project.service";
import { createSite, getSite } from "@/modules/sites/site.service";
import * as s from "@/server/db/schema";
import { createPortalTestContext } from "../helpers/factories";
import {
  createJourneyWorld,
  eventsOf,
  notificationsOf,
  sellProject,
  type JourneyWorld,
} from "./world";

describe("parcours 2 : projet → livrables et validations → mise en ligne → site actif → maintenance", () => {
  let world: JourneyWorld;

  beforeAll(async () => {
    world = await createJourneyWorld();
  });
  afterAll(async () => world.close());

  it("va jusqu'au contrat actif, vu par l'agence et par le client", async () => {
    const { admin, member, viewer, db } = world;
    const { company, project } = await sellProject(world, "Atelier Parcours Deux");
    const client = await createPortalTestContext(db, { company });

    await changeProjectStatus(member, { projectId: project.id, status: "active" });

    // Un site en préparation et le contrat qui le suivra, avant la mise en ligne.
    const site = await createSite(member, {
      companyId: company.id,
      projectId: project.id,
      name: "Site de l'atelier",
      primaryDomain: "atelier-parcours-deux.example",
      kind: "vitrine",
    });
    expect(site.status).toBe("planned");
    const contract = await createContract(admin, {
      companyId: company.id,
      name: "Maintenance de l'atelier",
      kind: "maintenance",
      priceCents: 9_900,
      period: "monthly",
      startOn: "2026-11-01",
      includedMinutes: 120,
    });
    expect(contract.status).toBe("to_start");
    await linkContractSite(admin, contract.id, { siteId: site.id });

    // Livrable soumis : le client le voit à valider, l'agence ne peut pas livrer sans lui.
    const deliverable = await createDeliverable(member, {
      projectId: project.id,
      title: "Maquette d'accueil",
      requiresClientValidation: true,
      feedbackRoundsIncluded: 2,
    });
    await submitDeliverable(member, { deliverableId: deliverable.id });
    await changeProjectStatus(member, { projectId: project.id, status: "in_validation" });
    await expect(goLiveProject(member, { projectId: project.id })).rejects.toThrow(
      /Validation client en attente/,
    );

    const toReview = await getPortalHome(client, { selectedProjectId: project.id });
    expect(toReview.home?.deliverables.find((row) => row.id === deliverable.id)).toMatchObject({
      status: "to_validate",
      version: 1,
    });
    expect(toReview.nextAction?.label).toBeTruthy();

    // Le client demande un changement : l'agence le lit, une nouvelle version repart.
    await submitDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "changes_requested",
      comment: "Le logo plus grand.",
      seen: { projectId: project.id, version: 1 },
    });
    const afterChanges = await getProjectDetail(member, project.id);
    const seenByAgency = afterChanges.deliverables.find((row) => row.id === deliverable.id);
    expect(seenByAgency).toMatchObject({ status: "changes_requested", feedbackRoundsUsed: 1 });
    expect(seenByAgency?.reviews[0]).toMatchObject({
      decision: "changes_requested",
      comment: "Le logo plus grand.",
    });

    await submitDeliverable(member, { deliverableId: deliverable.id });
    await submitDeliverableReview(client, {
      deliverableId: deliverable.id,
      decision: "validated",
      seen: { projectId: project.id, version: 2 },
    });

    // Mise en ligne : projet livré, site actif, contrat démarré, une seule fois.
    const delivered = await goLiveProject(member, { projectId: project.id });
    expect(delivered.status).toBe("delivered");
    await goLiveProject(member, { projectId: project.id });

    const liveSite = await getSite(viewer, site.id);
    expect(liveSite.site.status).toBe("live");
    expect(liveSite.site.liveOn).not.toBeNull();
    expect(await eventsOf(db, "site.live", site.id)).toHaveLength(1);
    expect(await eventsOf(db, "project.delivered", project.id)).toHaveLength(1);

    const record = await getContractRecord(admin, contract.id);
    expect(record.contract.status).toBe("active");
    expect(record.sites.map((row) => row.siteId)).toEqual([site.id]);
    expect(record.events.map((row) => row.kind)).toContain("note");
    const [started] = await db
      .select()
      .from(s.contracts)
      .where(and(eq(s.contracts.id, contract.id), eq(s.contracts.status, "active")));
    expect(started).toBeDefined();

    // Côté client : projet livré, site en ligne, contrat lisible.
    const home = await getPortalHome(client, { selectedProjectId: project.id });
    expect(home.projects.find((row) => row.id === project.id)?.stage).toBe("delivered");
    const page = await getPortalSitePage(client, site.id);
    expect(page.site).toMatchObject({ id: site.id, status: "live" });
    expect(page.contracts.map((row) => row.id)).toContain(contract.id);

    // Le responsable reçoit le retour du client, sans doublon au second passage.
    await dispatchPendingEvents(db);
    await dispatchPendingEvents(db);
    const reviewed = (await notificationsOf(db, admin.actor.userId)).filter(
      (row) =>
        row.entityId === deliverable.id &&
        row.kind === "deliverable" &&
        row.severity === "info" &&
        row.title.includes("validé"),
    );
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.href).toBe(`/projets/${project.id}`);
  });
});
