import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Contrat inconnu, archivé ou hors périmètre : la même réponse, sans révéler son existence. */
export default function ContractNotFound() {
  return (
    <EmptyState
      icon="contrat"
      title="Contrat introuvable"
      description="Ce contrat n’existe pas, ou il a été archivé."
      action={<ButtonLink href="/contrats">Retour aux contrats</ButtonLink>}
    />
  );
}
