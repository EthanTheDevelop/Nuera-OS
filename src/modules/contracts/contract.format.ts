import { CONTRACT_KIND_LABELS, type BillingPeriod, type ContractKind } from "@/lib/domain-enums";
import { formatDateShort, formatDays, formatMinutes, MINUTES_PER_DAY } from "@/lib/format";
import { formatCents } from "@/lib/money";

/** Libellés d'affichage de l'écran 20. Sans dépendance serveur. */
const PERIOD_LABELS: Record<BillingPeriod, string> = {
  monthly: "mensuel",
  quarterly: "trimestriel",
  yearly: "annuel",
};

const PER_PERIOD: Record<BillingPeriod, string> = {
  monthly: "mois",
  quarterly: "trimestre",
  yearly: "an",
};

const KIND_NOUNS: Record<ContractKind, string> = {
  hosting: "d'hébergement",
  maintenance: "de maintenance",
  support: "de support",
  accompaniment: "d'accompagnement",
};

const KIND_PLURALS: Record<ContractKind, [string, string]> = {
  hosting: ["hébergement", "hébergements"],
  maintenance: ["maintenance", "maintenances"],
  support: ["support", "supports"],
  accompaniment: ["accompagnement", "accompagnements"],
};

export function periodLabel(period: BillingPeriod): string {
  return PERIOD_LABELS[period];
}

export function perPeriodLabel(period: BillingPeriod): string {
  return PER_PERIOD[period];
}

/** Le nom du contrat sans le nom du client, déjà affiché à côté. S'il ne reste rien : son type. */
export function contractTypeLabel(name: string, companyName: string, kind: ContractKind): string {
  const rest = name.replace(companyName, "").trim();
  return rest || CONTRACT_KIND_LABELS[kind];
}

/** « 49 € / mois ». */
export function formatPricePerPeriod(priceCents: number, period: BillingPeriod): string {
  return `${formatCents(priceCents)} / ${PER_PERIOD[period]}`;
}

/** « 1er déc. », avec l'année si elle n'est pas celle de `today`. */
export function formatDeadline(day: string, today: string): string {
  const short = formatDateShort(day).replace(/^1\s/, "1er ");
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
}

/** « 2 hébergements · 1 accompagnement » ; les types absents ne s'affichent pas. */
export function describeKinds(counts: Record<ContractKind, number>): string {
  return (Object.keys(KIND_PLURALS) as ContractKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${KIND_PLURALS[kind][counts[kind] > 1 ? 1 : 0]}`)
    .join(" · ");
}

/** Unité choisie d'après le quota : en journées à partir d'une journée, en minutes en dessous. */
export function formatQuotaMinutes(consumed: number, included: number): string {
  if (included >= MINUTES_PER_DAY) {
    const value = formatDays(consumed).replace(/\s*j$/, "");
    return `${value} / ${formatDays(included)}`;
  }
  return `${consumed} / ${included} min`;
}

/** « 2 j/mois d'accompagnement », « 1 h/mois de maintenance ». */
export function describeQuota(
  includedMinutes: number | null,
  includedTickets: number | null,
  kind: ContractKind,
  period: BillingPeriod,
): string {
  if (includedMinutes !== null && includedMinutes > 0) {
    const amount =
      includedMinutes >= MINUTES_PER_DAY
        ? formatDays(includedMinutes)
        : formatMinutes(includedMinutes);
    return `${amount}/${PER_PERIOD[period]} ${KIND_NOUNS[kind]}`;
  }
  return `${includedTickets ?? 0} demande(s)/${PER_PERIOD[period]} ${KIND_NOUNS[kind]}`;
}
