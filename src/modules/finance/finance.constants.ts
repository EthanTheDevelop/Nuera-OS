import type { ImportField } from "@/integrations/indy/indy.csv";

/** Libellés et listes fermées du module, sans dépendance serveur : importables par l'interface. */
export const EXPORT_DATASETS = [
  "factures",
  "echeancier",
  "couts",
  "rentabilite-projets",
  "rentabilite-clients",
  "rentabilite-sites",
  "rentabilite-contrats",
  "rapport-import",
] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** Exports proposés par le bouton « Exporter ». Le rapport d'import se lance depuis l'historique. */
export const EXPORT_MENU: readonly { dataset: ExportDataset; label: string }[] = [
  { dataset: "factures", label: "Factures" },
  { dataset: "echeancier", label: "Échéancier" },
  { dataset: "couts", label: "Coûts directs et récurrents" },
  { dataset: "rentabilite-projets", label: "Rentabilité par projet" },
  { dataset: "rentabilite-clients", label: "Rentabilité par client" },
  { dataset: "rentabilite-sites", label: "Rentabilité par site" },
  { dataset: "rentabilite-contrats", label: "Rentabilité par contrat" },
];

export function exportHref(dataset: ExportDataset, importId?: string): string {
  const query = importId ? `&import=${encodeURIComponent(importId)}` : "";
  return `/api/finance/export?jeu=${dataset}${query}`;
}

/** Le corps d'une Server Action est limité à 1 Mo : au-delà, Next refuse avant le service. */
export const MAX_IMPORT_BYTES = 900_000;
export const IMPORT_TOO_LARGE = "Ce fichier dépasse 900 Ko : découpez-le.";

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  externalRef: "Référence de la facture",
  company: "Client",
  siren: "SIREN ou SIRET",
  amountHt: "Montant HT",
  amountTtc: "Montant TTC",
  tax: "TVA",
  issuedOn: "Date d'émission",
  dueOn: "Date d'échéance",
  status: "État",
  paidOn: "Date de paiement",
  issuer: "Émise par",
  project: "Projet (numéro ou nom)",
  contract: "Contrat (numéro ou nom)",
  kind: "Type (facture, avoir)",
};

export const MARGIN_SCOPE_LABELS = {
  project: "Projets",
  client: "Clients",
  site: "Sites",
  contract: "Contrats",
} as const;

/** Une valeur d'URL : `constructor` n'est pas une portée, même si `in` le laisse croire. */
export function isMarginScope(
  value: string | undefined,
): value is keyof typeof MARGIN_SCOPE_LABELS {
  return value !== undefined && Object.hasOwn(MARGIN_SCOPE_LABELS, value);
}

/** Mention affichée partout où l'on saisit ou importe une facture. */
export const NO_LEGAL_VALUE_NOTICE =
  "Aucune facture créée ici n'a de valeur légale : la facture officielle reste dans Indy. Nuera OS n'en garde que la référence et l'état.";

/** Un projet encore en production n'a pas de coût réel final (écran 21 : « en cours »). */
export function isFinishedProjectStatus(status: string | null): boolean {
  return status === "delivered" || status === "closed";
}
