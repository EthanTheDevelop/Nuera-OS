import { notify } from "@/modules/platform/notifications.service";
import { hasPermission, type Actor } from "@/server/auth/permissions";
import type { Database } from "@/server/db/types";
import { ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import * as repository from "./message.repository";

/** Compte mentionné, sous la forme d'un acteur : ses droits se vérifient comme ceux de l'auteur. */
export type MentionedUser = Actor;

/**
 * Mentions partagées par les messages et les commentaires.
 * Une mention désigne un compte réel de l'équipe : ni un client, ni un compte désactivé.
 */
export async function assertMentionsValid(
  db: Database,
  ids: readonly string[],
): Promise<MentionedUser[]> {
  const rows = await loadInternalUsers(db, ids);
  if (rows.length !== new Set(ids).size) {
    throw new ValidationError("Une personne mentionnée n'existe pas.", {
      mentions: ["Mention invalide."],
    });
  }
  return rows;
}

async function loadInternalUsers(db: Database, ids: readonly string[]): Promise<MentionedUser[]> {
  const unique = [...new Set(ids)];
  return unique.length === 0 ? [] : repository.findInternalUsers(db, unique);
}

/**
 * Comptes de la liste qui lisent les messages. Mentionner quelqu'un d'autre lui enverrait l'extrait
 * d'un échange client et un lien qu'il ne peut pas ouvrir.
 */
export async function filterMessageReaders(
  db: Database,
  ids: readonly string[],
): Promise<Set<string>> {
  const rows = await loadInternalUsers(db, ids);
  return new Set(
    rows.filter((row) => hasPermission(row.role, "messages:read")).map((row) => row.userId),
  );
}

/**
 * Prévient les personnes mentionnées, sans l'auteur, dans la transaction de l'opération.
 *
 * Point de reprise : un échec de notification annule la notification, pas le message ni le
 * commentaire, qui restent la donnée à ne pas perdre.
 */
export async function notifyMentioned(
  tx: Database,
  input: {
    mentions: readonly string[];
    actorId: string;
    title: string;
    body: string;
    href: string;
    entityType: string;
    entityId: string;
  },
): Promise<void> {
  const userIds = [...new Set(input.mentions)].filter((id) => id !== input.actorId);
  if (userIds.length === 0) return;
  try {
    await tx.transaction((savepoint) =>
      notify(savepoint, {
        userIds,
        kind: "mention",
        severity: "info",
        title: input.title,
        body: input.body,
        href: input.href,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: `mention:${input.entityType}:${input.entityId}`,
      }),
    );
  } catch (error) {
    logger.warn("mention.notify_failed", {
      entityType: input.entityType,
      entityId: input.entityId,
      error,
    });
  }
}

/** Extrait d'un texte pour une notification : une ligne, sans fin coupée au milieu d'un mot. */
export function excerpt(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
