import { OFFER_ACTIVITY_LABELS, type OfferActivity } from "@/lib/domain-enums";

/** Activités du reporting. Fichier pur : l'interface y lit les libellés sans toucher au service. */
export type RevenueActivity = OfferActivity | "support" | "none";

export const REVENUE_ACTIVITY_LABELS: Record<RevenueActivity, string> = {
  vitrine: "Sites vitrines",
  landing: "Landing pages",
  ecommerce: "E-commerce",
  sur_mesure: "Sur mesure",
  audit: "Audits",
  maintenance: OFFER_ACTIVITY_LABELS.maintenance,
  hebergement: OFFER_ACTIVITY_LABELS.hebergement,
  accompagnement: OFFER_ACTIVITY_LABELS.accompagnement,
  support: "Support",
  none: "Non rattaché",
};
