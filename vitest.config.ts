import { availableParallelism } from "node:os";
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
    // Chaque fichier d'intégration démarre un PostgreSQL embarqué (PGlite) dans son propre processus.
    // Un processus par cœur épuise la mémoire validée d'une grosse machine (32 cœurs : plantages
    // 0xC0000409 et 0xC000012D) : plafond fixe, et jamais plus de cœurs que disponibles.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
    testTimeout: mode === "live" ? 180_000 : 30_000,
    hookTimeout: mode === "live" ? 180_000 : 60_000,
    env: {
      LOG_LEVEL: "silent",
    },
  },
}));
