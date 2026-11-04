import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Site inconnu : la même réponse pour un identifiant illisible, rien n'est révélé. */
export default function SiteNotFound() {
  return (
    <EmptyState
      icon="sites"
      title="Site introuvable"
      description="Ce site n'existe pas ou n'est plus accessible."
      action={<ButtonLink href="/sites">Retour aux sites</ButtonLink>}
    />
  );
}
