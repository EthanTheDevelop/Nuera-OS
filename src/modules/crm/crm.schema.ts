import { normalizeDomain } from "@/integrations/twenty/twenty.mappers";
import { ACTIVITY_KINDS, COMPANY_STATUSES, CONTACT_ROLES } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { toE164Phone } from "./crm.shared";

/**
 * Validation du CRM. Un champ absent reste inchangé (`undefined`), un champ vidé vaut `null` :
 * même convention que le port CRM. Les formulaires envoient du texte, les appels internes aussi.
 */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

export const optionalId = () =>
  z
    .union([z.guid(), z.literal("")])
    .nullish()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

export const optionalDay = () =>
  z
    .union([z.iso.date("Format attendu : AAAA-MM-JJ."), z.literal("")])
    .nullish()
    .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const optionalDomain = z
  .string()
  .trim()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return undefined;
    if (value === "") return null;
    const domain = normalizeDomain(value);
    if (!DOMAIN.test(domain)) {
      context.addIssue({
        code: "custom",
        message: "Saisissez un domaine valide, par exemple nuera.studio.",
      });
      return z.NEVER;
    }
    return domain;
  });

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return undefined;
    if (value === "") return null;
    const phone = toE164Phone(value);
    if (!phone) {
      context.addIssue({
        code: "custom",
        message: "Numéro invalide : format attendu 06 12 34 56 78 ou +33612345678.",
      });
      return z.NEVER;
    }
    return phone;
  });

const optionalSiren = z
  .string()
  .trim()
  .optional()
  .transform((value, context) => {
    if (value === undefined) return undefined;
    const compact = value.replace(/\s/g, "");
    if (compact === "") return null;
    if (!/^\d{9}$/.test(compact)) {
      context.addIssue({ code: "custom", message: "Un SIREN compte 9 chiffres." });
      return z.NEVER;
    }
    return compact;
  });

const tagsInput = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const list = Array.isArray(value) ? value : value.split(",");
    return [...new Set(list.map((tag) => tag.trim()).filter(Boolean))];
  });

export const checkbox = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")])
  .optional()
  .transform((value) =>
    value === undefined ? undefined : value === true || value === "on" || value === "true",
  );

const companyFields = {
  domain: optionalDomain,
  addressLine: optionalText(300),
  city: optionalText(120),
  postalCode: optionalText(20),
  country: optionalText(120),
  status: z.enum(COMPANY_STATUSES).optional(),
  activity: optionalText(200),
  siren: optionalSiren,
  phone: optionalPhone,
  source: optionalText(120),
  tags: tagsInput,
  ownerMemberId: optionalId(),
  notes: optionalText(5000),
};

export const createCompanySchema = z.object({
  /** Identifiant fourni par l'appelant : une création se rejoue sans doublon. */
  id: z.guid().optional(),
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(200),
  /** Homonyme confirmé par l'utilisateur. Domaine et SIREN restent uniques. */
  allowSameName: checkbox,
  ...companyFields,
});
export type CreateCompanyInput = z.output<typeof createCompanySchema>;

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(200).optional(),
  ...companyFields,
});
export type UpdateCompanyInput = z.output<typeof updateCompanySchema>;

export const companyListFiltersSchema = z.object({
  statut: z
    .enum([...COMPANY_STATUSES, "archived"])
    .optional()
    .catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  origine: z.string().trim().max(120).optional().catch(undefined),
  responsable: z.guid().optional().catch(undefined),
  tag: z.string().trim().max(120).optional().catch(undefined),
  tri: z.enum(["client", "montant", "origine"]).optional().catch(undefined),
  sens: z.enum(["asc", "desc"]).optional().catch(undefined),
});
export type CompanyListFilters = z.output<typeof companyListFiltersSchema>;

export const mergeSchema = z
  .object({ winnerId: z.guid(), loserId: z.guid() })
  .refine((value) => value.winnerId !== value.loserId, {
    message: "Choisissez deux fiches différentes.",
  });

const optionalEmail = z
  .union([z.email("Adresse e-mail invalide.").trim().toLowerCase(), z.literal("")])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "" ? null : value));

const contactRoles = z.array(z.enum(CONTACT_ROLES)).optional();

const contactFields = {
  companyId: optionalId(),
  email: optionalEmail,
  phone: optionalPhone,
  jobTitle: optionalText(200),
  roles: contactRoles,
  isPrimary: checkbox,
  notes: optionalText(5000),
};

const personName = z.string().trim().max(120);

export const createContactSchema = z
  .object({
    id: z.guid().optional(),
    firstName: personName.default(""),
    lastName: personName.default(""),
    ...contactFields,
  })
  .refine((value) => value.firstName !== "" || value.lastName !== "", {
    message: "Indiquez au moins un prénom ou un nom.",
    path: ["lastName"],
  });
export type CreateContactInput = z.output<typeof createContactSchema>;

export const updateContactSchema = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
  ...contactFields,
});
export type UpdateContactInput = z.output<typeof updateContactSchema>;

export const contactDirectoryFiltersSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  role: z.enum(CONTACT_ROLES).optional().catch(undefined),
  archives: z.literal("1").optional().catch(undefined),
});
export type ContactDirectoryFilters = z.output<typeof contactDirectoryFiltersSchema>;

export const createActivitySchema = z
  .object({
    id: z.guid().optional(),
    kind: z.enum(ACTIVITY_KINDS),
    subject: z.string().trim().min(1, "L'objet est obligatoire.").max(300),
    body: optionalText(10_000),
    companyId: optionalId(),
    contactId: optionalId(),
    opportunityId: optionalId(),
    ownerMemberId: optionalId(),
    /** Échéance d'une tâche : la prochaine action et sa date. */
    dueOn: optionalDay(),
    /** Jour de l'échange consigné. Aujourd'hui par défaut. */
    occurredOn: optionalDay(),
  })
  .refine((value) => value.companyId || value.contactId || value.opportunityId, {
    message: "Une activité doit être liée à un client, un contact ou une affaire.",
  });
export type CreateActivityInput = z.output<typeof createActivitySchema>;

export const updateActivitySchema = z.object({
  subject: z.string().trim().min(1, "L'objet est obligatoire.").max(300).optional(),
  body: optionalText(10_000),
  ownerMemberId: optionalId(),
  dueOn: optionalDay(),
});
export type UpdateActivityInput = z.output<typeof updateActivitySchema>;

export const importPreviewSchema = z.object({
  csv: z
    .string()
    .min(1, "Le fichier est vide.")
    .max(1_000_000, "Fichier trop lourd : 1 Mo au maximum, découpez-le."),
});

export const importBatchSchema = z.object({
  importId: z.guid(),
  csv: importPreviewSchema.shape.csv,
  /** Numéros de ligne du fichier à traiter dans ce lot. */
  lines: z.array(z.number().int().positive()).min(1).max(25),
});
