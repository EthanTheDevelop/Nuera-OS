import { describe, expect, it } from "vitest";
import { OPPORTUNITY_STAGES as CRM_STAGES } from "@/integrations/twenty/crm-gateway";
import { OPPORTUNITY_STAGES } from "@/lib/domain-enums";
import { consumeContractQuota, resolveCoverage } from "@/modules/contracts/contract.service";
import { assertDocumentReadable, attachDocument } from "@/modules/documents/document.service";
import { getMargin } from "@/modules/finance/profitability.service";
import { notify } from "@/modules/platform/notifications.service";
import { createProjectFromQuote } from "@/modules/projects/project.service";
import { activateSiteAfterGoLive } from "@/modules/sites/site.service";
import { openIncidentTicket } from "@/modules/support/ticket.service";
import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";

const db = {} as Database;
const ctx = {} as ServiceContext;

/** Les squelettes du §6 existent et signalent clairement le lot qui doit les livrer. */
describe("signatures du contrat (§6)", () => {
  it.each<[string, string, () => Promise<unknown>]>([
    [
      "createProjectFromQuote",
      "Projets",
      () =>
        createProjectFromQuote(ctx, db, {
          quoteId: "q",
          opportunityId: null,
          companyId: "c",
          versionId: "v",
        }),
    ],
    [
      "activateSiteAfterGoLive",
      "Sites",
      () => activateSiteAfterGoLive(ctx, db, { projectId: "p", siteId: "s" }),
    ],
    ["resolveCoverage", "Contrats", () => resolveCoverage(db, { companyId: "c", category: "bug" })],
    [
      "consumeContractQuota",
      "Contrats",
      () => consumeContractQuota(db, { contractId: "c", minutes: 30, ticketId: null }),
    ],
    [
      "openIncidentTicket",
      "Support",
      () => openIncidentTicket(db, { siteId: "s", title: "Panne", source: "uptime_kuma" }),
    ],
    ["getMargin", "Finances", () => getMargin(db, { scope: "project", id: "p" })],
    [
      "attachDocument",
      "Documents",
      () =>
        attachDocument(ctx, {
          title: "Brief",
          kind: "brief",
          file: {
            storageKey: "k",
            filename: "f.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1,
            sha256: "0",
          },
        }),
    ],
    ["assertDocumentReadable", "Documents", () => assertDocumentReadable(ctx, "d")],
    [
      "notify",
      "Automatisations",
      () =>
        notify(db, {
          role: "admin",
          kind: "site.down",
          severity: "danger",
          title: "Panne",
          dedupeKey: "k",
        }),
    ],
  ])("%s lève une erreur nommant le lot %s", async (name, lot, call) => {
    await expect(call()).rejects.toThrow(name);
    await expect(call()).rejects.toThrow(lot);
  });
});

describe("cohérence avec le port CRM", () => {
  it("partage les mêmes étapes d'opportunité", () => {
    expect(OPPORTUNITY_STAGES).toEqual(CRM_STAGES);
  });
});
