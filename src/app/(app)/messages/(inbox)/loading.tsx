import { MessagesLoading } from "@/modules/messaging/components/messages-screen";

/**
 * À l'entrée dans les messages seulement. Pas de `loading.tsx` sur `[conversationId]` : changer de
 * conversation garde l'écran en place au lieu de le remplacer par un squelette.
 */
export default function Loading() {
  return <MessagesLoading />;
}
