import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Élément inexistant ou hors périmètre : la réponse est la même, rien n'est confirmé. */
export default function DocumentsNotFound() {
  return (
    <EmptyState
      icon="devis"
      title="Élément introuvable"
      description="Il n'existe pas, ou vous n'y avez pas accès."
      action={<ButtonLink href="/documents">Retour aux documents</ButtonLink>}
    />
  );
}
