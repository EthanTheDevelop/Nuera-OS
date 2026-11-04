/**
 * Remplit la base de DÉVELOPPEMENT avec des données fictives : `npm run db:seed`.
 *
 *   npm run db:seed                         mots de passe générés, affichés une seule fois
 *   npm run db:seed -- --password "<mdp>"   même mot de passe pour tous les comptes créés
 *   npm run db:seed -- --allow-remote       autorise une base qui n'est pas locale
 *
 * Refuse de tourner avec NODE_ENV=production. Idempotent : on peut le relancer sans risque, un
 * compte existant garde son mot de passe. Aucun appel à Twenty ni à un autre service.
 */
import { parseArgs } from "node:util";
import { getAuth } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { runSeed, seedRefusalReason } from "./lib/seed-data";

const { values } = parseArgs({
  options: {
    password: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
  },
});

const refusal = seedRefusalReason(process.env, { allowRemote: values["allow-remote"] });
if (refusal) {
  console.error(`✖ Seed refusé. ${refusal}`);
  process.exit(1);
}

try {
  const { accounts } = await runSeed(
    { db: getDb(), auth: getAuth() },
    { password: values.password },
  );

  console.log("✔ Données de développement en place.\n");
  console.log("Comptes (les mots de passe ne s'affichent qu'à la création) :");
  for (const account of accounts) {
    const secret = account.created
      ? values.password
        ? "mot de passe fourni"
        : account.password
      : "existant, mot de passe inchangé";
    console.log(`  ${account.role.padEnd(10)} ${account.email.padEnd(32)} ${secret}`);
  }
} catch (error) {
  console.error("✖ Échec du seed :", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
