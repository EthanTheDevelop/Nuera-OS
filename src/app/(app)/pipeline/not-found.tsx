import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

export default function OpportunityNotFound() {
  return (
    <EmptyState
      icon="pipeline"
      title="Affaire introuvable"
      description="Cette affaire n'existe pas, ou elle a été supprimée dans Twenty."
      action={<ButtonLink href="/pipeline">Retour au pipeline</ButtonLink>}
    />
  );
}
