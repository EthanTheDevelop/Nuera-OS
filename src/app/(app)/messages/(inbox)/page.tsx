import type { Metadata } from "next";
import { ForbiddenState } from "@/components/states/states";
import { paramValue } from "@/lib/url-state";
import { MessagesScreen } from "@/modules/messaging/components/messages-screen";
import { getConversation } from "@/modules/messaging/message.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import ConversationNotFound from "../[conversationId]/not-found";

export const metadata: Metadata = { title: "Messages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La conversation ouverte est le paramètre `c`, pas un segment `[id]` : un segment dynamique
 * remonte tout l'écran (liste, fil, panneau) à chaque changement de valeur. Ici la page reste
 * la même, seule la conversation change.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "messages:read")) return <ForbiddenState />;

  const query = await searchParams;
  const requested = paramValue(query, "c");
  if (requested !== undefined) {
    if (!UUID.test(requested)) return <ConversationNotFound />;
    try {
      await getConversation(ctx, requested);
    } catch (error) {
      if (error instanceof NotFoundError) return <ConversationNotFound />;
      throw error;
    }
  }
  return <MessagesScreen ctx={ctx} conversationId={requested} searchParams={query} />;
}
