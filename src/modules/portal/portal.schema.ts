import { z } from "@/lib/zod";

const uuid = z.uuid("Identifiant invalide.");

export const inviteClientSchema = z.object({ companyId: uuid, contactId: uuid });
export type InviteClientInput = z.input<typeof inviteClientSchema>;

export const membershipIdSchema = z.object({ membershipId: uuid });
export type MembershipIdInput = z.input<typeof membershipIdSchema>;

const flag = z.boolean().default(false);

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Indiquez votre nom.").max(200, "Ce nom est trop long."),
  notifyMessage: flag,
  notifyValidation: flag,
  notifyInvoice: flag,
  notifyRequirement: flag,
  notifyReport: flag,
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

/** Conseils d'une ligne du portail : une clé par page. Toute autre clé est refusée. */
export const PORTAL_TIP_KEYS = ["messages", "documents", "mon-site", "demandes"] as const;
export type PortalTipKey = (typeof PORTAL_TIP_KEYS)[number];

export const dismissTipSchema = z.object({ tip: z.enum(PORTAL_TIP_KEYS, "Conseil inconnu.") });
export type DismissTipInput = z.input<typeof dismissTipSchema>;

export const requirementTextSchema = z.object({
  requirementId: uuid,
  text: z
    .string()
    .trim()
    .min(1, "Écrivez ce que vous souhaitez nous transmettre.")
    .max(8000, "Ce texte est trop long."),
});
export type RequirementTextInput = z.input<typeof requirementTextSchema>;

export const olderMessagesSchema = z.object({ at: z.coerce.date(), id: uuid });

export const siteChangeSchema = z.object({
  siteId: uuid,
  current: z
    .string()
    .trim()
    .min(3, "Indiquez ce que vous voulez changer.")
    .max(2000, "Ce texte est trop long."),
  next: z
    .string()
    .trim()
    .min(1, "Écrivez votre nouvelle version.")
    .max(4000, "Ce texte est trop long."),
});
export type SiteChangeInput = z.input<typeof siteChangeSchema>;
