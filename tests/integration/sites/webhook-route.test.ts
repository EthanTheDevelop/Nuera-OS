import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  secret: null as string | null,
  result: "processed" as string,
  received: [] as unknown[],
}));

vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ COOLIFY_WEBHOOK_SECRET: runtime.secret }),
}));
vi.mock("@/modules/sites/coolify-sync.service", () => ({
  processCoolifyWebhook: (event: unknown) => {
    runtime.received.push(event);
    return Promise.resolve(runtime.result);
  },
}));

const { POST } = await import("@/app/api/webhooks/coolify/route");

const SECRET = "secret-de-test-coolify";
const BODY = JSON.stringify({
  event: "deployment_success",
  deployment_uuid: "dep-1",
  application_uuid: "app-1",
});

function post(token: string | null, body: string = BODY) {
  const query = token === null ? "" : `?token=${token}`;
  return POST(
    new NextRequest(`http://localhost/api/webhooks/coolify${query}`, { method: "POST", body }),
  );
}

beforeEach(() => {
  runtime.secret = SECRET;
  runtime.result = "processed";
  runtime.received.length = 0;
});

describe("route du webhook Coolify", () => {
  it("sans secret configuré : 503, rien n'est traité", async () => {
    runtime.secret = null;
    expect((await post(SECRET)).status).toBe(503);
    expect(runtime.received).toHaveLength(0);
  });

  it.each([[null], ["faux"], [""]])("jeton %j : 401, rien n'est traité", async (token) => {
    expect((await post(token)).status).toBe(401);
    expect(runtime.received).toHaveLength(0);
  });

  it("corps illisible, mal formé ou trop gros : refusé, rien n'est traité", async () => {
    expect((await post(SECRET, "pas du json")).status).toBe(400);
    expect((await post(SECRET, JSON.stringify({ pas: "un événement" }))).status).toBe(400);
    expect((await post(SECRET, "x".repeat(70 * 1024))).status).toBe(413);
    expect(runtime.received).toHaveLength(0);
  });

  it("notification valide : traitée, et un échec répond 502 pour que l'expéditeur réessaie", async () => {
    const ok = await post(SECRET);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ result: "processed" });
    expect(runtime.received).toEqual([
      {
        kind: "deployment",
        deploymentUuid: "dep-1",
        applicationUuid: "app-1",
        event: "deployment_success",
      },
    ]);

    runtime.result = "failed";
    expect((await post(SECRET)).status).toBe(502);
  });
});
