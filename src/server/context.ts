import { IntegrationUnavailableError, type CrmGateway } from "@/integrations/twenty/crm-gateway";
import type { Actor } from "@/server/auth/permissions";
import type { Database } from "@/server/db/types";

/**
 * Contexte passé explicitement à chaque fonction de service.
 * Pas de conteneur d'injection : la base et l'acteur sont des paramètres,
 * ce qui rend les services testables sans Next.js (cf. tests PGlite).
 */
export interface ServiceContext {
  db: Database;
  actor: Actor;
  /** Port CRM. Renseigné par `getServiceContext()`, injecté par les tests. */
  crm?: CrmGateway;
}

/**
 * Contexte des services du portail client (`src/modules/portal`), issu de `portal_memberships`
 * (voir `resolvePortalContext`). Toute lecture filtre sur `companyId` ; un objet d'un autre client
 * répond 404. Un `PortalContext` n'a pas de `crm` : le portail lit uniquement la projection locale.
 */
export interface PortalContext {
  db: Database;
  actor: Actor;
  companyId: string;
  contactId: string;
}

/** Port CRM du contexte ; sans lui, « connexion requise » plutôt qu'un succès simulé. */
export function requireCrm(ctx: Pick<ServiceContext, "crm">): CrmGateway {
  if (!ctx.crm) throw new IntegrationUnavailableError("not_configured");
  return ctx.crm;
}
