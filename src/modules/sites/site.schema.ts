import {
  CMS_KINDS,
  ENVIRONMENT_KINDS,
  ENVIRONMENT_STATUSES,
  SITE_KINDS,
  SITE_STATUSES,
} from "@/lib/domain-enums";
import { z } from "@/lib/zod";

/** Champ de formulaire vide : `null`. */
function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max, `${max} caractères au maximum.`).nullable());

const optionalUuid = z.preprocess(emptyToNull, z.uuid("Sélection invalide.").nullable());

/** http ou https seulement : ces adresses deviennent des liens cliquables. */
const httpUrl = z.url({
  protocol: /^https?$/,
  error: "Saisissez une adresse complète, en http:// ou https://.",
});
const optionalHttpUrl = z.preprocess(emptyToNull, httpUrl.max(500).nullable());

const optionalDay = z.preprocess(emptyToNull, z.iso.date("Saisissez une date valide.").nullable());

const checkbox = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

/** Un nom d'hôte, sans protocole ni chemin. Les adresses IP ne sont pas des domaines. */
const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

const domainName = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.string().regex(HOSTNAME, "Saisissez un nom de domaine, par exemple exemple.fr."),
);

const siteFields = {
  projectId: optionalUuid,
  contractId: optionalUuid,
  name: z.string().trim().min(1, "Le nom du site est obligatoire.").max(200),
  primaryDomain: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : (value ?? null)),
    z.union([z.literal("").transform(() => null), z.null(), domainName]),
  ),
  kind: z.preprocess(emptyToNull, z.enum(SITE_KINDS).nullable()),
  technology: optionalText(120),
  cmsKind: z.preprocess(emptyToNull, z.enum(CMS_KINDS).nullable()),
  cmsAdminUrl: optionalHttpUrl,
  repoUrl: optionalHttpUrl,
  repoBranch: optionalText(120),
  hostingLabel: optionalText(120),
  hostedByNuera: checkbox,
  serverLabel: optionalText(120),
  ownerMemberId: optionalUuid,
  liveOn: optionalDay,
  coolifyProjectUuid: optionalText(120),
  monitorId: optionalText(120),
};

export const createSiteSchema = z.object({
  companyId: z.uuid("Choisissez un client."),
  ...siteFields,
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

/** Le client ne change pas après la création : les clés composites l'interdisent. */
export const updateSiteSchema = z.object({
  id: z.uuid(),
  ...siteFields,
});
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

export const changeSiteStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(SITE_STATUSES),
});

export const siteIdSchema = z.object({ id: z.uuid() });

export const environmentSchema = z.object({
  siteId: z.uuid(),
  kind: z.enum(ENVIRONMENT_KINDS),
  url: optionalHttpUrl,
  coolifyAppUuid: optionalText(120),
});
export type EnvironmentInput = z.infer<typeof environmentSchema>;

/** Le mot exigé côté serveur : l'interface ne fait que le demander. */
export const PRODUCTION_CONFIRMATION_WORD = "PRODUCTION";
export const SIMPLE_CONFIRMATION = "CONFIRMED";

export const triggerDeploymentSchema = z.object({
  environmentId: z.uuid(),
  confirmation: z.string().optional(),
});

export const domainSchema = z.object({
  companyId: z.uuid("Choisissez un client."),
  siteId: optionalUuid,
  name: domainName,
  registrar: optionalText(120),
  expiresOn: optionalDay,
  autoRenew: checkbox,
});
export type DomainInput = z.infer<typeof domainSchema>;

export const updateDomainSchema = z.object({
  id: z.uuid(),
  siteId: optionalUuid,
  registrar: optionalText(120),
  expiresOn: optionalDay,
  autoRenew: checkbox,
});
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

export const domainIdSchema = z.object({ id: z.uuid() });

/** Une déclaration porte un résultat : « en cours » resterait sans suite, rien ne pourrait le solder. */
export const MANUAL_BACKUP_STATUSES = ["succeeded", "failed"] as const;

export const manualBackupSchema = z.object({
  siteId: z.uuid(),
  environmentId: optionalUuid,
  status: z.enum(MANUAL_BACKUP_STATUSES),
  takenAt: z.iso.datetime({ offset: true, error: "Saisissez une date et une heure valides." }),
  sizeBytes: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(0, "La taille ne peut pas être négative.").nullable(),
  ),
  offSite: checkbox,
});
export type ManualBackupInput = z.infer<typeof manualBackupSchema>;

export const SITE_LIST_FILTERS = ["live", "staging", "hosted", "archived"] as const;
export type SiteListFilter = (typeof SITE_LIST_FILTERS)[number];

export const SITE_SORTS = ["name", "client", "status", "live", "expiry"] as const;
export type SiteSort = (typeof SITE_SORTS)[number];

/** Filtres de l'URL : une valeur trafiquée est ignorée, ce n'est pas une erreur. */
export const siteListQuerySchema = z.object({
  search: z.string().trim().max(200).optional().catch(undefined),
  filter: z.enum(SITE_LIST_FILTERS).optional().catch(undefined),
  companyId: z.uuid().optional().catch(undefined),
  cmsKind: z.enum(CMS_KINDS).optional().catch(undefined),
  environmentStatus: z.enum(ENVIRONMENT_STATUSES).optional().catch(undefined),
  sort: z.enum(SITE_SORTS).optional().catch(undefined),
  direction: z.enum(["asc", "desc"]).optional().catch(undefined),
});
export type SiteListQuery = z.infer<typeof siteListQuerySchema>;

export const domainListQuerySchema = z.object({
  search: z.string().trim().max(200).optional().catch(undefined),
  filter: z.enum(["expiring", "tls"]).optional().catch(undefined),
});
export type DomainListQuery = z.infer<typeof domainListQuerySchema>;

export const syncServiceSchema = z.object({ service: z.enum(["coolify", "uptime_kuma"]) });
