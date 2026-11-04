import type {
  BillingPeriod,
  ContractEventKind,
  ContractKind,
  ContractStatus,
  SignatureStatus,
  SiteStatus,
  TicketCoverage,
  TicketStatus,
} from "@/lib/domain-enums";
import type { Paginated } from "@/server/pagination";

/** Formes d'échange entre services et interface : aucune dépendance vers le schéma de la base. */
export interface ContractListRow {
  id: string;
  number: string;
  name: string;
  kind: ContractKind;
  status: ContractStatus;
  companyId: string;
  companyName: string;
  planName: string | null;
  priceCents: number;
  period: BillingPeriod;
  startOn: string | null;
  renewsOn: string | null;
  endOn: string | null;
  autoRenew: boolean;
  /** Prochaine échéance : renouvellement, sinon fin. */
  nextDueOn: string | null;
  /** Contrat à démarrer dont un site rattaché n'est pas encore en ligne. */
  awaitsGoLive: boolean;
}

export type ContractListPage = Paginated<ContractListRow>;

export interface ContractDetail extends ContractListRow {
  planId: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  /** NULL sans `finance:read` ou `team:read_costs` : le coût n'est pas visible. */
  monthlyCostCents: number | null;
  includedMinutes: number | null;
  includedTickets: number | null;
  scope: string | null;
  exclusions: string | null;
  conditions: string | null;
  responseHours: number | null;
  resolutionHours: number | null;
  signatureStatus: SignatureStatus;
  docusealSubmissionId: string | null;
  terminatedAt: Date | null;
  terminationNote: string | null;
  createdAt: Date;
}

export interface ContractConsumption {
  /** Bornes de la période de quota, incluses. */
  periodStart: string;
  periodEnd: string;
  includedMinutes: number | null;
  consumedMinutes: number;
  includedTickets: number | null;
  consumedTickets: number;
}

export interface QuotaRow extends ContractConsumption {
  contractId: string;
  companyName: string;
  contractName: string;
  kind: ContractKind;
  period: BillingPeriod;
  /** Le plus consommé des deux quotas ; NULL si aucun n'est mesurable. */
  percent: number | null;
}

export interface ContractEventRow {
  id: string;
  kind: ContractEventKind;
  fromPriceCents: number | null;
  toPriceCents: number | null;
  note: string | null;
  actorName: string | null;
  at: Date;
}

export interface ContractSiteRow {
  siteId: string;
  name: string;
  primaryDomain: string | null;
  status: SiteStatus;
  hostingLabel: string | null;
  serverLabel: string | null;
  /** Faux si le rattachement vient de la fiche du site : c'est là qu'il se retire. */
  removable: boolean;
}

export interface ContractTicketRow {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  coverage: TicketCoverage;
}

export interface QuoteOption {
  id: string;
  companyId: string;
  number: string;
  title: string | null;
}

export interface SiteOption {
  id: string;
  name: string;
  primaryDomain: string | null;
}

export interface InterventionRow {
  id: string;
  contractId: string;
  companyName: string;
  title: string;
  siteId: string | null;
  siteName: string | null;
  ticketId: string | null;
  ticketNumber: string | null;
  memberId: string | null;
  memberName: string | null;
  plannedOn: string | null;
  doneOn: string | null;
  result: string | null;
  minutes: number | null;
  /** Prévue puis annulée à la résiliation du contrat. */
  cancelled: boolean;
}

export interface RenewalRow {
  contractId: string;
  companyName: string;
  contractName: string;
  kind: ContractKind;
  status: ContractStatus;
  dueOn: string;
  autoRenew: boolean;
  conditions: string | null;
}

export interface PriceReviewRow {
  contractId: string;
  companyName: string;
  kind: ContractKind;
  priceCents: number;
  period: BillingPeriod;
  /** Dernier changement de prix + 12 mois ; à défaut le début du contrat + 12 mois. */
  reviewOn: string;
  status: ContractStatus;
}

export interface DomainDeadlineRow {
  name: string;
  expiresOn: string;
  companyName: string;
}

export interface TerminationImpact {
  /** Les sites rattachés ; sans rattachement, le contrat vaut pour tous ceux du client. */
  sites: ContractSiteRow[];
  domains: { name: string; expiresOn: string | null; autoRenew: boolean }[];
  plannedInterventions: number;
  openTickets: number;
  /** NULL sans `finance:read`. */
  recurringCosts: { label: string; amountCents: number; period: string | null }[] | null;
  plannedScheduleItems: number | null;
}

export interface MaintenancePlanRow {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  period: BillingPeriod;
  includedMinutes: number | null;
  includedTickets: number | null;
  scope: string | null;
  exclusions: string | null;
  responseHours: number | null;
  resolutionHours: number | null;
  active: boolean;
  /** Contrats encore ouverts sur cette formule. */
  contractCount: number;
}

export interface RecurringRevenue {
  /** Jour de calcul, à Paris. */
  on: string;
  mrrCents: number;
  /** Douze fois le MRR : « 16 776 € sur 12 mois ». */
  arrCents: number;
  activeCount: number;
  byKind: Record<ContractKind, { count: number; mrrCents: number }>;
}

export interface ContractsSummary {
  today: string;
  activeCount: number;
  activeByKind: Record<ContractKind, number>;
  mrrCents: number;
  arrCents: number;
  /** Échéances dans les 30 jours (ou dépassées) des contrats en vigueur. */
  dueForRenewalCount: number;
  nextDue: RenewalRow | null;
  toStartCount: number;
  toReviewCount: number;
  /** Moyenne des consommations de la période ; NULL sans quota mesurable. */
  averageQuotaPercent: number | null;
}

/** Ligne compacte de la fiche client 360°. */
export interface CompanyContractRow {
  id: string;
  number: string;
  name: string;
  kind: ContractKind;
  status: ContractStatus;
  priceCents: number;
  period: BillingPeriod;
  nextDueOn: string | null;
  planName: string | null;
  includedMinutes: number | null;
  consumedMinutes: number;
  includedTickets: number | null;
  consumedTickets: number;
}

/** Contrat vu du portail client : ni coût, ni note interne. */
export interface PortalContractRow {
  id: string;
  number: string;
  name: string;
  kind: ContractKind;
  status: ContractStatus;
  priceCents: number;
  period: BillingPeriod;
  nextDueOn: string | null;
  scope: string | null;
  exclusions: string | null;
  responseHours: number | null;
  resolutionHours: number | null;
  sites: { siteId: string; name: string; primaryDomain: string | null }[];
  consumption: ContractConsumption;
}
