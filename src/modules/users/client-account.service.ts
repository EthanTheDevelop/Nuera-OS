import { and, desc, eq, gt } from "drizzle-orm";
import { sessions, users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ConflictError } from "@/server/errors";

/**
 * Comptes du rôle `client`, créés par une invitation à l'espace client. Sans mot de passe : aucune
 * ligne `accounts`, le lien de connexion est la seule porte. L'appelant a contrôlé l'autorisation.
 */
export interface ClientAccount {
  id: string;
  email: string;
  name: string;
  created: boolean;
}

/**
 * Renvoie le compte client de cette adresse, ou le crée. Une adresse déjà prise par un membre de
 * l'équipe est refusée : un lien de connexion contournerait son mot de passe et sa double
 * authentification.
 */
export async function ensureClientAccount(
  db: Database,
  input: { email: string; name: string },
): Promise<ClientAccount> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    if (existing.role !== "client") {
      throw new ConflictError("Cette adresse e-mail appartient déjà à un compte de l'équipe.");
    }
    return { id: existing.id, email: existing.email, name: existing.name, created: false };
  }
  const [created] = await db
    .insert(users)
    .values({ email, name: input.name, role: "client", emailVerified: true })
    .returning({ id: users.id, email: users.email, name: users.name });
  if (!created) throw new Error("Compte client non créé");
  return { ...created, created: true };
}

export async function getClientAccountName(db: Database, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  return row?.name ?? null;
}

export async function renameClientAccount(
  db: Database,
  userId: string,
  name: string,
): Promise<void> {
  await db
    .update(users)
    .set({ name })
    .where(and(eq(users.id, userId), eq(users.role, "client")));
}

/** Ferme toutes les sessions d'un compte : une révocation ne laisse aucun cookie valable. */
export async function closeClientSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export interface ClientDevice {
  id: string;
  userAgent: string | null;
  lastActiveAt: Date;
}

/** Appareils connectés du compte, pour la carte « Connexion » : jamais le jeton ni l'adresse IP. */
export async function listClientDevices(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<ClientDevice[]> {
  return db
    .select({ id: sessions.id, userAgent: sessions.userAgent, lastActiveAt: sessions.updatedAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.updatedAt))
    .limit(3);
}
