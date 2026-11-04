import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// `tests/live` parle à une instance réelle : uniquement avec `npm run test:live` (--mode live).
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` lève une erreur hors du bundler Next.js : neutralisé en test.
      "server-only": fileURLToPath(new URL("./tests/helpers/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include:
      mode === "live" ? ["tests/live/**/*.test.ts"] : ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude:
      mode === "live" ? configDefaults.exclude : [...configDefaults.exclude, "tests/live/**"],
    // Les tests d'intégration démarrent un PostgreSQL embarqué (PGlite) par fichier.
    testTimeout: mode === "live" ? 180_000 : 30_000,
    hookTimeout: mode === "live" ? 180_000 : 60_000,
    env: {
      LOG_LEVEL: "silent",
    },
  },
}));
