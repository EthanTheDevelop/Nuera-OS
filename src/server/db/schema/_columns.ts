import { timestamp, uuid } from "drizzle-orm/pg-core";

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
