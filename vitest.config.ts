import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` lève une erreur hors du bundler Next.js : neutralisé en test.
      "server-only": fileURLToPath(new URL("./tests/helpers/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Les tests d'intégration démarrent un PostgreSQL embarqué (PGlite) par fichier.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      LOG_LEVEL: "silent",
    },
  },
});
