/**
 * Jeu de données fictives pour la base STAGING : `npm run db:seed:staging`, ou dans le conteneur
 * `node cli/db-seed-staging.mjs`. Documentation : `docs/ops/donnees-staging.md`.
 *
 *   --volume small|medium|large   25, 80 ou 200 entreprises (défaut : medium)
 *   --companies <n>               nombre exact d'entreprises (1 à 1000), prioritaire sur --volume
 *   --seed <n>                    graine Faker (défaut : 20261105) ; même graine = mêmes données
 *   --reference-date AAAA-MM-JJ   date autour de laquelle s'étalent les dossiers (défaut : aujourd'hui)
 *   --dry-run                     calcule et insère dans une transaction annulée : rien n'est écrit
 *
 * Refusé sauf si SEED_ALLOWED=true ET si la base, dans DATABASE_URL puis selon PostgreSQL, est
 * exactement `nuera_os_staging`. NODE_ENV n'est pas consulté. Jamais lancé au démarrage.
 */
import { parseArgs } from "node:util";
import { getEnv } from "@/server/config/env";
import { closeDb, getDb } from "@/server/db/client";
import { applyStagingPlan, currentDatabaseName } from "./lib/staging-seed/apply";
import {
  DEFAULT_STAGING_SEED,
  generateStagingPlan,
  MAX_STAGING_COMPANIES,
  STAGING_VOLUMES,
  type StagingVolume,
} from "./lib/staging-seed/generate";
import {
  connectedDatabaseRefusalReason,
  STAGING_DATABASE_NAME,
  stagingSeedRefusalReason,
} from "./lib/staging-seed/guard";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    volume: { type: "string", default: "medium" },
    companies: { type: "string" },
    seed: { type: "string", default: String(DEFAULT_STAGING_SEED) },
    "reference-date": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(
    [
      "Usage : node cli/db-seed-staging.mjs [--volume small|medium|large] [--companies n]",
      "                                     [--seed n] [--reference-date AAAA-MM-JJ] [--dry-run]",
      `Exige SEED_ALLOWED=true et une DATABASE_URL vers « ${STAGING_DATABASE_NAME} ».`,
    ].join("\n"),
  );
  process.exit(0);
}

// --- Garde-fous, avant toute connexion ---
let env: ReturnType<typeof getEnv>;
try {
  env = getEnv();
} catch (error) {
  fail(error instanceof Error ? error.message : "Configuration invalide.");
}
const refusal = stagingSeedRefusalReason({
  databaseUrl: env.DATABASE_URL,
  seedAllowed: env.SEED_ALLOWED,
});
if (refusal) fail(`Jeu de données staging refusé. ${refusal}`);

// --- Paramètres ---
if (!Object.hasOwn(STAGING_VOLUMES, values.volume)) {
  fail(`Volume inconnu « ${values.volume} » : small, medium ou large.`);
}
const companies =
  values.companies === undefined
    ? STAGING_VOLUMES[values.volume as StagingVolume]
    : Number(values.companies);
if (!Number.isInteger(companies) || companies < 1 || companies > MAX_STAGING_COMPANIES) {
  fail(`--companies doit être un entier entre 1 et ${MAX_STAGING_COMPANIES}.`);
}
const seed = Number(values.seed);
if (!Number.isSafeInteger(seed) || seed < 0) fail("--seed doit être un entier positif.");
let referenceDate = new Date();
if (values["reference-date"] !== undefined) {
  const raw = values["reference-date"];
  referenceDate = new Date(`${raw}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || referenceDate.toISOString().slice(0, 10) !== raw) {
    fail("--reference-date doit être une date valide au format AAAA-MM-JJ.");
  }
}

try {
  const db = getDb();
  // Second verrou : le nom réel de la base, selon le serveur (alias, pooler, variable PGDATABASE).
  const connectedRefusal = connectedDatabaseRefusalReason(await currentDatabaseName(db));
  if (connectedRefusal) throw new Error(`Jeu de données staging refusé. ${connectedRefusal}`);

  const started = Date.now();
  const plan = generateStagingPlan({ seed, companies, referenceDate });
  const { planned, inserted, dryRun } = await applyStagingPlan(db, plan, {
    referenceDate,
    dryRun: values["dry-run"],
    metadata: { seed, companies, referenceDate: referenceDate.toISOString().slice(0, 10) },
  });

  const total = Object.values(inserted).reduce((sum, value) => sum + value, 0);
  console.log(
    `${dryRun ? "○ Essai à blanc, rien n'a été écrit" : "✔ Jeu de données staging en place"} ` +
      `(graine ${seed}, ${companies} entreprises, référence ${referenceDate.toISOString().slice(0, 10)}).\n`,
  );
  console.log(`  ${"table".padEnd(26)} ${"prévues".padStart(8)} ${"insérées".padStart(9)}`);
  for (const [table, count] of Object.entries(planned)) {
    console.log(
      `  ${table.padEnd(26)} ${String(count).padStart(8)} ${String(inserted[table] ?? 0).padStart(9)}`,
    );
  }
  console.log(
    `\n  ${total} ligne(s) ${dryRun ? "à insérer" : "insérée(s)"} en ${((Date.now() - started) / 1000).toFixed(1)} s.` +
      (total === 0 ? " Déjà en place : rien à ajouter." : ""),
  );
} catch (error) {
  console.error("✖ Échec :", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
