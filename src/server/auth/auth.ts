import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createAccessControl } from "better-auth/plugins/access";
import { admin } from "better-auth/plugins/admin";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { recordAudit } from "@/modules/audit/audit.service";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy";
import { DEFAULT_ROLE, ROLES, type Role } from "./roles";

/**
 * Droits sur les opérations d'administration des comptes (plugin admin de better-auth).
 * L'usurpation d'identité (`impersonate`) et la suppression de comptes ne sont
 * accordées à AUCUN rôle : traçabilité préservée, désactivation (ban) privilégiée.
 * Ces droits sont distincts des permissions métier (src/server/auth/permissions.ts).
 */
const accessControl = createAccessControl(defaultStatements);
const accountAdministrator = accessControl.newRole({
  user: ["create", "list", "get", "update", "set-role", "ban", "set-password"],
  session: ["list", "revoke"],
});
const noAccountAdministration = accessControl.newRole({ user: [], session: [] });

const authRoles = Object.fromEntries(
  ROLES.map((role) => [role, role === "admin" ? accountAdministrator : noAccountAdministration]),
) as Record<Role, typeof noAccountAdministration>;

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
}

export function buildAuth({ db, secret, baseURL }: AuthOptions) {
  return betterAuth({
    appName: "Nuera OS",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      // Outil interne : aucun compte ne se crée seul. Création par un administrateur
      // (CLI `npm run user:create`, puis interface d'administration).
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    session: {
      // Session glissante : expire après 7 jours sans activité, prolongée au plus une fois par jour.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      // Actif quel que soit NODE_ENV (protège aussi une préproduction). Stockage mémoire :
      // suffisant pour une instance unique ; passer à "database" si plusieurs instances.
      enabled: true,
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      database: { generateId: "uuid" },
    },
    telemetry: { enabled: false },
    logger: {
      level: "warn",
      log: (level, message, ...args) => logger[level](`auth.library_${level}`, { message, args }),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            // La journalisation ne doit pas bloquer la connexion : erreur tracée, pas propagée.
            try {
              await recordAudit(db, {
                actorId: session.userId,
                action: "auth.signed_in",
                entityType: "user",
                entityId: session.userId,
              });
            } catch (error) {
              logger.error("audit.write_failed", { action: "auth.signed_in", error });
            }
          },
        },
      },
    },
    plugins: [
      admin({
        ac: accessControl,
        roles: authRoles,
        defaultRole: DEFAULT_ROLE,
        adminRoles: ["admin"],
      }),
      // Doit rester le dernier plugin : applique les cookies dans les Server Actions.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

const globalForAuth = globalThis as typeof globalThis & { __nueraAuth?: Auth };

/** Instance better-auth de l'application (création paresseuse, voir `getEnv`). */
export function getAuth(): Auth {
  if (!globalForAuth.__nueraAuth) {
    const env = getEnv();
    globalForAuth.__nueraAuth = buildAuth({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
    });
  }
  return globalForAuth.__nueraAuth;
}
