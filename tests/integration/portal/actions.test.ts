import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";

/**
 * L'onglet d'un client resté ouvert après une révocation : l'action ne répond ni par une erreur, ni par
 * la connexion de l'équipe. Elle le mène à ses propres pages.
 */
const state = vi.hoisted(() => ({
  actor: null as Actor | null,
  portalError: null as Error | null,
  send: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentActor: async () => state.actor,
  getPortalContext: async () => {
    if (state.portalError) throw state.portalError;
    return { actor: state.actor, companyId: "c", contactId: "k", db: null };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock("@/modules/messaging/message.service", () => ({
  getPortalUnreadCount: vi.fn(),
  listPortalConversation: vi.fn(),
  markPortalRead: vi.fn(),
  sendPortalMessage: state.send,
}));

const { loadOlderMessagesAction, markMessagesReadAction, sendMessageAction } =
  await import("@/modules/portal/portal.actions");

const CLIENT: Actor = { userId: "u", role: "client", name: "Alix", email: "a@client.test" };

function redirectTarget(error: unknown): string {
  const digest = (error as { digest?: string }).digest ?? "";
  expect(digest).toContain("NEXT_REDIRECT");
  return digest.split(";")[2] ?? "";
}

async function targetOf(run: () => Promise<unknown>): Promise<string> {
  const error = await run().then(
    () => new Error("La redirection attendue n'a pas eu lieu"),
    (thrown: unknown) => thrown,
  );
  return redirectTarget(error);
}

describe("actions du portail, session perdue", () => {
  beforeEach(() => {
    state.actor = null;
    state.portalError = null;
    state.send.mockReset();
  });

  it("session fermée : retour à la connexion du client, pas à celle de l'équipe", async () => {
    expect(await targetOf(() => sendMessageAction({ body: "Bonjour" }))).toBe("/espace/connexion");
    expect(await targetOf(() => markMessagesReadAction())).toBe("/espace/connexion");
    expect(
      await targetOf(() =>
        loadOlderMessagesAction({
          at: new Date(),
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("/espace/connexion");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("adhésion révoquée, session encore là : page d'accès retiré", async () => {
    state.actor = CLIENT;
    state.portalError = new ForbiddenError("Accès retiré");
    expect(await targetOf(() => sendMessageAction({ body: "Bonjour" }))).toBe(
      "/espace/acces-retire",
    );
    expect(state.send).not.toHaveBeenCalled();
  });

  it("adhésion valide : l'action passe", async () => {
    state.actor = CLIENT;
    expect(await sendMessageAction({ body: "Bonjour" })).toMatchObject({ status: "success" });
    expect(state.send).toHaveBeenCalledOnce();
  });
});
