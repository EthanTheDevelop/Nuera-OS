/**
 * Crée un compte collaborateur.
 *
 *   npm run user:create -- --email <email> --name "<Prénom Nom>" --role admin
 *
 * Le mot de passe est saisi sans écho (jamais en argument : il resterait dans
 * l'historique du shell). Rôles disponibles : voir src/server/auth/roles.ts.
 */
import { parseArgs } from "node:util";
import { createUserAccount } from "@/modules/users/user.service";
import { getAuth } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { isAppError, ValidationError } from "@/server/errors";
import { promptHidden } from "./lib/prompt";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "member" },
  },
});

try {
  if (!values.email || !values.name) {
    throw new Error(
      'Usage : npm run user:create -- --email <email> --name "<nom>" [--role <rôle>]',
    );
  }

  const password = await promptHidden("Mot de passe (12 caractères min.) : ");
  const confirmation = await promptHidden("Confirmation : ");
  if (password !== confirmation) throw new Error("Les mots de passe ne correspondent pas.");

  const user = await createUserAccount(
    { db: getDb(), auth: getAuth() },
    { email: values.email, name: values.name, role: values.role, password },
    { actorId: null, via: "cli" },
  );
  console.log(`✔ Compte créé : ${user.email} (rôle : ${user.role}).`);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(`✖ ${error.message}`);
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      console.error(`  - ${field} : ${messages?.join(", ")}`);
    }
  } else {
    console.error(
      `✖ ${isAppError(error) || error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exitCode = 1;
} finally {
  await closeDb();
}
