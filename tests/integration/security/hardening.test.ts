import { describe, expect, it, vi } from "vitest";
import { isPrivateAddress } from "@/modules/sites/tls-check";
import { isInternalHref } from "@/modules/platform/notifications.service";
import { readBodyWithin } from "@/server/http/limited-body";

function streamed(chunks: number, chunkBytes: number) {
  let sent = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      if (sent > chunks) controller.close();
      else controller.enqueue(new Uint8Array(chunkBytes).fill(97));
    },
    cancel,
  });
  const request = new Request("http://localhost/api/webhooks/x", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel, sentChunks: () => sent };
}

describe("lecture bornée d'un corps public", () => {
  it("rend le corps dans la limite, accents compris", async () => {
    const request = new Request("http://localhost/x", { method: "POST", body: "déjà reçu" });
    expect(await readBodyWithin(request, 100)).toBe("déjà reçu");
  });

  it("refuse sur la taille annoncée, sans rien lire", async () => {
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "x",
      headers: { "content-length": "5000000" },
    });
    expect(await readBodyWithin(request, 1000)).toBeNull();
  });

  it("coupe un corps sans taille annoncée au premier dépassement", async () => {
    const { request, sentChunks } = streamed(100_000, 1024);
    expect(await readBodyWithin(request, 4096)).toBeNull();
    expect(sentChunks()).toBeLessThan(20);
  });
});

describe("liens internes", () => {
  it("refuse ce qu'un navigateur lirait comme un autre site", () => {
    for (const href of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
    ]) {
      expect(isInternalHref(href), JSON.stringify(href)).toBe(false);
    }
    expect(isInternalHref("https://evil.example")).toBe(false);
  });

  it("garde un chemin de l'application, avec sa requête", () => {
    expect(isInternalHref("/projets/1?onglet=taches#haut")).toBe(true);
  });
});

describe("contrôle TLS : adresses IPv6 qui embarquent une adresse privée", () => {
  it.each([
    "::1",
    "::",
    "::7f00:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "2001:0:7f00:1::",
    "64:ff9b::a00:1",
    "64:ff9b:1::a00:1",
    "fe80::1",
  ])("refuse %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it("laisse passer une adresse publique", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
  });
});
