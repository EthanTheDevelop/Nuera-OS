import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Imports interdits partout : Zod doit être importé depuis `@/lib/zod` (locale FR). */
const zodRestriction = {
  name: "zod",
  message: 'Importer `z` depuis "@/lib/zod" (messages de validation en français).',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": ["error", { paths: [zodRestriction] }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Séparation des couches : l'interface ne parle jamais directement à la base.
    // Elle passe par les services des modules (`src/modules/*/*.service.ts`).
    files: ["src/app/**", "src/components/**", "src/modules/*/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [zodRestriction],
          patterns: [
            {
              group: [
                "@/server/db",
                "@/server/db/*",
                "**/*.repository",
                "drizzle-orm",
                "drizzle-orm/*",
                "pg",
              ],
              message: "L'interface passe par les services des modules, pas par la base.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/zod.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "drizzle/**", "next-env.d.ts"]),
]);
