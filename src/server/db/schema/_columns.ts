import { sql, type SQL } from "drizzle-orm";
import {
  check,
  foreignKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
  type PgColumn,
} from "drizzle-orm/pg-core";

/** Clé primaire UUID générée par PostgreSQL (`gen_random_uuid()`). */
export const id = () => uuid("id").primaryKey().defaultRandom();

/** Horodatages standards. `updatedAt` est mis à jour par Drizzle à chaque `update()`. */
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Instant métier (`timestamptz`), toujours en tant qu'objet `Date`. */
export const instant = (name: string) => timestamp(name, { withTimezone: true });

/** Tableau de texte, vide par défaut (jamais NULL). */
export const textArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

/** Tableau d'UUID, vide par défaut (jamais NULL). */
export const uuidArray = (name: string) =>
  uuid(name)
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`);

/** Liste SQL de littéraux (constantes du code, jamais une entrée utilisateur). */
export function sqlList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

/** Contrainte CHECK d'une colonne à valeurs fermées, sur le modèle de `users_role_check`. */
export function enumCheck(name: string, column: PgColumn, values: readonly string[]) {
  return check(name, sql`${column} in (${sqlList(values)})`);
}

/**
 * Clé étrangère composite à deux colonnes, en `ON DELETE RESTRICT`.
 *
 * Sert au cloisonnement : `(site_id, company_id) → sites(id, company_id)` rend un lien croisé
 * impossible en SQL. Une colonne locale NULL désactive le contrôle (`MATCH SIMPLE`) : un lien
 * facultatif reste possible, et les CHECK `*_company_required_check` empêchent de contourner la
 * contrainte en laissant `company_id` vide.
 *
 * `ON UPDATE` reste à `NO ACTION`, vérifié en fin d'instruction : une fusion d'entreprises peut
 * déplacer en une seule instruction (`WITH … UPDATE`) les lignes parentes et leurs enfants.
 */
export function companyFk(
  name: string,
  columns: [AnyPgColumn, AnyPgColumn],
  foreignColumns: [AnyPgColumn, AnyPgColumn],
) {
  return foreignKey({ name, columns, foreignColumns }).onDelete("restrict");
}
