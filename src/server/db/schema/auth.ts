import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Imports relatifs dans le schéma : drizzle-kit ne résout pas les alias `@/`.
import { DEFAULT_ROLE, ROLES } from "../../auth/roles";
import { id, timestamps } from "./_columns";

/**
 * Tables gérées par better-auth (core + plugins admin et twoFactor ; magicLink n'utilise que
 * `verifications`).
 *
 * Les noms de propriétés TypeScript DOIVENT correspondre aux champs better-auth
 * (`emailVerified`, `banExpires`…). Toute évolution de la configuration better-auth
 * (nouveau plugin) peut exiger de nouvelles colonnes : vérifié par `getAuthTables()`
 * dans `tests/integration/auth-plugins.test.ts`.
 */

/** Valeurs de rôle autorisées, dérivées de `ROLES` (constantes littérales, pas d'entrée utilisateur). */
const ROLE_VALUES = sql.raw(ROLES.map((role) => `'${role}'`).join(", "));

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Plugin admin
    role: text("role", { enum: ROLES }).notNull().default(DEFAULT_ROLE),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    // Plugin twoFactor
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    ...timestamps(),
  },
  (t) => [check("users_role_check", sql`${t.role} in (${ROLE_VALUES})`)],
);

/** Plugin twoFactor : secret TOTP et codes de secours, chiffrés par better-auth. */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("two_factors_user_id_idx").on(t.userId),
    index("two_factors_secret_idx").on(t.secret),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Données de sécurité (détection d'usage anormal) — données personnelles : durée
    // de conservation à définir avec le DPO.
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Plugin admin. L'usurpation d'identité est désactivée par la configuration des rôles.
    impersonatedBy: uuid("impersonated_by"),
    ...timestamps(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Empreinte du mot de passe (scrypt, gérée par better-auth). Jamais lue par l'application. */
    password: text("password"),
    ...timestamps(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
