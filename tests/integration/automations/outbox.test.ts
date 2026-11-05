import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SmtpClient,
  unconfiguredSmtpGateway,
  type SmtpGateway,
} from "@/integrations/smtp/smtp.client";
import { ServiceUnavailableError } from "@/server/errors";
import {
  drainEmailOutbox,
  enqueueEmail,
  MAX_EMAIL_ATTEMPTS,
} from "@/modules/platform/email-outbox";
import { emailOutbox } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { createTestDatabase } from "../../helpers/db";
import { startSmtpStub } from "../../helpers/smtp-stub";

let db: Database;

beforeEach(async () => {
  ({ db } = await createTestDatabase());
});

const LINK = "https://exemple.test/lien?token=secret";

const mail = (overrides: Partial<Parameters<typeof enqueueEmail>[1]> = {}) => ({
  to: "client@exemple.test",
  subject: "Sujet",
  text: LINK,
  html: `<a href="${LINK}">Lien</a>`,
  template: "portal_magic_link",
  ...overrides,
});

const all = () => db.select().from(emailOutbox);

describe("sans SMTP", () => {
  it("ne simule aucun envoi : la ligne dit not_configured", async () => {
    await enqueueEmail(db, mail());
    const result = await drainEmailOutbox(db, unconfiguredSmtpGateway);
    expect(result).toMatchObject({ sent: 0, notConfigured: 1 });
    const [row] = await all();
    expect(row?.status).toBe("not_configured");
    expect(row?.sentAt).toBeNull();
    expect(row?.text).toBe(LINK);
  });

  it("efface un lien de connexion mort jamais parti", async () => {
    await enqueueEmail(db, mail());
    await drainEmailOutbox(db, unconfiguredSmtpGateway, {
      now: new Date(Date.now() + 25 * 3_600_000),
    });
    const [row] = await all();
    expect(row?.status).toBe("failed");
    expect(row?.text).toBeNull();
    expect(row?.html).toBeNull();
  });

  it("repart quand le SMTP arrive", async () => {
    await enqueueEmail(db, mail());
    await drainEmailOutbox(db, unconfiguredSmtpGateway);
    const sent: string[] = [];
    const smtp: SmtpGateway = {
      isConfigured: true,
      send: async (message) => {
        sent.push(message.to);
        return { messageId: "1" };
      },
      verify: async () => undefined,
    };
    expect((await drainEmailOutbox(db, smtp)).sent).toBe(1);
    expect(sent).toEqual(["client@exemple.test"]);
  });
});

describe("avec SMTP", () => {
  const delivered: { to: string; text?: string | null; replyTo?: string | null }[] = [];
  const working: SmtpGateway = {
    isConfigured: true,
    send: async (message) => {
      delivered.push(message);
      return { messageId: "1" };
    },
    verify: async () => undefined,
  };

  beforeEach(() => {
    delivered.length = 0;
  });

  it("envoie une fois et efface le contenu qui porte un lien actif", async () => {
    await enqueueEmail(db, mail());
    await drainEmailOutbox(db, working, { replyTo: "contact@exemple.test" });
    await drainEmailOutbox(db, working);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.text).toBe(LINK);
    expect(delivered[0]?.replyTo).toBe("contact@exemple.test");
    const [row] = await all();
    expect(row?.status).toBe("sent");
    expect(row?.sentAt).not.toBeNull();
    expect(row?.text).toBeNull();
    expect(row?.html).toBeNull();
    expect(row?.subject).toBe("Sujet");
  });

  it("deux vidages simultanés n'envoient pas deux fois", async () => {
    await enqueueEmail(db, mail());
    await Promise.all([drainEmailOutbox(db, working), drainEmailOutbox(db, working)]);
    expect(delivered).toHaveLength(1);
  });

  it("retente un nombre borné de fois, avec attente, puis abandonne et efface", async () => {
    await enqueueEmail(db, mail({ template: "notification:test" }));
    let calls = 0;
    const failing: SmtpGateway = {
      isConfigured: true,
      send: () => {
        calls += 1;
        return Promise.reject(
          new ServiceUnavailableError("smtp", "unreachable", "Serveur injoignable."),
        );
      },
      verify: async () => undefined,
    };
    let hours = 0;
    const later = () => new Date(Date.now() + (hours += 24) * 3_600_000);

    await drainEmailOutbox(db, failing);
    expect(calls).toBe(1);
    const [first] = await all();
    expect(first?.status).toBe("pending");
    expect(first?.lastError).toBe("Serveur injoignable.");
    expect(first?.text).toBe(LINK);

    // Sans attente : pas de nouvel essai.
    await drainEmailOutbox(db, failing);
    expect(calls).toBe(1);

    for (let index = 0; index < MAX_EMAIL_ATTEMPTS + 2; index += 1) {
      await drainEmailOutbox(db, failing, { now: later() });
    }
    expect(calls).toBe(MAX_EMAIL_ATTEMPTS);
    const [last] = await all();
    expect(last?.status).toBe("failed");
    expect(last?.attempts).toBe(MAX_EMAIL_ATTEMPTS);
    expect(last?.text).toBeNull();
  });

  it("garde une dedupe_key : pas de second dépôt", async () => {
    await enqueueEmail(db, mail({ dedupeKey: "une-seule" }));
    await enqueueEmail(db, mail({ dedupeKey: "une-seule" }));
    expect(
      await db.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, "une-seule")),
    ).toHaveLength(1);
  });
});

describe("SmtpClient, contre un serveur SMTP local", () => {
  let stub: Awaited<ReturnType<typeof startSmtpStub>>;
  let reject = false;

  beforeAll(async () => {
    stub = await startSmtpStub({ rejectData: () => reject });
  });
  afterAll(async () => stub.close());

  const client = () =>
    new SmtpClient({
      host: "127.0.0.1",
      port: stub.port,
      from: "Nuera <bonjour@exemple.test>",
      allowPlaintext: true,
    });

  it("vérifie la connexion et envoie un vrai message", async () => {
    await client().verify();
    await client().send({ to: "client@exemple.test", subject: "Sujet", text: "Corps" });
    expect(stub.mails).toHaveLength(1);
    expect(stub.mails[0]?.to[0]).toContain("client@exemple.test");
    expect(stub.mails[0]?.data).toContain("Corps");
  });

  it("un refus du serveur est une ServiceUnavailableError", async () => {
    reject = true;
    await expect(
      client().send({ to: "client@exemple.test", subject: "Sujet", text: "Corps" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    reject = false;
  });

  it("un serveur injoignable aussi", async () => {
    const down = new SmtpClient({
      host: "127.0.0.1",
      port: 1,
      from: "x@exemple.test",
      allowPlaintext: true,
    });
    await expect(down.verify()).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("sans configuration, tout appel échoue", async () => {
    await expect(
      unconfiguredSmtpGateway.send({ to: "a@b.test", subject: "x" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
