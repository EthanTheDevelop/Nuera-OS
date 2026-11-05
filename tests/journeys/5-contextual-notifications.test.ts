import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContract, changeContractStatus } from "@/modules/contracts/contract.service";
import { createInvoiceReference } from "@/modules/finance/finance.service";
import { runJob, type JobLock, type JobName } from "@/modules/platform/jobs.service";
import { createRequirement } from "@/modules/projects/production.service";
import { addDays, parisDay } from "@/modules/projects/project.rules";
import { changeProjectStatus } from "@/modules/projects/project.service";
import { createTask } from "@/modules/projects/task.service";
import { updateDomain } from "@/modules/sites/domain.service";
import { handleUptimeKumaNotification } from "@/modules/sites/monitoring.service";
import { changeSiteStatus, createSite, getSite } from "@/modules/sites/site.service";
import { listTickets } from "@/modules/support/ticket.service";
import { createTimeEntry } from "@/modules/time/time.service";
import type { ServiceContext } from "@/server/context";
import * as s from "@/server/db/schema";
import { createMemberContext, createPortalTestContext } from "../helpers/factories";
import { LINE } from "../integration/quotes/helpers";
import { createJourneyWorld, notificationsOf, sellProject, type JourneyWorld } from "./world";

const TODAY = parisDay(new Date());
const free: JobLock = async (_name, run) => {
  await run();
  return true;
};

const DAILY_JOBS: JobName[] = [
  "tasks-overdue",
  "requirements-overdue",
  "projects-budgets",
  "contracts-deadlines",
  "domains-expiring",
  "invoices-overdue",
];

describe("parcours 5 : retard, dépassement, renouvellement, panne, impayé → notification", () => {
  let world: JourneyWorld;
  let worker: ServiceContext & { member: s.TeamMember };
  let project: s.Project;
  let company: s.Company;
  let contract: s.Contract;
  let site: s.Site;
  let invoice: s.FinancialDocument;
  let taskId: string;
  const domainName = "parcours-cinq.example";

  /** Les vraies tâches planifiées, dans l'ordre de la nuit, puis le vrai répartiteur. */
  async function runNight() {
    for (const job of DAILY_JOBS) {
      const outcome = await runJob(world.db, job, { lock: free });
      expect(outcome, job).toMatchObject({ status: "succeeded" });
    }
    const dispatched = await runJob(world.db, "events-dispatch", { lock: free });
    expect(dispatched).toMatchObject({ status: "succeeded" });
  }

  const adminInbox = () => notificationsOf(world.db, world.admin.actor.userId);

  beforeAll(async () => {
    world = await createJourneyWorld();
    const { admin, member, db } = world;
    worker = await createMemberContext(db, "member", { hourlyCostCents: 6_000 });

    // Vendu 1 000 € : 16 h à 60 €/h, c'est 96 % de l'enveloppe.
    const sold = await sellProject(world, "Client Alertes", {
      lines: [{ ...LINE, unitPriceCents: 100_000, estimatedMinutes: 3_000 }],
    });
    project = sold.project;
    company = sold.company;
    await changeProjectStatus(member, { projectId: project.id, status: "active" });
    await createPortalTestContext(db, { company });

    // Retard : une tâche et un contenu client en retard.
    const task = await createTask(member, {
      projectId: project.id,
      title: "Intégrer la page d'accueil",
      assigneeMemberId: worker.member.id,
      dueOn: addDays(TODAY, -2),
    });
    taskId = task.id;
    await createRequirement(member, {
      projectId: project.id,
      label: "Photos de l'équipe",
      dueOn: addDays(TODAY, -4),
    });

    // Dépassement : le temps passé fait franchir 80 %.
    await createTimeEntry(worker, {
      projectId: project.id,
      category: "production",
      minutes: 960,
      workOn: TODAY,
    });

    // Renouvellement : un contrat et un domaine approchent de leur échéance.
    contract = await createContract(admin, {
      companyId: company.id,
      name: "Maintenance alertes",
      kind: "maintenance",
      priceCents: 9_900,
      period: "monthly",
      startOn: "2026-01-01",
      renewsOn: addDays(TODAY, 10),
    });
    await changeContractStatus(admin, contract.id, { status: "active" });

    // Panne : un site en ligne, surveillé.
    site = await createSite(member, {
      companyId: company.id,
      name: "Site alertes",
      primaryDomain: domainName,
      monitorId: "4242",
    });
    await changeSiteStatus(member, { id: site.id, status: "staging" });
    await changeSiteStatus(member, { id: site.id, status: "live" });
    // Le domaine principal est enregistré avec le site : son échéance se renseigne ensuite.
    const { domains } = await getSite(member, site.id);
    await updateDomain(member, {
      id: domains[0]?.id,
      siteId: site.id,
      expiresOn: addDays(TODAY, 12),
    });

    // Impayé : échéance dépassée. L'autre associé la saisit : l'auteur d'un geste n'est pas prévenu.
    const partner = await createMemberContext(db, "admin");
    invoice = await createInvoiceReference(partner, {
      companyId: company.id,
      projectId: project.id,
      issuerMemberId: (admin as unknown as { member: s.TeamMember }).member.id,
      externalRef: "IMPAYE-1",
      issuedOn: addDays(TODAY, -40),
      dueOn: addDays(TODAY, -10),
      amountCents: 40_000,
    });
  });
  afterAll(async () => world.close());

  it("chaque alerte arrive une fois, dit de quoi il s'agit et mène à l'objet", async () => {
    const { db, member, contractor } = world;
    await handleUptimeKumaNotification(db, {
      monitorId: "4242",
      state: "down",
      at: new Date(Date.now() - 60_000),
    });
    await runNight();

    const inbox = await adminInbox();
    const expectOne = (kind: string, title: RegExp, href: string, severity?: string) => {
      const rows = inbox.filter((row) => row.kind === kind && title.test(row.title));
      expect(rows, `${kind} ${title}`).toHaveLength(1);
      expect(rows[0]?.href).toBe(href);
      if (severity) expect(rows[0]?.severity).toBe(severity);
    };

    // Retard.
    expectOne(
      "task_overdue",
      /Intégrer la page d'accueil/,
      `/projets/${project.id}?tache=${taskId}`,
      "warning",
    );
    expectOne("requirement_overdue", /Photos de l'équipe/, `/projets/${project.id}`, "warning");
    // Dépassement.
    expectOne("budget_threshold", /./, `/projets/${project.id}`);
    // Renouvellement.
    expectOne("contract", new RegExp(contract.number), `/contrats/${contract.id}`, "warning");
    expectOne("domain_expiring", new RegExp(domainName), `/sites/${site.id}`);
    // Panne : l'alerte, et l'incident ouvert côté support.
    expectOne("site_down", new RegExp(domainName), `/sites/${site.id}`, "danger");
    const incidents = await listTickets(member, { filtre: "incidents" });
    expect(incidents.items.filter((row) => row.siteId === site.id)).toHaveLength(1);
    // Impayé.
    expectOne("invoice_overdue", /IMPAYE-1/, `/finances/factures/${invoice.id}`, "danger");

    // La personne assignée reçoit son retard, l'équipe la panne ; un prestataire étranger, rien.
    const assigned = await notificationsOf(db, worker.actor.userId);
    expect(assigned.filter((row) => row.kind === "task_overdue")).toHaveLength(1);
    expect((await notificationsOf(db, member.actor.userId)).map((row) => row.kind)).toContain(
      "site_down",
    );
    expect(await notificationsOf(db, contractor.actor.userId)).toEqual([]);

    // Le client est relancé par e-mail sur son contenu, jamais sur l'impayé interne.
    const mails = await db.select().from(s.emailOutbox);
    expect(mails.filter((row) => row.template === "client_requirement_reminder")).toHaveLength(1);

    const [row] = await db
      .select()
      .from(s.financialDocuments)
      .where(eq(s.financialDocuments.id, invoice.id));
    expect(row?.status).toBe("overdue");
  });

  it("une seconde nuit et la même panne redite ne répètent rien", async () => {
    const { db, member } = world;
    const snapshot = async () => ({
      notifications: await db.$count(s.notifications),
      events: await db.$count(s.domainEvents),
      mails: await db.$count(s.emailOutbox),
      tickets: await db.$count(s.tickets),
    });
    const before = await snapshot();

    expect(
      await handleUptimeKumaNotification(db, {
        monitorId: "4242",
        state: "down",
        at: new Date(Date.now() - 30_000),
      }),
    ).toBe("unchanged");
    await runNight();
    await runNight();

    expect(await snapshot()).toEqual(before);
    const incidents = await listTickets(member, { filtre: "incidents" });
    expect(incidents.items.filter((row) => row.siteId === site.id)).toHaveLength(1);
  });

  it("une nouvelle panne après le rétablissement alerte de nouveau", async () => {
    const { db } = world;
    const downAlerts = async () =>
      (await adminInbox()).filter((row) => row.kind === "site_down").length;
    expect(await downAlerts()).toBe(1);

    const later = Date.now() - 10_000;
    await handleUptimeKumaNotification(db, {
      monitorId: "4242",
      state: "up",
      at: new Date(later),
    });
    await handleUptimeKumaNotification(db, {
      monitorId: "4242",
      state: "down",
      at: new Date(later + 1_000),
    });
    await runJob(db, "events-dispatch", { lock: free });
    await runJob(db, "events-dispatch", { lock: free });
    expect(await downAlerts()).toBe(2);
  });
});
