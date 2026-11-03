import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Actor } from "@/server/auth/permissions";
import type { Role } from "@/server/auth/roles";
import type { ServiceContext } from "@/server/context";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";

/**
 * Base PostgreSQL embarquée (PGlite, en mémoire) avec les VRAIES migrations du projet.
 * Aucun Docker nécessaire ; chaque appel crée une base vierge et isolée.
 */
export async function createTestDatabase(): Promise<{
  db: Database;
  /** Client SQL brut, pour les requêtes de contrôle dans les tests. */
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db, client, close: () => client.close() };
}

let userCounter = 0;

/** Insère un utilisateur minimal et renvoie l'acteur correspondant. */
export async function createTestActor(db: Database, role: Role): Promise<Actor> {
  userCounter += 1;
  const email = `${role}-${userCounter}@test.local`;
  const [user] = await db
    .insert(schema.users)
    .values({ name: `Test ${role}`, email, role })
    .returning();
  if (!user) throw new Error("Utilisateur de test non créé");
  return { userId: user.id, role, name: user.name, email };
}

export async function createTestContext(db: Database, role: Role): Promise<ServiceContext> {
  return { db, actor: await createTestActor(db, role) };
}
