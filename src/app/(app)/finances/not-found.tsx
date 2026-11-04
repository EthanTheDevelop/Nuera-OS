import { EmptyState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Facture, échéance, import ou marge inconnus : la même réponse, sans révéler leur existence. */
export default function FinanceNotFound() {
  return (
    <EmptyState
      icon="euro"
      title="Élément introuvable"
      description="Cet élément financier n’existe pas ou plus."
      action={<ButtonLink href="/finances">Retour aux finances</ButtonLink>}
    />
  );
}
