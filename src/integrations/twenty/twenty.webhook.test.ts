import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UnauthenticatedError, ValidationError } from "@/server/errors";
import {
  checkTwentyWebhookSignature,
  parseTwentyWebhookEvent,
  receiveTwentyWebhook,
  TwentyWebhookRejectedError,
} from "./twenty.webhook";

const SECRET = "secret-de-test-sans-valeur-0123456789";
const NOW = 1_793_807_595_390;

/** Forme d'une livraison réelle de Twenty v2.55.0 (`company.updated`, champs réduits). */
const companyUpdated = {
  targetUrl: "http://host.docker.internal:3199/hook",
  eventName: "company.updated",
  objectMetadata: { id: "a28fa17b-1226-494f-9074-b271a1ebca97", nameSingular: "company" },
  workspaceId: "8e1968b0-de3a-4b91-a732-83b8067cb593",
  webhookId: "b4e21f5a-0aac-4a5f-8145-4765b5b9a814",
  eventDate: "2026-11-04T15:53:15.374Z",
  record: {
    id: "da87669e-ba7c-46bb-b88b-1da54989ba34",
    createdAt: "2026-11-04T15:53:15.337Z",
    updatedAt: "2026-11-04T15:53:15.400Z",
    deletedAt: null,
    name: "Société Évènement",
    domainName: { primaryLinkLabel: "", primaryLinkUrl: "wh.example", secondaryLinks: [] },
    address: { addressCity: "" },
    linkedinLink: { primaryLinkUrl: "", secondaryLinks: [] },
  },
  updatedFields: ["name"],
};

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
}

function delivery(payload: unknown = companyUpdated, timestamp = String(NOW)) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      "x-twenty-webhook-signature": sign(rawBody, timestamp),
      "x-twenty-webhook-timestamp": timestamp,
      "x-twenty-webhook-nonce": "a10d44253001fd6cebb572379814428b",
    } as Record<string, string | undefined>,
    secret: SECRET,
    nowMs: NOW,
  };
}

describe("checkTwentyWebhookSignature", () => {
  const check = (overrides: Partial<Parameters<typeof checkTwentyWebhookSignature>[0]> = {}) => {
    const rawBody = JSON.stringify(companyUpdated);
    return checkTwentyWebhookSignature({
      rawBody,
      signature: sign(rawBody, String(NOW)),
      timestamp: String(NOW),
      secret: SECRET,
      nowMs: NOW,
      ...overrides,
    });
  };

  it("accepte une signature valide sur chaîne ou octets bruts", () => {
    expect(check()).toEqual({ valid: true });
    expect(check({ rawBody: Buffer.from(JSON.stringify(companyUpdated), "utf8") })).toEqual({
      valid: true,
    });
  });

  it("signe le corps brut : un JSON équivalent mais reformaté est refusé", () => {
    expect(check({ rawBody: JSON.stringify(companyUpdated, null, 2) })).toEqual({
      valid: false,
      reason: "invalid_signature",
    });
  });

  it("refuse un mauvais secret", () => {
    expect(check({ secret: "autre-secret" })).toMatchObject({ reason: "invalid_signature" });
  });

  it("refuse les en-têtes absents (webhook sans secret)", () => {
    expect(check({ signature: null })).toMatchObject({ reason: "missing_headers" });
    expect(check({ timestamp: undefined })).toMatchObject({ reason: "missing_headers" });
  });

  it("refuse une signature mal formée sans lever d'erreur de longueur", () => {
    expect(check({ signature: "abc" })).toMatchObject({ reason: "invalid_signature" });
    expect(check({ signature: "z".repeat(64) })).toMatchObject({ reason: "invalid_signature" });
    expect(check({ signature: `${"a".repeat(64)}00` })).toMatchObject({
      reason: "invalid_signature",
    });
  });

  it("refuse un horodatage trop ancien, futur ou illisible", () => {
    const old = NOW - 6 * 60 * 1000;
    const rawBody = JSON.stringify(companyUpdated);
    expect(check({ timestamp: String(old), signature: sign(rawBody, String(old)) })).toMatchObject({
      reason: "stale_timestamp",
    });

    const future = NOW + 6 * 60 * 1000;
    expect(
      check({ timestamp: String(future), signature: sign(rawBody, String(future)) }),
    ).toMatchObject({ reason: "stale_timestamp" });

    expect(check({ timestamp: "hier" })).toMatchObject({ reason: "stale_timestamp" });
    // L'horodatage est en millisecondes : des secondes Unix seraient vues comme très anciennes.
    expect(check({ timestamp: String(Math.floor(NOW / 1000)) })).toMatchObject({
      reason: "stale_timestamp",
    });
  });

  it("respecte la tolérance fournie, et les bornes incluses", () => {
    const sentAt = NOW - 60_000;
    const rawBody = JSON.stringify(companyUpdated);
    const signed = { timestamp: String(sentAt), signature: sign(rawBody, String(sentAt)) };
    expect(check({ ...signed, toleranceMs: 60_000 })).toEqual({ valid: true });
    expect(check({ ...signed, toleranceMs: 59_999 })).toMatchObject({ reason: "stale_timestamp" });
  });
});

describe("receiveTwentyWebhook", () => {
  it("authentifie puis interprète, avec Headers ou objet", () => {
    const { rawBody, headers, secret, nowMs } = delivery();
    const fromObject = receiveTwentyWebhook({ rawBody, headers, secret, nowMs });
    expect(fromObject.nonce).toBe("a10d44253001fd6cebb572379814428b");
    expect(fromObject.event).toMatchObject({
      entity: "company",
      action: "updated",
      eventName: "company.updated",
      recordId: "da87669e-ba7c-46bb-b88b-1da54989ba34",
      occurredAt: "2026-11-04T15:53:15.374Z",
      updatedFields: ["name"],
      record: {
        name: "Société Évènement",
        domains: { primary: "wh.example", additional: [] },
      },
    });

    const fromHeaders = receiveTwentyWebhook({
      rawBody,
      headers: new Headers(headers as Record<string, string>),
      secret,
      nowMs,
    });
    expect(fromHeaders.event).toEqual(fromObject.event);
  });

  it("refuse avec une erreur 401 typée, sans interpréter le corps", () => {
    const { rawBody, headers, nowMs } = delivery();
    let error: unknown;
    try {
      receiveTwentyWebhook({ rawBody, headers, secret: "autre", nowMs });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TwentyWebhookRejectedError);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(error).toMatchObject({ reason: "invalid_signature", httpStatus: 401 });
  });
});

describe("parseTwentyWebhookEvent", () => {
  const event = (eventName: string, nameSingular: string, record: Record<string, unknown>) =>
    parseTwentyWebhookEvent(
      JSON.stringify({
        ...companyUpdated,
        eventName,
        objectMetadata: { id: "x", nameSingular },
        record: {
          id: "r1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          ...record,
        },
      }),
    );

  it("traduit personne, opportunité, note et tâche", () => {
    expect(
      event("person.created", "person", {
        name: { firstName: "A", lastName: "B" },
        emails: { primaryEmail: "a@b.fr", additionalEmails: [] },
        phones: { primaryPhoneNumber: "612345678", primaryPhoneCallingCode: "+33" },
        companyId: "c1",
      }),
    ).toMatchObject({
      entity: "person",
      record: { firstName: "A", phones: { primary: "+33612345678" }, companyId: "c1" },
    });

    expect(
      event("opportunity.updated", "opportunity", {
        stage: "WON",
        amount: { amountMicros: 10_000, currencyCode: "EUR" },
      }),
    ).toMatchObject({
      entity: "opportunity",
      record: { stage: "WON", amount: { cents: 1, currency: "EUR" } },
    });

    const note = event("note.created", "note", { title: "N", bodyV2: { markdown: "**x**" } });
    expect(note).toMatchObject({ entity: "note", record: { bodyMarkdown: "**x**" } });
    expect(note.record).not.toHaveProperty("targets");

    expect(event("task.updated", "task", { title: "T", status: "DONE" })).toMatchObject({
      entity: "task",
      record: { status: "DONE" },
    });
  });

  it("traduit les liens de note et de tâche, et les suppressions", () => {
    expect(
      event("noteTarget.created", "noteTarget", { noteId: "n1", targetPersonId: "p1" }),
    ).toMatchObject({
      entity: "activityLink",
      record: { activityType: "note", activityId: "n1", target: { type: "person", id: "p1" } },
    });
    expect(
      event("taskTarget.deleted", "taskTarget", {
        taskId: "t1",
        targetOpportunityId: "o1",
        deletedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      entity: "activityLink",
      action: "deleted",
      record: {
        activityType: "task",
        deletedAt: "2026-01-02T00:00:00.000Z",
        target: { type: "opportunity", id: "o1" },
      },
    });
    expect(event("company.destroyed", "company", { name: "x" })).toMatchObject({
      action: "destroyed",
      recordId: "r1",
    });
  });

  it("laisse passer un objet sans projection, sans l'interpréter", () => {
    expect(event("calendarEvent.created", "calendarEvent", {})).toMatchObject({
      entity: "other",
      objectName: "calendarEvent",
      record: null,
    });
  });

  it("refuse un corps illisible, une forme ou une action inconnues", () => {
    expect(() => parseTwentyWebhookEvent("{pas du json")).toThrow(ValidationError);
    expect(() => parseTwentyWebhookEvent(JSON.stringify({ event: "person.created" }))).toThrow(
      ValidationError,
    );
    expect(() => event("company.exploded", "company", {})).toThrow(ValidationError);
  });

  it("refuse un enregistrement connu mais mal formé", () => {
    expect(() =>
      parseTwentyWebhookEvent(
        JSON.stringify({
          ...companyUpdated,
          record: { id: "r1" },
        }),
      ),
    ).toThrow(ValidationError);
  });
});
