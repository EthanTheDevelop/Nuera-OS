import { z } from "@/lib/zod";
import { TILE_KEYS, TILE_SIZES, tileDefinition } from "./dashboard.tiles";

/** Disposition enregistrée : l'ordre du tableau fait foi, le format borné à ceux de la tuile. */
export const dashboardLayoutSchema = z
  .object({
    tiles: z
      .array(
        z.object({
          key: z.enum(TILE_KEYS, "Cette tuile n'existe pas."),
          size: z.enum(TILE_SIZES, "Ce format de tuile n'existe pas."),
        }),
      )
      .max(TILE_KEYS.length, "Le tableau contient trop de tuiles."),
  })
  .superRefine(({ tiles }, context) => {
    const seen = new Set<string>();
    tiles.forEach(({ key, size }, index) => {
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["tiles", index, "key"],
          message: "Une même tuile ne peut pas figurer deux fois.",
        });
      }
      seen.add(key);
      if (!tileDefinition(key).sizes.includes(size)) {
        context.addIssue({
          code: "custom",
          path: ["tiles", index, "size"],
          message: "Cette tuile n'existe pas dans ce format.",
        });
      }
    });
  });

export const SEARCH_MIN_LENGTH = 2;

/** Saisie de ⌘K : coupée plutôt que refusée, une frappe ne doit jamais lever d'erreur. */
export const searchQuerySchema = z
  .string()
  .trim()
  .transform((value) => value.slice(0, 120));
