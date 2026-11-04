import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "accent" | "success" | "warn" | "danger" | "neutral" | "chatgpt";

const TONES: Record<BadgeTone, string> = {
  accent: "bg-accent-pale text-accent",
  success: "bg-success-pale text-success",
  warn: "bg-warn-pale text-warn",
  danger: "bg-danger-pale text-danger",
  neutral: "bg-surface-raised text-muted",
  chatgpt: "bg-chatgpt-pale text-chatgpt",
};

/** Badge (Figma 57:124) : pilule, Outfit 500 12, `padding 4 8`. Compatible serveur. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-1 text-badge whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Statuts du contrat de domaine (domain-model §3, §4), libellés et tons (figma-map §3). */
const STATUSES = {
  opportunity: {
    new: ["Nouveau", "neutral"],
    qualified: ["Qualifié", "accent"],
    quote_sent: ["Devis envoyé", "warn"],
    negotiation: ["Négociation", "warn"],
    won: ["Gagné", "success"],
    lost: ["Perdu", "danger"],
  },
  company: {
    prospect: ["Prospect", "neutral"],
    client: ["Client", "success"],
    subscriber: ["Abonné", "accent"],
    former: ["Ancien", "neutral"],
    partner: ["Partenaire", "accent"],
  },
  quote: {
    draft: ["Brouillon", "neutral"],
    sent: ["Envoyé", "accent"],
    negotiation: ["Négociation", "warn"],
    accepted: ["Signé", "success"],
    refused: ["Refusé", "danger"],
    expired: ["Expiré", "warn"],
  },
  signature: {
    none: ["Non demandée", "neutral"],
    pending: ["En attente", "warn"],
    signed: ["Signé", "success"],
    declined: ["Refusé", "danger"],
    unavailable: ["Indisponible", "warn"],
  },
  project: {
    preparation: ["En préparation", "neutral"],
    active: ["En cours", "accent"],
    blocked: ["Bloqué", "warn"],
    in_validation: ["En validation", "warn"],
    delivered: ["Livré", "success"],
    closed: ["Clôturé", "neutral"],
  },
  phase: {
    todo: ["À venir", "neutral"],
    in_progress: ["En cours", "accent"],
    done: ["Fait", "success"],
  },
  task: {
    todo: ["À faire", "neutral"],
    in_progress: ["En cours", "accent"],
    blocked: ["Bloquée", "warn"],
    done: ["Faite", "success"],
  },
  deliverable: {
    draft: ["Brouillon", "neutral"],
    to_validate: ["À valider", "warn"],
    validated: ["Validé", "success"],
    changes_requested: ["À revoir", "warn"],
  },
  requirement: {
    expected: ["Attendu", "warn"],
    received: ["Reçu", "success"],
  },
  site: {
    planned: ["Prévu", "neutral"],
    staging: ["Préprod", "warn"],
    live: ["En ligne", "success"],
    paused: ["En pause", "neutral"],
    archived: ["Archivé", "neutral"],
  },
  environment: {
    running: ["Opérationnel", "success"],
    stopped: ["Arrêté", "neutral"],
    error: ["En erreur", "danger"],
    unknown: ["Inconnu", "neutral"],
  },
  deployment: {
    queued: ["En attente", "neutral"],
    running: ["En cours", "accent"],
    succeeded: ["Réussi", "success"],
    failed: ["Échec", "danger"],
    cancelled: ["Annulé", "danger"],
  },
  contract: {
    to_start: ["À démarrer", "neutral"],
    active: ["Actif", "success"],
    to_review: ["À revoir", "warn"],
    suspended: ["Suspendu", "warn"],
    terminated: ["Résilié", "danger"],
    expired: ["Expiré", "danger"],
  },
  ticket: {
    received: ["Reçue", "accent"],
    qualified: ["Qualifiée", "accent"],
    in_progress: ["En cours", "warn"],
    resolved: ["Résolue", "success"],
    closed: ["Clôturée", "neutral"],
  },
  severity: {
    low: ["Gravité faible", "neutral"],
    medium: ["Gravité moyenne", "warn"],
    high: ["Gravité haute", "danger"],
    critical: ["Critique", "danger"],
  },
  coverage: {
    undetermined: ["À déterminer", "neutral"],
    covered: ["Couvert", "success"],
    not_covered: ["Non couvert", "warn"],
    overage: ["Hors forfait", "warn"],
  },
  invoice: {
    issued: ["Envoyée", "accent"],
    overdue: ["En retard", "danger"],
    paid: ["Payée", "success"],
    cancelled: ["Annulée", "neutral"],
  },
  schedule: {
    planned: ["Prévue", "neutral"],
    invoiced: ["Facturée", "accent"],
    paid: ["Payée", "success"],
  },
  document: {
    internal: ["Interne", "neutral"],
    client: ["Partagé client", "accent"],
  },
  integration: {
    connected: ["Connecté", "success"],
    degraded: ["Dégradé", "warn"],
    unavailable: ["Indisponible", "danger"],
    not_configured: ["À configurer", "warn"],
    to_verify: ["À vérifier", "warn"],
  },
  automation: {
    running: ["En cours", "accent"],
    succeeded: ["Réussi", "success"],
    failed: ["Échec", "danger"],
    skipped: ["Ignoré", "neutral"],
  },
  portal: {
    invited: ["Invité", "accent"],
    active: ["Actif", "success"],
    revoked: ["Révoqué", "neutral"],
  },
} as const satisfies Record<string, Record<string, readonly [string, BadgeTone]>>;

export type StatusKind = keyof typeof STATUSES;

/**
 * Point unique status → libellé + ton. La casse du statut est indifférente (`WON`, `won`).
 * Un statut inconnu reste affiché tel quel, en Neutre : rien ne disparaît en silence.
 */
export function statusBadge(kind: StatusKind, status: string): { label: string; tone: BadgeTone } {
  const entries: Record<string, readonly [string, BadgeTone]> = STATUSES[kind];
  const match = entries[status.toLowerCase()];
  return match ? { label: match[0], tone: match[1] } : { label: status, tone: "neutral" };
}

/** Ton seul d'un statut, pour une jauge ou un point coloré. */
export function statusTone(kind: StatusKind, status: string): BadgeTone {
  return statusBadge(kind, status).tone;
}

export function StatusBadge({
  kind,
  status,
  children,
  className,
}: {
  kind: StatusKind;
  status: string;
  /** Remplace le libellé par défaut (`En retard · 2 j`), le ton reste celui du statut. */
  children?: ReactNode;
  className?: string;
}) {
  const { label, tone } = statusBadge(kind, status);
  return (
    <Badge tone={tone} className={className}>
      {children ?? label}
    </Badge>
  );
}
