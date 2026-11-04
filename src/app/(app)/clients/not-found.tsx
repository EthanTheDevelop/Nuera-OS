import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

export default function ClientNotFound() {
  return (
    <EmptyState
      icon="clients"
      title="Fiche introuvable"
      description="Cette fiche n'existe pas, ou elle a été supprimée dans Twenty."
      action={<ButtonLink href="/clients">Retour aux clients</ButtonLink>}
    />
  );
}
