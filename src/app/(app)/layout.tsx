import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { requireActor } from "@/server/auth/session";

/**
 * Zone authentifiée : structure neutre (sidebar + contenu), sans parti pris visuel
 * en attendant les maquettes.
 *
 * Le layout vérifie la session, MAIS chaque page et chaque service doivent revérifier :
 * un layout n'est pas réexécuté à chaque navigation côté client.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <Sidebar actor={actor} />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
