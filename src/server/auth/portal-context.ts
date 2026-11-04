import { and, eq, ne } from "drizzle-orm";
import { recordAudit } from "@/modules/audit/audit.service";
import type { PortalContext } from "@/server/context";
import { portalMemberships } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { ForbiddenError } from "@/server/errors";
import type { Actor } from "./permissions";

/** Fréquence d'écriture de `last_seen_at` : pas d'écriture à chaque requête. */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

const NO_ACCESS_MESSAGE = "Votre accès à l'espace client n'est pas ou plus actif.";

/**
 * Construit le `PortalContext` d'un utilisateur à partir de `portal_memberships`, source unique du
 * cloisonnement client, relue à chaque requête : une révocation est immédiate.
 *
 * Refuse tout rôle autre que `client`, une adhésion absente ou révoquée. Une adhésion `invited`
 * devient `active` au premier accès authentifié, avec une trace d'audit.
 */
export async function resolvePortalContext(db: Database, actor: Actor): Promise<PortalContext> {
  if (actor.role !== "client") throw new ForbiddenError(NO_ACCESS_MESSAGE);

  const [membership] = await db
    .select()
    .from(portalMemberships)
    .where(eq(portalMemberships.userId, actor.userId))
    .limit(1);
  if (!membership || membership.status === "revoked") throw new ForbiddenError(NO_ACCESS_MESSAGE);

  const now = new Date();
  const isStale =
    !membership.lastSeenAt ||
    now.getTime() - membership.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS;

  if (membership.status === "invited") {
    await db.transaction(async (tx) => {
      // La condition couvre une révocation survenue entre la lecture et l'écriture.
      const [activated] = await tx
        .update(portalMemberships)
        .set({ status: "active", lastSeenAt: now })
        .where(
          and(eq(portalMemberships.id, membership.id), ne(portalMemberships.status, "revoked")),
        )
        .returning({ id: portalMemberships.id });
      if (!activated) throw new ForbiddenError(NO_ACCESS_MESSAGE);
      await recordAudit(tx, {
        actorId: actor.userId,
        action: "portal.membership_activated",
        entityType: "portal_membership",
        entityId: membership.id,
        metadata: { companyId: membership.companyId },
      });
    });
  } else if (isStale) {
    await db
      .update(portalMemberships)
      .set({ lastSeenAt: now })
      .where(eq(portalMemberships.id, membership.id));
  }

  return { db, actor, companyId: membership.companyId, contactId: membership.contactId };
}
