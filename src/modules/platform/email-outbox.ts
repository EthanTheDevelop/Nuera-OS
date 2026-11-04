import { emailOutbox } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface EnqueueEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  /** Un second envoi avec la même clé est ignoré. */
  dedupeKey?: string;
}

/**
 * Dépose un e-mail dans `email_outbox`. L'envoi réel appartient à l'adaptateur SMTP : sans lui, la
 * ligne reste `pending`, rien n'est simulé. Le contenu peut porter un lien de connexion valide :
 * cette table ne s'expose jamais à l'interface.
 */
export async function enqueueEmail(db: Database, input: EnqueueEmailInput): Promise<void> {
  await db
    .insert(emailOutbox)
    .values({
      toAddress: input.to,
      subject: input.subject,
      html: input.html ?? null,
      text: input.text ?? null,
      template: input.template ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}
