import { beforeEach, describe, expect, it, vi } from "vitest";

const checkDatabase = vi.fn<() => Promise<boolean>>();
vi.mock("@/server/health", () => ({ checkDatabase }));

const { GET: health } = await import("@/app/api/health/route");
const { GET: ready } = await import("@/app/api/health/ready/route");

describe.each([
  ["/api/health", health],
  ["/api/health/ready", ready],
])("sonde %s", (_path, get) => {
  beforeEach(() => {
    checkDatabase.mockReset();
  });

  it("répond 200 quand la base répond", async () => {
    checkDatabase.mockResolvedValue(true);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("répond 503 sans aucun détail quand la base est coupée", async () => {
    checkDatabase.mockResolvedValue(false);
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
