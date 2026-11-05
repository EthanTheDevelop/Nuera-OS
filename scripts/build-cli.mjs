/**
 * Compile les scripts d'exploitation en fichiers autonomes pour l'image Docker :
 * `npm run build:cli` → `dist/cli/*.mjs`.
 *
 * L'image de production ne contient ni `tsx` ni les sources : ces bundles permettent
 * d'appliquer les migrations, de créer un compte ou de charger les données fictives de staging
 * (`docs/ops/donnees-staging.md`) depuis le terminal du conteneur
 * (ex. `node cli/user-create.mjs …` dans Coolify), avec la même configuration
 * (`DATABASE_URL`, `BETTER_AUTH_*`) que l'application.
 */
import { build } from "esbuild";

await build({
  entryPoints: {
    "db-migrate": "scripts/db-migrate.ts",
    "user-create": "scripts/user-create.ts",
    "db-seed-staging": "scripts/db-seed-staging.ts",
  },
  outdir: "dist/cli",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Même résolution que `tsx --conditions=react-server` : `server-only` devient un module vide.
  conditions: ["react-server"],
  // Dépendance optionnelle de `pg`, jamais installée.
  external: ["pg-native"],
  // Les dépendances CommonJS embarquées appellent `require` : on le fournit en ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "info",
});
