import type { Metadata } from "next";
import { requireActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Accueil" };

/** Page d'accueil provisoire : aucun module métier n'est encore développé. */
export default async function HomePage() {
  const actor = await requireActor();
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Nuera OS</h1>
      <p className="text-ink-muted">
        Connecté en tant que {actor.name}. Les fondations sont en place ; aucun module métier
        n&apos;est encore développé.
      </p>
    </div>
  );
}
