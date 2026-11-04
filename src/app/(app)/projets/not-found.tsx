import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Projet inconnu ou hors périmètre : la même réponse, sans révéler son existence. */
export default function ProjectNotFound() {
  return (
    <EmptyState
      icon="projets"
      title="Projet introuvable"
      description="Ce projet n’existe pas, ou il ne vous est pas affecté."
      action={<ButtonLink href="/projets">Retour aux projets</ButtonLink>}
    />
  );
}
