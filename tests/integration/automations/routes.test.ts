import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signN8nBody } from "@/integrations/n8n/n8n.client";

/** Les routes publiques sans base : authentification et absence de configuration. */
const env = vi.hoisted(() => ({
  JOBS_SECRET: undefined as string | undefined,
  N8N_WEBHOOK_SECRET: undefined as string | undefined,
  UPTIME_KUMA_WEBHOOK_SECRET: undefined as string | undefined,
}));
const runApplicationJob = vi.hoisted(() => vi.fn());
const processN8nWebhook = vi.hoisted(() => vi.fn());
const processUptimeKumaNotification = vi.hoisted(() => vi.fn());

vi.mock("@/server/config/env", () => ({ getEnv: () => env }));
vi.mock("@/modules/platform/jobs.service", () => ({
  isJobName: (name: string) => name === "events-dispatch",
  runApplicationJob,
}));
vi.mock("@/modules/platform/n8n.webhook", () => ({ processN8nWebhook }));
vi.mock("@/modules/platform/uptime.webhook", () => ({ processUptimeKumaNotification }));

const { POST: jobs } = await import("@/app/api/jobs/[job]/route");
const { POST: n8n } = await import("@/app/api/webhooks/n8n/route");
const { POST: uptime } = await import("@/app/api/webhooks/uptime-kuma/route");

const SECRET = "x".repeat(32);

function post(path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { method: "POST", ...init });
}

const jobParams = (job: string) => ({ params: Promise.resolve({ job }) });

beforeEach(() => {
  env.JOBS_SECRET = SECRET;
  env.N8N_WEBHOOK_SECRET = SECRET;
  env.UPTIME_KUMA_WEBHOOK_SECRET = SECRET;
  runApplicationJob.mockReset().mockResolvedValue({ status: "succeeded", items: 3 });
  processN8nWebhook.mockReset().mockResolvedValue("applied");
  processUptimeKumaNotification.mockReset().mockResolvedValue("applied");
});

describe("POST /api/jobs/[job]", () => {
  const auth = { headers: { authorization: `Bearer ${SECRET}` } };

  it("sans secret configuré : 404, jamais ouvert, même avec un jeton", async () => {
    env.JOBS_SECRET = undefined;
    const response = await jobs(
      post("/api/jobs/events-dispatch", auth),
      jobParams("events-dispatch"),
    );
    expect(response.status).toBe(404);
    expect(runApplicationJob).not.toHaveBeenCalled();
  });

  it("jeton absent ou faux : 401, rien ne tourne", async () => {
    for (const init of [{}, { headers: { authorization: "Bearer faux" } }]) {
      const response = await jobs(
        post("/api/jobs/events-dispatch", init),
        jobParams("events-dispatch"),
      );
      expect(response.status).toBe(401);
    }
    expect(runApplicationJob).not.toHaveBeenCalled();
  });

  it("tâche inconnue : 404", async () => {
    const response = await jobs(post("/api/jobs/autre", auth), jobParams("autre"));
    expect(response.status).toBe(404);
  });

  it("bon jeton : lance la tâche, réponse jamais mise en cache", async () => {
    const response = await jobs(
      post("/api/jobs/events-dispatch", auth),
      jobParams("events-dispatch"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ job: "events-dispatch", items: 3 });
  });

  it("un échec répond 502 ; une tâche déjà en cours répond 200", async () => {
    runApplicationJob.mockResolvedValue({ status: "failed", error: "Panne" });
    const failed = await jobs(
      post("/api/jobs/events-dispatch", auth),
      jobParams("events-dispatch"),
    );
    expect(failed.status).toBe(502);
    runApplicationJob.mockResolvedValue({ status: "skipped", reason: "already_running" });
    const skipped = await jobs(
      post("/api/jobs/events-dispatch", auth),
      jobParams("events-dispatch"),
    );
    expect(skipped.status).toBe(200);
  });
});

describe("POST /api/webhooks/n8n", () => {
  const body = JSON.stringify({ id: "1", title: "Fini" });
  const signed = () => {
    const timestamp = String(Date.now());
    return {
      "x-nuera-timestamp": timestamp,
      "x-nuera-signature": signN8nBody(SECRET, timestamp, body),
    };
  };

  it("sans secret : 404", async () => {
    env.N8N_WEBHOOK_SECRET = undefined;
    expect((await n8n(post("/api/webhooks/n8n", { body }))).status).toBe(404);
  });

  it("signature absente ou fausse : 401, rien n'est traité", async () => {
    expect((await n8n(post("/api/webhooks/n8n", { body }))).status).toBe(401);
    const forged = { ...signed(), "x-nuera-signature": "sha256=00" };
    expect((await n8n(post("/api/webhooks/n8n", { body, headers: forged }))).status).toBe(401);
    expect(processN8nWebhook).not.toHaveBeenCalled();
  });

  it("signature juste : traité ; corps refusé : 400", async () => {
    const ok = await n8n(post("/api/webhooks/n8n", { body, headers: signed() }));
    expect(ok.status).toBe(200);
    expect(processN8nWebhook).toHaveBeenCalledOnce();
    processN8nWebhook.mockResolvedValue("invalid");
    const refused = await n8n(post("/api/webhooks/n8n", { body, headers: signed() }));
    expect(refused.status).toBe(400);
  });
});

describe("POST /api/webhooks/uptime-kuma", () => {
  const headers = { "x-nuera-webhook-token": SECRET };
  const body = JSON.stringify({
    heartbeat: { monitorID: 7, status: 0, time: "2026-11-05 10:00:00.000" },
  });

  it("sans secret : 404 ; mauvais jeton : 401", async () => {
    expect((await uptime(post("/api/webhooks/uptime-kuma", { body, headers }))).status).toBe(200);
    env.UPTIME_KUMA_WEBHOOK_SECRET = undefined;
    expect((await uptime(post("/api/webhooks/uptime-kuma", { body, headers }))).status).toBe(404);
    env.UPTIME_KUMA_WEBHOOK_SECRET = SECRET;
    const wrong = { "x-nuera-webhook-token": "faux" };
    expect((await uptime(post("/api/webhooks/uptime-kuma", { body, headers: wrong }))).status).toBe(
      401,
    );
  });

  it("une panne passe au service ; le message de test de Kuma est accusé sans effet", async () => {
    processUptimeKumaNotification.mockClear();
    const response = await uptime(post("/api/webhooks/uptime-kuma", { body, headers }));
    expect(await response.json()).toEqual({ result: "applied" });
    expect(processUptimeKumaNotification.mock.calls[0]?.[0]).toMatchObject({
      monitorId: "7",
      state: "down",
    });
    processUptimeKumaNotification.mockClear();
    const test = await uptime(
      post("/api/webhooks/uptime-kuma", { body: JSON.stringify({ msg: "test" }), headers }),
    );
    expect(await test.json()).toEqual({ result: "ignored" });
    expect(processUptimeKumaNotification).not.toHaveBeenCalled();
  });
});
