import { eq } from "drizzle-orm";
import { emailOutbox } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface EmailDelivery {
  status: "pending" | "sent" | "failed" | "not_configured";
  queuedAt: Date;
  sentAt: Date | null;
  lastError: string | null;
}

/**
 * État réel d'un e-mail déposé dans la boîte, par sa clé. Jamais le contenu : il peut porter un lien
 * de connexion valide. Permet de dire la vérité à l'écran, sans présenter un dépôt comme un envoi.
 */
export async function getEmailDelivery(
  db: Database,
  dedupeKey: string,
): Promise<EmailDelivery | null> {
  const [row] = await db
    .select({
      status: emailOutbox.status,
      queuedAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
      lastError: emailOutbox.lastError,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.dedupeKey, dedupeKey))
    .limit(1);
  return row ?? null;
}
