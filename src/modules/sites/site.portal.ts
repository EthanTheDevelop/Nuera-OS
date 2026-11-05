import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { sites, type Site } from "@/server/db/schema";
import type { PortalContext } from "@/server/context";
import * as repository from "./site.repository";

/**
 * Sites vus du portail client. Ni serveur, ni dépôt, ni identifiant Coolify, ni CMS d'administration,
 * ni responsable interne : un nom, un état et les adresses que le client peut ouvrir.
 */
export type PortalSiteStatus = Exclude<Site["status"], "archived">;

export interface PortalSite {
  id: string;
  name: string;
  primaryDomain: string | null;
  status: PortalSiteStatus;
  liveOn: string | null;
  projectId: string | null;
  /** Adresse publique : le site en ligne, ou sa préproduction tant qu'il n'y est pas. */
  url: string | null;
}

function toHttpUrl(value: string | null): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Sites du client connecté : le filtre sur `companyId` fait foi, un site archivé n'existe plus. */
export async function listSitesForPortal(
  ctx: Pick<PortalContext, "db" | "companyId">,
): Promise<PortalSite[]> {
  const rows = await ctx.db
    .select({
      id: sites.id,
      name: sites.name,
      primaryDomain: sites.primaryDomain,
      status: sites.status,
      liveOn: sites.liveOn,
      projectId: sites.projectId,
    })
    .from(sites)
    .where(
      and(
        eq(sites.companyId, ctx.companyId),
        isNull(sites.archivedAt),
        ne(sites.status, "archived"),
      ),
    )
    .orderBy(asc(sites.name))
    .limit(200);

  const environments = await repository.listEnvironments(
    ctx.db,
    rows.map((row) => row.id),
  );
  const urlOf = (siteId: string, kind: "production" | "staging") =>
    environments.find((row) => row.siteId === siteId && row.kind === kind)?.url ?? null;

  return rows.map((row) => {
    const production = toHttpUrl(urlOf(row.id, "production"));
    const staging = toHttpUrl(urlOf(row.id, "staging"));
    const domain = toHttpUrl(row.primaryDomain);
    return {
      id: row.id,
      name: row.name,
      primaryDomain: row.primaryDomain,
      status: row.status as PortalSiteStatus,
      liveOn: row.liveOn,
      projectId: row.projectId,
      url: row.status === "live" ? (production ?? domain) : (staging ?? production ?? null),
    };
  });
}
