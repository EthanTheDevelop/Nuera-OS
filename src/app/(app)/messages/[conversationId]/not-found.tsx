import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

export default function ConversationNotFound() {
  return (
    <EmptyState
      icon="messages"
      title="Conversation introuvable"
      description="Elle n'existe pas, ou vous n'y avez pas accès."
      action={<ButtonLink href="/messages">Retour aux messages</ButtonLink>}
    />
  );
}
