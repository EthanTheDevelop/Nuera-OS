/**
 * Garde-fou contre les migrations destructives : `npm run db:check`.
 *
 * Les migrations sont appliquées automatiquement au démarrage en staging et en
 * production. Toute instruction pouvant perdre des données ou casser la version
 * précédente de l'application (encore en service pendant le déploiement) doit
 * donc être explicitement assumée dans le fichier SQL, avec une ligne :
 *
 *   -- migration-destructive: <justification, sauvegarde vérifiée…>
 *
 * Voir docs/deployment-coolify.md § Migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = "drizzle";
const APPROVAL = /^--\s*migration-destructive:\s*\S+/m;

const RULES = [
  [/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE|VIEW|MATERIALIZED\s+VIEW)\b/i, "suppression"],
  [/\bTRUNCATE\b/i, "vidage de table"],
  [/\bDELETE\s+FROM\b/i, "suppression de lignes"],
  [/\bRENAME\b/i, "renommage (casse la version en cours d'exécution)"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "changement de type de colonne"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, "ajout de NOT NULL sur une colonne existante"],
];

const problems = [];

for (const file of readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  if (APPROVAL.test(sql)) continue;
  // Les commentaires SQL ne comptent pas.
  const code = sql.replace(/--.*$/gm, "");
  for (const [pattern, label] of RULES) {
    if (pattern.test(code)) problems.push(`${file} : ${label}`);
  }
}

if (problems.length > 0) {
  console.error("✖ Migrations potentiellement destructives non approuvées :");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "Découper la migration (expand / contract) ou ajouter « -- migration-destructive: <raison> ».",
  );
  process.exitCode = 1;
} else {
  console.log("✔ Aucune migration destructive non approuvée.");
}
