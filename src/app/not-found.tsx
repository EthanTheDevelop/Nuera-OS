import { ButtonLink } from "@/components/ui/button";
import { AuthCard, AuthScreen } from "./(auth)/auth-card";

export default function NotFound() {
  return (
    <AuthScreen>
      <AuthCard title="Page introuvable">
        <p className="text-sm text-muted">Cette page n’existe pas, ou elle a changé d’adresse.</p>
        <ButtonLink href="/" variant="accent" className="self-start">
          Retour à l’accueil
        </ButtonLink>
      </AuthCard>
    </AuthScreen>
  );
}
