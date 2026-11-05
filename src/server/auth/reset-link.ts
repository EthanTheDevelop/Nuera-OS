import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { enqueueEmail } from "@/modules/platform/email-outbox";
import { renderNotificationEmail } from "@/modules/platform/notifications.service";
import { users, verifications } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Lien de réinitialisation : par e-mail, ou rendu au serveur quand l'administration invite un compte
 * (`captureResetLink`). La route publique ne peut pas atteindre ce second cas : aucun champ de la
 * requête n'entre dans ce contexte.
 *
 * Le contexte vit sur `globalThis`, comme l'instance d'auth qui le lit : l'instance est créée par le
 * premier point d'entrée servi (page, route, action), et Next peut charger ce module une fois par
 * point d'entrée. Avec un contexte par module, l'action n'aurait plus accès au lien capturé.
 */
const globalForCapture = globalThis as typeof globalThis & {
  __nueraResetLinkCapture?: AsyncLocalStorage<{ url?: string }>;
};
const capture = (globalForCapture.__nueraResetLinkCapture ??= new AsyncLocalStorage<{
  url?: string;
}>());

export async function captureResetLink(issue: () => Promise<unknown>): Promise<string | null> {
  const store: { url?: string } = {};
  await capture.run(store, issue);
  return store.url ?? null;
}

/**
 * Vrai si un e-mail est parti en boîte. Silencieux pour un client (lien par e-mail, pas de mot de
 * passe) et pour un compte désactivé : la réponse HTTP reste la même, l'adresse n'est pas révélée.
 */
export async function sendPasswordResetMail(
  db: Database,
  input: { userId: string; email: string; url: string },
): Promise<boolean> {
  const store = capture.getStore();
  if (store) {
    store.url = input.url;
    return false;
  }
  const [user] = await db
    .select({ role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user || user.banned || user.role === "client") return false;

  const { text, html } = renderNotificationEmail({
    title: "Réinitialisation de votre mot de passe Nuera OS",
    body: "Ce lien reste valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.",
    url: input.url,
    linkLabel: "Choisir un nouveau mot de passe",
  });
  await enqueueEmail(db, {
    to: input.email,
    subject: "Réinitialisation de votre mot de passe",
    text,
    html,
    template: "password_reset",
  });
  return true;
}

/** Jeton de réinitialisation contenu dans un lien better-auth (`…/reset-password/<jeton>?…`). */
function tokenOf(url: string): string | null {
  const match = /\/reset-password\/([^/?#]+)/.exec(new URL(url).pathname);
  return match?.[1] ?? null;
}

/**
 * Une invitation vit plus longtemps qu'une réinitialisation (1 h par défaut) : on prolonge le seul
 * jeton de ce lien. Dépend du format de better-auth : couvert par un test de bout en bout du lien.
 */
export async function extendResetLink(db: Database, url: string, expiresAt: Date): Promise<void> {
  const token = tokenOf(url);
  if (!token) throw new Error("Lien de réinitialisation illisible.");
  await db
    .update(verifications)
    .set({ expiresAt })
    .where(eq(verifications.identifier, `reset-password:${token}`));
}
