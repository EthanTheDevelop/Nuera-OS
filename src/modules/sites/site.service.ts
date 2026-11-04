import type { ServiceContext } from "@/server/context";
import type { Database } from "@/server/db/types";

export interface ActivateSiteAfterGoLiveInput {
  projectId: string;
  siteId: string;
}

/** Passe le site en ligne à la fin d'un projet (parcours 2). */
export async function activateSiteAfterGoLive(
  _ctx: ServiceContext,
  _tx: Database,
  _input: ActivateSiteAfterGoLiveInput,
): Promise<void> {
  throw new Error("activateSiteAfterGoLive n'est pas implémenté : à livrer par le lot Sites.");
}
