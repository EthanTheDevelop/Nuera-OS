import { getTextGenerator } from "@/integrations/openai";
import { getUnreadCount } from "@/modules/messaging/message.service";
import { getSupportOverview } from "@/modules/support/ticket.service";
import { listAssignableMembers, type MemberOption } from "@/modules/team/team.lookup";
import { can, canAny, type Actor } from "@/server/auth/permissions";
import { getEnv } from "@/server/config/env";
import type { ServiceContext } from "@/server/context";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { findAppearance } from "./notifications.repository";
import { getNotificationCenter, type NotificationView } from "./notifications.service";

export interface ShellData {
  counters: { messages?: number; support?: number };
  notifications: NotificationView[];
  /** Bloc utilisateur (Figma 57:578) : les associés, pour un compte d'associé. */
  people?: { name: string }[];
  title?: string;
  detail?: string;
  chatgptLabel?: string;
  /** Accès directs au CRM et à la base, réservés aux associés. */
  externalLinks?: { label: string; href: string; icon: "clients" | "book" }[];
  /** Apparence enregistrée : appliquée sur un navigateur qui ne l'a pas encore. */
  appearance?: { theme: string; accent: string | null; density: string } | null;
}

/** Une panne de cette source est tracée et remplacée par une valeur vide : la coque reste debout. */
async function safely<T>(source: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    logger.warn("shell.source_failed", { source, error });
    return fallback;
  }
}

function firstNames(partners: readonly MemberOption[]): string {
  const names = partners.map((partner) => partner.fullName.split(" ")[0] ?? partner.fullName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

/**
 * Données de la coque, lues en parallèle à chaque rendu du layout. Un compte ne voit que ses
 * compteurs : `getUnreadCount` et `getSupportOverview` appliquent eux-mêmes droits et périmètre.
 */
function toolLinks(actor: Actor): NonNullable<ShellData["externalLinks"]> {
  if (!can(actor, "users:manage")) return [];
  const { TWENTY_API_URL, DB_ADMIN_URL } = getEnv();
  return [
    ...(TWENTY_API_URL
      ? [{ label: "CRM Twenty", href: TWENTY_API_URL, icon: "clients" as const }]
      : []),
    ...(DB_ADMIN_URL
      ? [{ label: "Base de données", href: DB_ADMIN_URL, icon: "book" as const }]
      : []),
  ];
}

export async function getShellData(ctx: ServiceContext): Promise<ShellData> {
  const { db, actor } = ctx;
  const [unread, support, center, members, appearance] = await Promise.all([
    can(actor, "messages:read")
      ? safely("messages", () => getUnreadCount(db, actor.userId), 0)
      : Promise.resolve(0),
    canAny(actor, ["support:read", "support:read_assigned"])
      ? safely("support", async () => (await getSupportOverview(ctx)).open, 0)
      : Promise.resolve(0),
    safely("notifications", () => getNotificationCenter(db, actor.userId), {
      items: [],
      unread: 0,
    }),
    safely("team", () => listAssignableMembers(db), [] as MemberOption[]),
    safely("appearance", () => findAppearance(db, actor.userId), null),
  ]);

  const partners = members.filter((member) => member.kind === "partner");
  const isPartner = partners.some((partner) => partner.userId === actor.userId);

  let chatgptLabel: string | undefined;
  if (can(actor, "integrations:read")) {
    try {
      chatgptLabel = getTextGenerator().isConfigured ? "Configuré" : undefined;
    } catch (error) {
      logger.warn("shell.source_failed", { source: "openai", error });
    }
  }

  return {
    counters: {
      ...(unread > 0 ? { messages: unread } : {}),
      ...(support > 0 ? { support } : {}),
    },
    notifications: center.items,
    appearance,
    chatgptLabel,
    externalLinks: toolLinks(ctx.actor),
    ...(isPartner && partners.length > 1
      ? {
          people: partners.map((partner) => ({ name: partner.fullName })),
          title: firstNames(partners),
          detail: "Nuera Studio · direction",
        }
      : {}),
  };
}

/** Pour le layout, qui n'importe pas la base. */
export function getShellDataFor(actor: Actor): Promise<ShellData> {
  return getShellData({ db: getDb(), actor });
}
