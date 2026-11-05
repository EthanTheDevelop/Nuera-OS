import { z } from "@/lib/zod";
import { webhookReceipts } from "@/server/db/schema";
import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { isInternalHref, notify } from "./notifications.service";

const payloadSchema = z.object({
  /** Identifiant unique de l'envoi : un second envoi est ignoré. */
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).nullish(),
  severity: z.enum(["info", "warning", "danger"]).default("info"),
  /** Lien interne seulement. */
  href: z
    .string()
    .max(500)
    .refine((value) => isInternalHref(value))
    .nullish(),
});

/**
 * Retour d'un scénario n8n, déjà authentifié par sa signature : il prévient la direction. Nuera OS
 * garde les règles métier : n8n ne modifie aucun objet par cette route.
 */
export async function handleN8nWebhook(
  db: Database,
  body: unknown,
): Promise<"applied" | "duplicate" | "invalid"> {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return "invalid";
  const input = parsed.data;

  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(webhookReceipts)
      .values({ service: "n8n", externalId: input.id, status: "processed" })
      .onConflictDoNothing({ target: [webhookReceipts.service, webhookReceipts.externalId] })
      .returning({ id: webhookReceipts.id });
    if (claimed.length === 0) return "duplicate";
    await notify(tx, {
      role: "admin",
      kind: "n8n",
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      dedupeKey: `n8n:${input.id}`,
    });
    return "applied";
  });
}

/** Pour la route HTTP, qui n'importe pas la base. */
export function processN8nWebhook(body: unknown) {
  return handleN8nWebhook(getDb(), body);
}
