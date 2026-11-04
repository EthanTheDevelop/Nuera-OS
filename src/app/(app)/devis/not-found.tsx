import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Devis ou prestation inconnus ou archivés : même réponse, sans rien révéler de plus. */
export default function DevisNotFound() {
  return (
    <EmptyState
      icon="devis"
      title="Devis introuvable"
      description="Ce devis n’existe pas, ou il a été archivé."
      action={<ButtonLink href="/devis">Retour aux devis</ButtonLink>}
    />
  );
}
