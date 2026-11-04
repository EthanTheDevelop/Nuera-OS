import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";

/** Rôle sans `finance:read` : la page dit ce qui se passe, sans rien montrer du contenu. */
export function FinanceForbidden() {
  return (
    <>
      <PageHeader title="Finances et rentabilité" />
      <ForbiddenState
        description="Les finances sont réservées aux associés. Un associé peut vous transmettre ce dont vous avez besoin."
        action={<ButtonLink href="/">Retour au tableau de bord</ButtonLink>}
      />
    </>
  );
}
