import { EmptyState } from "@/components/states/states";
import { CompactLink } from "@/components/ui/compact-button";

/** Un objet hors de votre espace répond comme s'il n'existait pas. */
export default function PortalNotFound() {
  return (
    <EmptyState
      icon="search"
      title="Cette page n'existe pas dans votre espace"
      description="Le lien est peut-être ancien, ou l'élément n'est plus disponible."
      action={
        <CompactLink variant="secondary" href="/espace">
          Revenir à mon projet
        </CompactLink>
      }
    />
  );
}
