import "server-only";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createAccessControl } from "better-auth/plugins/access";
import { admin } from "better-auth/plugins/admin";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import { recordAudit } from "@/modules/audit/audit.service";
import { kickEmailOutbox } from "@/modules/platform/email-outbox.kick";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { accounts, sessions, twoFactors, users, verifications } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { sendPasswordResetMail } from "./reset-link";
import {
  createOutboxMagicLinkSender,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  sendMagicLinkToPortalClient,
  type MagicLinkSender,
} from "./magic-link";
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

/**
 * Routes HTTP du plugin admin, fermées : tout passe par `admin.service`, qui journalise et applique
 * les règles (dernier compte de direction, type de fiche). L'API serveur (`auth.api.createUser`) reste
 * disponible : better-auth ne contrôle `disabledPaths` qu'à l'entrée HTTP.
 */
const CLOSED_ADMIN_PATHS = [
  "ban-user",
  "create-user",
  "get-user",
  "has-permission",
  "impersonate-user",
  "list-user-sessions",
  "list-users",
  "remove-user",
  "revoke-user-session",
  "revoke-user-sessions",
  "set-role",
  "set-user-password",
  "stop-impersonating",
  "unban-user",
  "update-user",
].map((path) => `/admin/${path}`);

/**
 * Tout ce que l'interface n'appelle pas est fermé, pour qu'une session ne puisse pas s'en servir :
 * `/update-user` écrivait un nom et une image sans validation ni journal, `/list-sessions` et
 * `/get-session` rendaient au script les jetons que le cookie `HttpOnly` protège. La lecture de la
 * session passe par `auth.api`, que `disabledPaths` ne filtre pas. `tests/integration/security`
 * échoue si une mise à jour de better-auth ajoute une route qui n'est classée nulle part.
 *
 * `/callback/:id` n'est pas fermable ainsi (`disabledPaths` compare le chemin exact) : sans fournisseur
 * configuré, cette route ne fait que renvoyer vers la page d'erreur.
 */
const CLOSED_UNUSED_PATHS = [
  "/account-info",
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/refresh-token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/social",
  "/sign-up/email",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

export const CLOSED_AUTH_PATHS = [...CLOSED_ADMIN_PATHS, ...CLOSED_UNUSED_PATHS];

/** Échecs de connexion comptés dans les journaux : un pic se voit, sans l'adresse visée. */
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

const authRoles = Object.fromEntries(
  ROLES.map((role) => [role, role === "admin" ? accountAdministrator : noAccountAdministration]),
) as Record<Role, typeof noAccountAdministration>;

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  /** Envoi du lien de connexion client. Par défaut : dépôt dans `email_outbox`. */
  sendMagicLink?: MagicLinkSender;
  /** Appelé après le dépôt d'un e-mail de connexion, pour ne pas attendre la tâche planifiée. */
  onMailQueued?: () => void;
  /**
   * Un client entre par son lien, jamais par un mot de passe : refus par défaut. Vrai seulement hors
   * production, où les comptes clients du seed ont un mot de passe pour les parcours de test.
   */
  allowClientPassword?: boolean;
}

/** Journal d'une opération de sécurité : une erreur est tracée, jamais propagée à la connexion. */
async function auditQuietly(db: Database, event: Parameters<typeof recordAudit>[1]): Promise<void> {
  try {
    await recordAudit(db, event);
  } catch (error) {
    logger.error("audit.write_failed", { action: event.action, error });
  }
}

export function buildAuth({
  db,
  secret,
  baseURL,
  sendMagicLink,
  onMailQueued,
  allowClientPassword = false,
}: AuthOptions) {
  const outboxSender = createOutboxMagicLinkSender(db);
  const magicLinkSender: MagicLinkSender =
    sendMagicLink ??
    (async (mail) => {
      await outboxSender(mail);
      onMailQueued?.();
    });

  return betterAuth({
    appName: "Nuera OS",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    disabledPaths: CLOSED_AUTH_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-out") {
          const current = await getSessionFromCtx(ctx);
          if (current) {
            await auditQuietly(db, {
              actorId: current.user.id,
              action: "auth.signed_out",
              entityType: "user",
              entityId: current.user.id,
            });
          }
          return;
        }
        if (ctx.path !== "/sign-in/email" || allowClientPassword) return;
        const { email, password } = (ctx.body ?? {}) as { email?: unknown; password?: unknown };
        if (typeof email !== "string" || typeof password !== "string") return;
        const [user] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.email, email.trim().toLowerCase()))
          .limit(1);
        if (user?.role !== "client") return;
        // Même réponse et même coût qu'un mauvais mot de passe : l'adresse n'est pas révélée.
        await ctx.context.password.hash(password);
        throw new APIError("UNAUTHORIZED", {
          message: "Invalid email or password",
          code: "INVALID_EMAIL_OR_PASSWORD",
        });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (CREDENTIAL_PATHS.has(ctx.path) && isAPIError(ctx.context.returned)) {
          logger.warn("auth.sign_in_failed", { path: ctx.path });
        }
      }),
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // Outil interne : aucun compte ne se crée seul. Création par un administrateur
      // (CLI `npm run user:create`, puis interface d'administration).
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Un mot de passe réinitialisé ferme toutes les sessions ouvertes.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const queued = await sendPasswordResetMail(db, { userId: user.id, email: user.email, url });
        if (queued) onMailQueued?.();
      },
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
      user: {
        update: {
          // better-auth n'écrit ce drapeau qu'à l'activation réelle et à la désactivation.
          after: async (user, context) => {
            const path = context?.path;
            const enabled = (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled;
            if (path === "/two-factor/verify-totp" && enabled) {
              await auditQuietly(db, {
                actorId: user.id,
                action: "auth.two_factor_enabled",
                entityType: "user",
                entityId: user.id,
              });
            }
            if (path === "/two-factor/disable" && !enabled) {
              await auditQuietly(db, {
                actorId: user.id,
                action: "auth.two_factor_disabled",
                entityType: "user",
                entityId: user.id,
              });
            }
          },
        },
      },
      account: {
        update: {
          after: async (account, context) => {
            const path = context?.path;
            if (path === "/change-password" || path === "/reset-password") {
              await auditQuietly(db, {
                actorId: account.userId,
                action: "user.password_reset",
                entityType: "user",
                entityId: account.userId,
                metadata: { via: path === "/change-password" ? "profile" : "reset_link" },
              });
            }
          },
        },
      },
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
      // Équipe : second facteur TOTP. Le secret et les codes de secours sont chiffrés.
      twoFactor({ issuer: "Nuera OS" }),
      // Clients : lien par e-mail. Il ne crée jamais de compte, et ne part que vers un client au
      // `portal_memberships` valide (voir magic-link.ts). Jeton stocké haché en base.
      magicLink({
        disableSignUp: true,
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: "hashed",
        sendMagicLink: ({ email, url }) =>
          sendMagicLinkToPortalClient(db, magicLinkSender, { email, url }),
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
      onMailQueued: () => kickEmailOutbox(getDb()),
      allowClientPassword: env.NODE_ENV !== "production",
    });
  }
  return globalForAuth.__nueraAuth;
}
