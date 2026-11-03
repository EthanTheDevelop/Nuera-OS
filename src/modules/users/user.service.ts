import { recordAudit } from "@/modules/audit/audit.service";
import type { Auth } from "@/server/auth/auth";
import type { Database } from "@/server/db/types";
import { ConflictError } from "@/server/errors";
import { parseInput } from "@/server/validation";
import * as userRepository from "./user.repository";
import { createUserSchema } from "./user.schema";

/**
 * Crée un compte (email + mot de passe) via better-auth et le journalise.
 *
 * Opération d'administration hors requête HTTP (CLI `npm run user:create`) :
 * l'appelant est responsable de son autorisation. Une future interface
 * d'administration passera par une variante contrôlée par `users:manage`.
 */
export async function createUserAccount(
  deps: { db: Database; auth: Auth },
  input: unknown,
  options: { actorId: string | null; via: "cli" },
) {
  const data = parseInput(createUserSchema, input);

  if (await userRepository.userExistsWithEmail(deps.db, data.email)) {
    throw new ConflictError("Un compte existe déjà avec cette adresse e-mail.", {
      email: ["Adresse déjà utilisée."],
    });
  }

  const { user } = await deps.auth.api.createUser({
    body: { email: data.email, name: data.name, password: data.password, role: data.role },
  });

  await recordAudit(deps.db, {
    actorId: options.actorId,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    metadata: { role: data.role, via: options.via },
  });

  return { id: user.id, email: data.email, role: data.role };
}
