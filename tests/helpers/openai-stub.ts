import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface OpenAiStubRequest {
  authorization: string | undefined;
  body: Record<string, unknown>;
}

export type OpenAiStubReply =
  | { status?: number; json: unknown }
  /** Ne répond jamais : pour éprouver le délai d'attente. */
  | { hang: true };

/**
 * Faux serveur local de l'API Responses d'OpenAI : éprouve l'adaptateur en vrai HTTP.
 * Seul endroit où une réponse de modèle est simulée, sous `tests/`.
 */
export async function startOpenAiStub(
  reply: (request: OpenAiStubRequest) => OpenAiStubReply,
): Promise<{ baseUrl: string; requests: OpenAiStubRequest[]; close: () => Promise<void> }> {
  const requests: OpenAiStubRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request: OpenAiStubRequest = {
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      requests.push(request);
      const answer = reply(request);
      if ("hang" in answer) return;
      res.writeHead(answer.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Réponse conforme à la documentation : `output[].content[].text` de type `output_text`. */
export function responsesApiBody(text: string) {
  return {
    id: "resp_test",
    object: "response",
    status: "completed",
    error: null,
    model: "modele-de-test",
    output: [
      { id: "rs_1", type: "reasoning", summary: [] },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}
