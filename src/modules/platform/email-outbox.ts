import { and, asc, eq, inArray } from "drizzle-orm";
import type { SmtpGateway } from "@/integrations/smtp/smtp.client";
import { emailOutbox } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { isAppError } from "@/server/errors";
import { logger } from "@/server/logger";

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
 * Dépose un e-mail dans `email_outbox`. L'envoi réel appartient à `drainEmailOutbox` : sans SMTP, la
 * ligne passe `not_configured`, rien n'est simulé. Le contenu peut porter un lien de connexion
 * valide : cette table ne s'expose jamais à l'interface.
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

/** Tentatives d'envoi avant l'échec définitif. */
export const MAX_EMAIL_ATTEMPTS = 5;
/** Attente entre deux tentatives : `attempts × 5` minutes. */
const EMAIL_RETRY_DELAY_MS = 5 * 60_000;
const DEFAULT_DRAIN_BATCH = 100;

/**
 * Durée de vie du contenu des messages qui portent un lien actif (`docs/domain-model.md` §9) : un
 * lien mort ne sert à personne, et son texte ne doit pas rester en base.
 */
const LINK_TEMPLATES_TTL_MS: Record<string, number> = {
  portal_magic_link: 24 * 3_600_000,
  portal_invitation: 24 * 3_600_000,
  password_reset: 3_600_000,
  user_invitation: 7 * 24 * 3_600_000,
};

/** Efface le contenu : garde le destinataire, l'objet et le statut pour le suivi. */
async function scrub(
  db: Database,
  id: string,
  values: Partial<typeof emailOutbox.$inferInsert>,
): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ ...values, html: null, text: null })
    .where(eq(emailOutbox.id, id));
}

export interface DrainResult {
  sent: number;
  failed: number;
  notConfigured: number;
  expired: number;
}

/**
 * Vide la boîte d'envoi. Répétable, et sûr si deux lancements se croisent : une ligne se prend par
 * mise à jour conditionnelle de `attempts`. Après un envoi, `html` et `text` sont effacés, car ils
 * peuvent contenir un lien de connexion actif. Sans SMTP, rien ne part et les lignes le disent.
 */
export async function drainEmailOutbox(
  db: Database,
  smtp: SmtpGateway,
  options: { now?: Date; limit?: number; replyTo?: string | null } = {},
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const result: DrainResult = { sent: 0, failed: 0, notConfigured: 0, expired: 0 };

  if (!smtp.isConfigured) {
    const updated = await db
      .update(emailOutbox)
      .set({ status: "not_configured", lastError: "Serveur d'envoi non configuré." })
      .where(eq(emailOutbox.status, "pending"))
      .returning({ id: emailOutbox.id });
    result.notConfigured = updated.length;
  }

  // Liens morts jamais partis : leur contenu ne reste pas en base.
  const waiting = await db
    .select({
      id: emailOutbox.id,
      template: emailOutbox.template,
      createdAt: emailOutbox.createdAt,
    })
    .from(emailOutbox)
    .where(
      and(
        inArray(emailOutbox.status, ["pending", "not_configured"]),
        inArray(emailOutbox.template, Object.keys(LINK_TEMPLATES_TTL_MS)),
      ),
    );
  for (const row of waiting) {
    const ttl = LINK_TEMPLATES_TTL_MS[row.template ?? ""];
    if (ttl !== undefined && now.getTime() - row.createdAt.getTime() > ttl) {
      await scrub(db, row.id, { status: "failed", lastError: "Lien expiré avant l'envoi." });
      result.expired += 1;
    }
  }

  if (!smtp.isConfigured) return result;

  const rows = await db
    .select()
    .from(emailOutbox)
    .where(inArray(emailOutbox.status, ["pending", "not_configured"]))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(options.limit ?? DEFAULT_DRAIN_BATCH);

  for (const row of rows) {
    if (row.attempts >= MAX_EMAIL_ATTEMPTS) continue;
    const waited = now.getTime() - row.updatedAt.getTime();
    if (row.attempts > 0 && waited < row.attempts * EMAIL_RETRY_DELAY_MS) continue;

    const claimed = await db
      .update(emailOutbox)
      .set({ attempts: row.attempts + 1, status: "pending" })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.attempts, row.attempts)))
      .returning({ id: emailOutbox.id });
    if (claimed.length === 0) continue;

    try {
      await smtp.send({
        to: row.toAddress,
        subject: row.subject,
        text: row.text,
        html: row.html,
        replyTo: options.replyTo,
      });
      await scrub(db, row.id, { status: "sent", sentAt: new Date(), lastError: null });
      result.sent += 1;
    } catch (error) {
      if (!isAppError(error)) logger.error("email.send_failed", { id: row.id, error });
      const message = isAppError(error) ? error.message : "Échec de l'envoi.";
      if (row.attempts + 1 >= MAX_EMAIL_ATTEMPTS) {
        await scrub(db, row.id, { status: "failed", lastError: message });
      } else {
        await db
          .update(emailOutbox)
          .set({ status: "pending", lastError: message })
          .where(eq(emailOutbox.id, row.id));
      }
      result.failed += 1;
    }
  }
  return result;
}
