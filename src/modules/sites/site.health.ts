import type { BadgeTone } from "@/components/ui/badge";
import {
  ENVIRONMENT_KIND_LABELS,
  ENVIRONMENT_STATUS_LABELS,
  SITE_STATUS_LABELS,
  type EnvironmentKind,
  type EnvironmentStatus,
  type SiteStatus,
  type TlsStatus,
} from "@/lib/domain-enums";
import { formatDateNumeric, formatRelativeTime } from "@/lib/format";

/**
 * Règles d'affichage d'un état réel, sans dépendance serveur. Une seule idée : **jamais de vert sans
 * mesure récente**. Une donnée absente ou ancienne se lit comme telle.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Âge au-delà duquel un statut d'application est affiché comme périmé. */
export const STATUS_STALE_AFTER_MS = 6 * HOUR_MS;
/** Un échantillon de disponibilité reste valable jusqu'au lendemain. */
export const SAMPLE_STALE_AFTER_MS = 48 * HOUR_MS;
/** Contrôle du certificat. */
export const TLS_STALE_AFTER_MS = 7 * DAY_MS;
/** Domaine ou certificat à anticiper. */
export const EXPIRY_WARNING_DAYS = 30;

/** Une journée sous ce seuil a connu une coupure ; au-dessus de ce temps de réponse, elle est lente. */
export const DOWN_DAY_BELOW_RATIO = 0.995;
export const SLOW_DAY_ABOVE_MS = 1000;

export function isStale(
  checkedAt: Date | string | null | undefined,
  now: Date,
  afterMs: number,
): boolean {
  if (!checkedAt) return true;
  return now.getTime() - new Date(checkedAt).getTime() > afterMs;
}

export interface SiteHealthSignal {
  status: SiteStatus;
  /** Dernier événement de surveillance : `site.down` sans `site.up` depuis. */
  isDown: boolean;
  productionStatus: EnvironmentStatus | null;
  productionCheckedAt: Date | string | null;
  lastSampleAt: Date | string | null;
}

/** Vérification d'un site en ligne : `up` exige une mesure récente et favorable. */
export function liveCheck(signal: SiteHealthSignal, now: Date): "up" | "down" | "unverified" {
  if (signal.isDown) return "down";
  const productionFresh = !isStale(signal.productionCheckedAt, now, STATUS_STALE_AFTER_MS);
  if (productionFresh && signal.productionStatus === "error") return "down";
  if (!isStale(signal.lastSampleAt, now, SAMPLE_STALE_AFTER_MS)) return "up";
  if (productionFresh && signal.productionStatus === "running") return "up";
  return "unverified";
}

const SITE_TONES: Record<SiteStatus, BadgeTone> = {
  planned: "neutral",
  staging: "warn",
  live: "success",
  paused: "neutral",
  archived: "neutral",
};

const ENVIRONMENT_TONES: Record<EnvironmentStatus, BadgeTone> = {
  running: "success",
  stopped: "neutral",
  error: "danger",
  unknown: "neutral",
};

/** Badge d'un site (écran 10). « En ligne » n'est vert que s'il est vérifié. */
export function siteHealthBadge(
  signal: SiteHealthSignal,
  now: Date,
): { label: string; tone: BadgeTone } {
  if (signal.status !== "live") {
    return { label: SITE_STATUS_LABELS[signal.status], tone: SITE_TONES[signal.status] };
  }
  const check = liveCheck(signal, now);
  if (check === "down") return { label: "Hors ligne", tone: "danger" };
  if (check === "up") return { label: "En ligne", tone: "success" };
  return { label: "En ligne · non vérifié", tone: "neutral" };
}

/** Badge d'un environnement (écran 19) : le type se lit toujours, l'état porte sa fraîcheur. */
export function environmentBadge(
  environment: {
    kind: EnvironmentKind;
    status: EnvironmentStatus;
    statusCheckedAt: Date | string | null;
    coolifyAppUuid?: string | null;
  },
  now: Date,
): { label: string; tone: BadgeTone } {
  const kind = ENVIRONMENT_KIND_LABELS[environment.kind];
  if (!environment.statusCheckedAt) return { label: `${kind} · indisponible`, tone: "neutral" };
  const tone = ENVIRONMENT_TONES[environment.status];
  const lowered = ENVIRONMENT_STATUS_LABELS[environment.status].toLocaleLowerCase("fr-FR");
  if (isStale(environment.statusCheckedAt, now, STATUS_STALE_AFTER_MS)) {
    return {
      label: `${kind} · ${lowered} · ${formatRelativeTime(environment.statusCheckedAt, now)}`,
      tone: "neutral",
    };
  }
  return { label: `${kind} · ${lowered}`, tone };
}

/** Badge du certificat. Une vérification ancienne ne reste pas verte. */
export function tlsBadge(
  domain: {
    tlsStatus: TlsStatus;
    tlsExpiresOn: string | null;
    checkedAt: Date | string | null;
  },
  now: Date,
): { label: string; tone: BadgeTone } {
  const until = domain.tlsExpiresOn ? ` · ${formatDateNumeric(domain.tlsExpiresOn)}` : "";
  if (!domain.checkedAt || domain.tlsStatus === "unknown") {
    return { label: "non vérifié", tone: "neutral" };
  }
  if (domain.tlsStatus === "expired") return { label: `expiré${until}`, tone: "danger" };
  // `error` couvre aussi un nom qui ne résout pas : le contrôle a échoué, le certificat n'est pas lu.
  if (domain.tlsStatus === "error") return { label: "contrôle en échec", tone: "danger" };
  if (domain.tlsStatus === "expiring") return { label: `expire bientôt${until}`, tone: "warn" };
  if (isStale(domain.checkedAt, now, TLS_STALE_AFTER_MS)) {
    return {
      label: `valide${until} · vérifié ${formatRelativeTime(domain.checkedAt, now)}`,
      tone: "neutral",
    };
  }
  return { label: `valide${until}`, tone: "success" };
}

/** Jour du calendrier à Paris, `AAAA-MM-JJ` : la journée d'un échantillon de disponibilité. */
export function parisDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export type UptimeDayState = "up" | "slow" | "down" | "unknown";

/** Un jour sans mesure reste `unknown` : il n'est jamais peint en vert. */
export function uptimeDayState(
  sample: { uptimeRatio: number | null; avgResponseMs: number | null } | undefined,
): UptimeDayState {
  if (!sample || sample.uptimeRatio === null) return "unknown";
  if (sample.uptimeRatio < DOWN_DAY_BELOW_RATIO) return "down";
  if (sample.avgResponseMs !== null && sample.avgResponseMs > SLOW_DAY_ABOVE_MS) return "slow";
  return "up";
}

/** « 1 min 12 s », « 45 s ». */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} s`;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

/** « 1,2 Go », « 500 Mo ». */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
  return `${formatted} ${units[unit]}`;
}
