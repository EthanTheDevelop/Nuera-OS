import { z } from "@/lib/zod";
import {
  TILE_KEYS,
  TILE_SIZES,
  tileDefinition,
  upgradeTileSize,
  type TileKey,
} from "./dashboard.tiles";

const isTileKey = (value: unknown): value is TileKey =>
  (TILE_KEYS as readonly unknown[]).includes(value);

/**
 * Une disposition enregistrée peut porter un ancien format (`4x2`) : il se traduit à la lecture, sans
 * jamais faire échouer l'ensemble. Une tuile inconnue reste telle quelle : le schéma la refuse.
 */
export function upgradeStoredLayout(stored: unknown): unknown {
  if (typeof stored !== "object" || stored === null || !("tiles" in stored)) return stored;
  if (!Array.isArray(stored.tiles)) return stored;
  return {
    ...stored,
    tiles: stored.tiles.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null || !("key" in entry)) return entry;
      if (!isTileKey(entry.key)) return entry;
      const size = "size" in entry ? entry.size : undefined;
      return { ...entry, size: upgradeTileSize(size, tileDefinition(entry.key).size) };
    }),
  };
}

/** Disposition enregistrée : l'ordre du tableau fait foi, chaque côté du format va de 1 à 3. */
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
    tiles.forEach(({ key }, index) => {
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["tiles", index, "key"],
          message: "Une même tuile ne peut pas figurer deux fois.",
        });
      }
      seen.add(key);
    });
  });

export const SEARCH_MIN_LENGTH = 2;

/** Saisie de ⌘K : coupée plutôt que refusée, une frappe ne doit jamais lever d'erreur. */
export const searchQuerySchema = z
  .string()
  .trim()
  .transform((value) => value.slice(0, 120));
