import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Fiche ou mission inconnue, ou hors du périmètre de l'acteur : même réponse, sans rien révéler. */
export default function TeamNotFound() {
  return (
    <>
      <PageHeader title="Fiche introuvable" />
      <div className="anim-content rounded-lg bg-surface shadow-soft">
        <EmptyState
          icon="equipe"
          title="Cette fiche n’existe pas, ou elle ne vous est pas accessible"
          description="Vérifiez le lien, ou demandez cet accès à votre responsable."
          action={
            <ButtonLink href="/" variant="accent">
              Retour à l’accueil
            </ButtonLink>
          }
        />
      </div>
    </>
  );
}
