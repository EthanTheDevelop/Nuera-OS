import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Serveur HTTP local qui joue un service externe : le vrai adaptateur passe par le réseau, sans
 * contacter aucun tiers. Chaque route renvoie `{ status, body }`, ou un corps JSON avec 200.
 */
export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type StubHandler = (request: { method: string; url: URL }) => StubResponse | unknown;

export interface HttpStub {
  url: string;
  requests: { method: string; path: string; authorization: string | undefined }[];
  /** Remplace les routes : `"GET /api/v1/applications"`. */
  routes: Map<string, StubHandler>;
  close: () => Promise<void>;
}

function isStubResponse(value: unknown): value is StubResponse {
  return typeof value === "object" && value !== null && ("status" in value || "body" in value);
}

export async function startHttpStub(): Promise<HttpStub> {
  const routes = new Map<string, StubHandler>();
  const requests: HttpStub["requests"] = [];

  const server: Server = createServer((request: IncomingMessage, response) => {
    const url = new URL(request.url ?? "/", "http://stub.local");
    requests.push({
      method: request.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
    });
    const handler = routes.get(`${request.method} ${url.pathname}`);
    const result: unknown = handler
      ? handler({ method: request.method ?? "GET", url })
      : { status: 404, body: { message: "Not found" } };
    const stub: StubResponse = isStubResponse(result) ? result : { body: result };
    response.writeHead(stub.status ?? 200, {
      "content-type": "application/json",
      ...stub.headers,
    });
    response.end(stub.body === undefined ? "" : JSON.stringify(stub.body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    routes,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
