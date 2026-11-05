import { NAVIGATION, visibleNavigation } from "@/config/navigation";
import { getUptimeKumaGateway } from "@/integrations/uptime-kuma";
import { OPPORTUNITY_STAGE_LABELS } from "@/lib/domain-enums";
import {
  formatDateShort,
  formatMinutes,
  formatNumber,
  formatRelativeDate,
  formatTime,
  MINUTES_PER_DAY,
} from "@/lib/format";
import { centsToEuros, formatCents, formatCentsHT, formatCentsSigned } from "@/lib/money";
import { listUpcomingAppointments } from "@/modules/appointments/appointment.service";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  getContractsSummary,
  getRecurringRevenue,
  listContractsDueForRenewal,
} from "@/modules/contracts/contract.service";
import { daysBetween, lastMonths, monthOf, parisDay } from "@/modules/finance/finance.dates";
import {
  getFinanceSummary,
  getRecurringOverview,
  listOverdueInvoices,
  type FinanceSummary,
} from "@/modules/finance/finance.service";
import { getMessagesToHandle } from "@/modules/messaging/message.service";
import { getNotificationCenter } from "@/modules/platform/notifications.service";
import { getAutomationsSummary } from "@/modules/platform/automation.service";
import { listProjects, getProjectsOverview } from "@/modules/projects/project.service";
import { listOverdueTasks } from "@/modules/projects/task.service";
import { listQuotes, listQuotesDueForReminder } from "@/modules/quotes/quote.service";
import { getPipelineSummary } from "@/modules/sales/opportunity.service";
import { getSitesHealthSummary } from "@/modules/sites/site.service";
import { getSupportSummary, listTicketsNearingDue } from "@/modules/support/ticket.service";
import { getCapacityOverview, getSixWeekLoad } from "@/modules/time/capacity.service";
import { assertCan, can, canAny, type Actor } from "@/server/auth/permissions";
import type { ServiceContext } from "@/server/context";
import { ServiceUnavailableError, ValidationError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";
import * as repository from "./dashboard.repository";
import { dashboardLayoutSchema } from "./dashboard.schema";
import {
  TILE_CATALOG,
  tileDefinition,
  type DashboardLayout,
  type LayoutTile,
  type TileDefinition,
  type TileKey,
} from "./dashboard.tiles";
import type { DashboardData, TileGaugeView, TileRow, TileState, TileView } from "./dashboard.types";
import {
  getPeriodMargin,
  getRevenueSixMonths,
  getSalesPerformance,
  getRevenueByBucket,
} from "./metrics.service";
import { capitalize, deltaPercent } from "./reporting.periods";

// --- Accès et disposition ------------------------------------------------------------------------

export function canSeeTile(actor: Pick<Actor, "role">, definition: TileDefinition): boolean {
  return definition.permissions.every((permission) => can(actor, permission));
}

function visibleTiles(actor: Actor): TileDefinition[] {
  return TILE_CATALOG.filter((definition) => canSeeTile(actor, definition));
}

function defaultLayout(actor: Actor): DashboardLayout {
  return {
    tiles: visibleTiles(actor)
      .filter((definition) => definition.onDefaultBoard)
      .map(({ key, size }) => ({ key, size })),
  };
}

/** Une disposition enregistrée peut dater d'un autre rôle : ce qui n'est plus permis disparaît. */
function readStoredLayout(actor: Actor, stored: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(stored);
  if (!parsed.success) return defaultLayout(actor);
  return {
    tiles: parsed.data.tiles.filter(({ key }) => canSeeTile(actor, tileDefinition(key))),
  };
}

export async function getDashboardLayout(ctx: ServiceContext): Promise<DashboardLayout> {
  assertCan(ctx.actor, "dashboard:read");
  const preferences = await repository.findPreferences(ctx.db, ctx.actor.userId);
  return preferences?.dashboardLayout
    ? readStoredLayout(ctx.actor, preferences.dashboardLayout)
    : defaultLayout(ctx.actor);
}

/** Enregistre la disposition de ce compte. Rejouer la même disposition n'écrit rien. */
export async function saveDashboardLayout(
  ctx: ServiceContext,
  input: unknown,
): Promise<DashboardLayout> {
  assertCan(ctx.actor, "dashboard:read");
  const layout = parseInput(dashboardLayoutSchema, input);
  for (const { key } of layout.tiles) {
    if (!canSeeTile(ctx.actor, tileDefinition(key))) {
      throw new ValidationError("Cette tuile n'est pas accessible à votre rôle.");
    }
  }
  return ctx.db.transaction(async (tx) => {
    const preferences = await repository.findPreferences(tx, ctx.actor.userId);
    if (JSON.stringify(preferences?.dashboardLayout ?? null) === JSON.stringify(layout)) {
      return layout;
    }
    await repository.upsertDashboardLayout(tx, ctx.actor.userId, layout);
    await recordAudit(tx, {
      actorId: ctx.actor.userId,
      action: "user_preference.updated",
      entityType: "user_preference",
      entityId: ctx.actor.userId,
      metadata: { field: "dashboard_layout", tiles: layout.tiles.length },
    });
    return layout;
  });
}

// --- Page d'accueil ------------------------------------------------------------------------------

/** Chemin interne, jamais une adresse externe ni l'espace client. */
export function isSafeHomePath(path: string | null | undefined): path is string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  return !path.startsWith("/espace") && !path.startsWith("/api");
}

function canOpenPath(actor: Actor, path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? path;
  const match = NAVIGATION.flatMap((section) => section.items)
    .filter(
      (item) =>
        pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.permissions ? canAny(actor, match.permissions) : true;
}

/** Arrivée sur l'application : adresse saisie, favori ou sortie de la connexion, pas un clic interne. */
export function isEntryNavigation(referer: string | null): boolean {
  if (!referer) return true;
  try {
    return new URL(referer).pathname.startsWith("/login");
  } catch {
    return true;
  }
}

/**
 * Où mène « / ». Un compte sans tableau de bord part toujours vers une page qu'il peut ouvrir ; les
 * autres vont sur leur page d'accueil à l'arrivée, et restent libres de revenir au tableau de bord.
 */
export async function resolveHomeRedirect(
  ctx: ServiceContext,
  options: { referer: string | null },
): Promise<string | null> {
  const preferences = await repository.findPreferences(ctx.db, ctx.actor.userId);
  const home = preferences?.homePath;
  const usable = isSafeHomePath(home) && home !== "/" && canOpenPath(ctx.actor, home) ? home : null;
  if (!can(ctx.actor, "dashboard:read")) {
    if (usable) return usable;
    const first = visibleNavigation((permissions) => canAny(ctx.actor, permissions))
      .flatMap((section) => section.items)
      .find((item) => item.href !== "/");
    return first?.href ?? "/profil";
  }
  return usable && isEntryNavigation(options.referer) ? usable : null;
}

// --- Sources partagées d'une lecture ---------------------------------------------------------------

/** Une source lue par plusieurs tuiles n'est demandée qu'une fois par affichage. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= load());
}

interface Sources {
  ctx: ServiceContext;
  now: Date;
  today: string;
  finance: () => Promise<FinanceSummary>;
  health: () => ReturnType<typeof getSitesHealthSummary>;
  support: () => ReturnType<typeof getSupportSummary>;
  contracts: () => ReturnType<typeof getContractsSummary>;
}

function buildSources(ctx: ServiceContext, now: Date): Sources {
  const today = parisDay(now);
  return {
    ctx,
    now,
    today,
    finance: once(() => getFinanceSummary(ctx.db, monthOf(today), now)),
    health: once(() => getSitesHealthSummary(ctx.db, now)),
    support: once(() => getSupportSummary(ctx.db, now)),
    contracts: once(() => getContractsSummary(ctx.db, { now })),
  };
}

const plural = (count: number, one: string, many = `${one}s`) => (count > 1 ? many : one);
const days = (minutes: number) => formatNumber(minutes / MINUTES_PER_DAY, 1);
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("fr-FR"))
    .join("");
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const WEEKDAY_TIME = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  timeZone: "Europe/Paris",
});

/** `MAR 10:00`, à l'heure de Paris. */
function dateChip(at: Date): string {
  const weekday = WEEKDAY_TIME.format(at).replace(".", "").toLocaleUpperCase("fr-FR");
  return `${weekday} ${formatTime(at)}`;
}

function messageMoment(at: Date | null, now: Date): string | undefined {
  if (!at) return undefined;
  if (parisDay(at) === parisDay(now)) return formatTime(at);
  return capitalize(formatRelativeDate(at, now));
}

function appointmentLabel(item: {
  title: string;
  contactName: string | null;
  companyName: string | null;
}): string {
  const person = item.contactName ? firstNameOf(item.contactName) : null;
  if (person && item.companyName) return `${person} · ${item.companyName}`;
  return person ?? item.companyName ?? item.title;
}

/** Le badge d'une tuile ne doit pas la faire tomber : une configuration illisible vaut « à connecter ». */
function isMonitoringConfigured(): boolean {
  try {
    return getUptimeKumaGateway().isConfigured;
  } catch {
    return false;
  }
}

const PROJECT_RISK_KINDS = new Set(["late", "blocked", "waiting_content"]);
const STALE_AFTER_MS = 24 * 3_600_000;
const CONTRACT_KIND_NOTE: Record<string, [string, string]> = {
  accompaniment: ["accompagnement", "accompagnements"],
  hosting: ["hébergement", "hébergements"],
  maintenance: ["maintenance", "maintenances"],
  support: ["support", "supports"],
};
const UPCOMING_WINDOW_DAYS = 7;
const PRIORITY_LIMIT = 8;

/** Lectures indépendantes d'une tuile composée : ce qui échoue n'efface pas ce qui répond. */
async function settle<T>(reads: readonly Promise<T[]>[]): Promise<{ items: T[]; failed: boolean }> {
  const results = await Promise.allSettled(reads);
  const items = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failed = results.some((result) => result.status === "rejected");
  for (const result of results) {
    if (result.status === "rejected")
      logger.error("dashboard.source_failed", { error: result.reason });
  }
  return { items, failed };
}

const SOURCE_FAILED_NOTE = "Une source n’a pas répondu : cette liste peut être incomplète.";

// --- Tuiles ------------------------------------------------------------------------------------

const LOADERS: Record<TileKey, (sources: Sources) => Promise<TileView>> = {
  async revenue({ ctx, today }) {
    const months = await getRevenueSixMonths(ctx.db, today);
    const current = months[months.length - 1];
    const previous = months[months.length - 2];
    const total = current?.point.totalCents ?? 0;
    const delta = deltaPercent(total, previous?.point.totalCents ?? 0);
    const previousName = previous ? (previous.month.longLabel.split(" ")[0] ?? "") : "";
    const rows: TileRow[] = [
      { id: "projects", label: "Projets", value: formatCents(current?.point.projectCents ?? 0) },
      {
        id: "recurring",
        label: "Récurrent",
        value: formatCents(current?.point.recurringCents ?? 0),
      },
      ...months
        .slice(0, -1)
        .reverse()
        .map(({ month, point }) => ({
          id: month.key,
          label: capitalize(month.longLabel.split(" ")[0] ?? month.longLabel),
          value: formatCents(point.totalCents),
        })),
    ];
    const hasRevenue = months.some(({ point }) => point.totalCents !== 0);
    return {
      figure: { kind: "euros", value: centsToEuros(total), suffix: " HT" },
      note: `${capitalize(current?.month.longLabel ?? "")} · encaissé et à encaisser`,
      badge:
        delta === null
          ? undefined
          : {
              label: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} % vs ${previousName}`,
              tone: delta >= 0 ? "success" : "danger",
            },
      rows,
      chart: {
        points: months.map(({ month }, index) => {
          const before = months[index - 1]?.point.totalCents;
          const change =
            before === undefined ? null : (months[index]?.point.totalCents ?? 0) - before;
          return {
            label: capitalize(month.label),
            tooltipLabel: month.longLabel.toLocaleUpperCase("fr-FR"),
            note: change === null ? undefined : `${formatCentsSigned(change)} vs mois précédent`,
            noteTone: change === null ? undefined : change >= 0 ? "success" : "danger",
          };
        }),
        projects: months.map(({ point }) => centsToEuros(point.projectCents)),
        recurring: months.map(({ point }) => centsToEuros(point.recurringCents)),
      },
      empty: hasRevenue
        ? undefined
        : {
            title: "Aucune facture référencée",
            description: "Importez le fichier Indy ou saisissez une référence de facture.",
            actionHref: "/finances/imports",
            actionLabel: "Importer des factures",
          },
    };
  },

  async pipeline({ ctx }) {
    const columns = await getPipelineSummary(ctx);
    const open = columns.filter(({ stage }) => stage !== "WON" && stage !== "LOST");
    const openCount = open.reduce((total, column) => total + column.total, 0);
    const openAmount = open.reduce((total, column) => total + column.amountCents, 0);
    const largest = Math.max(1, ...columns.map((column) => column.total));
    return {
      figure: { kind: "number", value: openCount },
      note: `${plural(openCount, "affaire ouverte", "affaires ouvertes")} · ${formatCents(openAmount)}`,
      badge: { label: `${openCount} ${plural(openCount, "affaire")}`, tone: "accent" },
      rowStyle: "gauge",
      rowsOnlyAt: ["2x2", "4x2"],
      rows: columns.map((column) => {
        const tone: TileGaugeView["tone"] =
          column.stage === "WON" ? "success" : column.stage === "LOST" ? "danger" : "accent";
        return {
          id: column.stage,
          label: OPPORTUNITY_STAGE_LABELS[column.stage],
          value: column.amountCents > 0 ? formatCents(column.amountCents) : undefined,
          detail: String(column.total),
          href: `/pipeline?etape=${column.stage}`,
          gauge: {
            percent: (column.total / largest) * 100,
            tone,
            valueText: `${column.total} ${plural(column.total, "affaire")}`,
          },
        };
      }),
      empty: columns.every((column) => column.total === 0)
        ? {
            title: "Aucune affaire pour l’instant",
            description: "Les affaires de Twenty et celles créées ici apparaîtront par étape.",
            ...(can(ctx.actor, "sales:create")
              ? { actionHref: "/pipeline?nouvelle=NEW", actionLabel: "Créer une affaire" }
              : {}),
          }
        : undefined,
    };
  },

  async load({ ctx, today }) {
    const overview = await getCapacityOverview(ctx.db, monthOf(today), { today });
    const percent = overview.loadPercent === null ? null : Math.round(overview.loadPercent);
    const members = overview.members.filter(
      (member) => member.capacityMinutes > 0 || member.plannedMinutes > 0,
    );
    const free = Math.max(0, overview.capacityMinutes - overview.plannedMinutes);
    return {
      figure: {
        kind: "text",
        text: `${days(overview.plannedMinutes)} / ${days(overview.capacityMinutes)}`,
      },
      unit: "journées prévues",
      loadPercent: percent ?? undefined,
      gauge:
        percent === null
          ? undefined
          : { percent, scale: "load", valueText: `${percent} % de la capacité du mois` },
      note:
        members
          .map(
            (member) =>
              `${firstNameOf(member.fullName)} ${days(member.plannedMinutes)} / ${days(member.capacityMinutes)}`,
          )
          .join(" · ") || undefined,
      rows: [
        ...members.map((member) => ({
          id: member.memberId,
          label: firstNameOf(member.fullName),
          value: `${days(member.plannedMinutes)} / ${days(member.capacityMinutes)}`,
        })),
        { id: "free", label: "Libres", value: `${days(free)} j` },
      ],
      rowsFrom2x2: true,
      empty:
        overview.capacityMinutes === 0
          ? {
              title: "Aucune capacité renseignée",
              description: "Indiquez la capacité hebdomadaire de chaque personne de l’équipe.",
              actionHref: "/equipe",
              actionLabel: "Ouvrir l’équipe",
            }
          : undefined,
    };
  },

  async mrr({ ctx, now, today }) {
    const [revenue, before] = await Promise.all([
      getRecurringRevenue(ctx.db, { at: now }),
      getRecurringRevenue(ctx.db, {
        at: new Date(`${lastMonths(today, 2)[0]?.range.to}T21:00:00Z`),
      }),
    ]);
    const kinds = Object.entries(revenue.byKind).filter(([, entry]) => entry.count > 0);
    const change = revenue.mrrCents - before.mrrCents;
    return {
      figure: { kind: "euros", value: centsToEuros(revenue.mrrCents) },
      note:
        kinds
          .map(([kind, entry]) => {
            const [one, many] = CONTRACT_KIND_NOTE[kind] ?? [kind, kind];
            return `${entry.count} ${plural(entry.count, one, many)}`;
          })
          .join(" + ") || "Aucun contrat en vigueur",
      badge:
        change === 0
          ? undefined
          : { label: formatCentsSigned(change), tone: change > 0 ? "success" : "danger" },
      rows: [
        ...kinds.map(([kind, entry]) => ({
          id: kind,
          label: capitalize(CONTRACT_KIND_NOTE[kind]?.[0] ?? kind),
          value: formatCents(entry.mrrCents),
        })),
        { id: "active", label: "Contrats", value: String(revenue.activeCount) },
        { id: "arr", label: "Sur 12 mois", value: formatCents(revenue.arrCents) },
      ],
    };
  },

  async collected({ finance }) {
    const summary = await finance();
    return {
      figure: { kind: "euros", value: centsToEuros(summary.collectedCents) },
      note:
        summary.outstandingCents > 0
          ? `${formatCents(summary.outstandingCents)} en attente`
          : "Rien en attente",
      noteTone: summary.outstandingCents > 0 ? "warn" : "muted",
      rows: [
        { id: "outstanding", label: "En attente", value: formatCents(summary.outstandingCents) },
        { id: "overdue", label: "En retard", value: formatCents(summary.overdueCents) },
        { id: "documents", label: "Factures payées", value: String(summary.collectedDocuments) },
      ],
    };
  },

  async overdue({ ctx, now, today }) {
    const tasks = await listOverdueTasks(ctx.db, now);
    const projects = new Set(tasks.map((task) => task.projectId));
    const first = tasks[0];
    return {
      figure: {
        kind: "text",
        text: `${projects.size} ${plural(projects.size, "projet")}`,
      },
      note: first ? `${first.title} · ${first.projectNumber}` : "Aucune tâche en retard",
      noteTone: first ? "danger" : "muted",
      rows: tasks.slice(0, 8).map((task) => ({
        id: task.id,
        label: task.title,
        detail: task.projectNumber,
        value: `${daysBetween(task.dueOn, today)} j`,
        tone: "danger",
        href: `/projets/${task.projectId}`,
      })),
    };
  },

  async shared_costs({ ctx }) {
    const [recurring, partners] = await Promise.all([
      getRecurringOverview(ctx),
      repository.countActivePartners(ctx.db),
    ]);
    const agency = recurring.lines.filter((line) => line.companyName === null);
    const total = agency.reduce((sum, line) => sum + (line.monthlyCents ?? 0), 0);
    const share = partners > 0 ? Math.round(total / partners) : null;
    return {
      title: partners === 2 ? "Frais 50/50" : undefined,
      figure: { kind: "euros", value: centsToEuros(total) },
      note:
        share === null
          ? "par mois · aucun associé actif"
          : `par mois · ${formatCents(share)} chacun`,
      rows: agency.map((line) => ({
        id: line.id,
        label: line.label,
        value: line.monthlyCents === null ? "à chiffrer" : formatCents(line.monthlyCents),
        tone: line.monthlyCents === null ? "warn" : undefined,
      })),
    };
  },

  async messages({ ctx, now }) {
    const items = await getMessagesToHandle(ctx.db, { limit: 100 });
    const ready = items.filter((item) => item.hasReadySuggestion).length;
    return {
      figure: { kind: "number", value: items.length },
      note: `${plural(items.length, "message")} à traiter`,
      badge: ready > 0 ? { label: "ChatGPT", tone: "chatgpt" } : undefined,
      rowStyle: "avatar",
      rowsOnlyAt: ["2x2", "4x2"],
      rows: items.slice(0, 8).map((item) => {
        const name = item.contactName ?? item.companyName;
        const context = item.contactName
          ? (item.companyActivity ?? item.companyName)
          : item.companyActivity;
        return {
          id: item.conversationId,
          label: context ? `${firstNameOf(name)} · ${context}` : name,
          detail: item.excerpt ?? undefined,
          value: messageMoment(item.at, now),
          initials: initialsOf(name),
          suggestion: item.hasReadySuggestion,
          href: item.href,
        };
      }),
      empty:
        items.length === 0
          ? {
              title: "Aucun message à traiter",
              description: "Les messages reçus sans réponse s’afficheront ici.",
            }
          : undefined,
    };
  },

  async appointments({ ctx }) {
    const items = await listUpcomingAppointments(ctx.db, { limit: 20 });
    const next = items[0];
    return {
      figure: { kind: "number", value: items.length },
      note: next ? `Prochain : ${dateChip(next.startsAt)}` : "Aucun rendez-vous à venir",
      badge: items.some((item) => item.source === "cal")
        ? { label: "Cal.diy", tone: "neutral" }
        : undefined,
      rowStyle: "date",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: items.map((item) => ({
        id: item.id,
        label: appointmentLabel(item),
        detail: `${item.kind ?? item.title} · ${formatMinutes(item.durationMinutes)}`,
        dateChip: dateChip(item.startsAt),
        href: "/messages/rendez-vous",
      })),
      empty:
        items.length === 0
          ? {
              title: "Aucun rendez-vous à venir",
              ...(can(ctx.actor, "messages:send")
                ? { actionHref: "/messages/rendez-vous", actionLabel: "Planifier un rendez-vous" }
                : {}),
            }
          : undefined,
    };
  },

  async sites({ health, now }) {
    const summary = await health();
    const configured = isMonitoringConfigured();
    const stale =
      summary.lastCheckedAt && now.getTime() - summary.lastCheckedAt.getTime() > STALE_AFTER_MS
        ? formatRelativeDate(summary.lastCheckedAt, now)
        : undefined;
    return {
      figure: { kind: "text", text: `${summary.up} / ${summary.live}` },
      note:
        summary.down > 0
          ? `${summary.down} hors ligne`
          : summary.unverified > 0
            ? `en ligne · ${summary.unverified} sans mesure récente`
            : "en ligne",
      noteTone: summary.down > 0 ? "danger" : summary.unverified > 0 ? "warn" : "muted",
      badge: configured
        ? { label: "Uptime Kuma", tone: "success" }
        : { label: "Uptime Kuma à connecter", tone: "warn" },
      stale,
      rowStyle: "dot",
      rowsOnlyAt: ["2x1"],
      rows: summary.rows.map((row) => ({
        id: row.id,
        label: row.primaryDomain ?? row.name,
        value:
          row.uptimeRatio === null ? "non mesuré" : `${formatNumber(row.uptimeRatio * 100, 2)} %`,
        dot: row.check === "up" ? "success" : row.check === "down" ? "danger" : "neutral",
        href: `/sites/${row.id}`,
      })),
      empty:
        summary.live === 0
          ? {
              title: "Aucun site en ligne",
              description: "Les sites en production et leur disponibilité s’afficheront ici.",
              actionHref: "/sites",
              actionLabel: "Ouvrir les sites",
            }
          : undefined,
    };
  },

  async quotes({ ctx, today }) {
    const page = await listQuotes(ctx, { filter: "envoyes", pageSize: 20 });
    const items = [...page.items].sort(
      (a, b) => (a.sentAt?.getTime() ?? 0) - (b.sentAt?.getTime() ?? 0),
    );
    return {
      figure: { kind: "number", value: page.total },
      note: "devis à signer",
      badge: page.total > 0 ? { label: String(page.total), tone: "warn" } : undefined,
      rowStyle: "badge",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: items.map((quote) => {
        const elapsed = quote.sentAt ? daysBetween(parisDay(quote.sentAt), today) : null;
        return {
          id: quote.id,
          label: `${quote.companyName} · ${quote.title}`,
          detail: formatCentsHT(quote.totalCents),
          href: `/devis/${quote.id}`,
          badge:
            elapsed === null
              ? undefined
              : elapsed >= 3
                ? { label: `Relance J+${elapsed}`, tone: "warn" as const }
                : {
                    label:
                      elapsed === 0
                        ? "Envoyé aujourd’hui"
                        : elapsed === 1
                          ? "Envoyé hier"
                          : `Envoyé il y a ${elapsed} j`,
                    tone: "neutral" as const,
                  },
        };
      }),
      empty:
        page.total === 0
          ? {
              title: "Aucun devis à signer",
              description: "Les devis envoyés attendent ici leur signature.",
              actionHref: "/devis",
              actionLabel: "Ouvrir les devis",
            }
          : undefined,
    };
  },

  async support({ support }) {
    const summary = await support();
    const toQualify = summary.counts.received + summary.counts.qualified;
    return {
      figure: { kind: "number", value: summary.open },
      note:
        summary.open === 0
          ? "Aucune demande ouverte"
          : `${toQualify} à qualifier · ${summary.counts.in_progress} en cours`,
      noteTone: summary.critical > 0 ? "danger" : "muted",
      rows: [
        {
          id: "critical",
          label: "Critiques",
          value: String(summary.critical),
          tone: summary.critical > 0 ? "danger" : undefined,
        },
        {
          id: "overdue",
          label: "Hors délai",
          value: String(summary.overdue),
          tone: summary.overdue > 0 ? "danger" : undefined,
        },
        { id: "unassigned", label: "Sans responsable", value: String(summary.unassigned) },
        { id: "closed", label: "Clôturées ce mois", value: String(summary.closedThisMonth) },
      ],
    };
  },

  async priorities({ ctx, now, today }) {
    const { actor, db } = ctx;
    const horizon = { from: today, to: addDaysTo(today, UPCOMING_WINDOW_DAYS) };
    const reads: Promise<TileRow[]>[] = [];
    if (can(actor, "tasks:read")) {
      reads.push(
        listOverdueTasks(db, now).then((tasks) =>
          tasks.slice(0, PRIORITY_LIMIT).map((task) => ({
            id: `task-${task.id}`,
            label: task.title,
            detail: `Tâche · ${task.projectNumber}`,
            href: `/projets/${task.projectId}`,
            badge: {
              label: `En retard · ${daysBetween(task.dueOn, today)} j`,
              tone: "danger" as const,
            },
          })),
        ),
      );
    }
    if (can(actor, "support:read")) {
      reads.push(
        listTicketsNearingDue(db, now, { limit: PRIORITY_LIMIT }).then((tickets) =>
          tickets.map((ticket) => ({
            id: `ticket-${ticket.id}`,
            label: ticket.subject,
            detail: `Demande · ${ticket.number}`,
            href: `/support/${ticket.id}`,
            badge: { label: "À traiter vite", tone: "warn" as const },
          })),
        ),
      );
    }
    if (can(actor, "quotes:read")) {
      reads.push(
        listQuotesDueForReminder(db, now).then((quotes) =>
          quotes.slice(0, PRIORITY_LIMIT).map((quote) => ({
            id: `quote-${quote.id}`,
            label: `Relancer ${quote.number}`,
            detail: "Devis envoyé sans réponse",
            href: `/devis/${quote.id}`,
            badge: { label: "Relance", tone: "warn" as const },
          })),
        ),
      );
    }
    if (can(actor, "sales:read")) {
      reads.push(
        repository.listDueNextActions(db, today, PRIORITY_LIMIT).then((rows) =>
          rows.map((row) => ({
            id: `opportunity-${row.id}`,
            label: row.nextAction ?? row.name,
            detail: `Affaire · ${row.companyName ?? row.name}`,
            href: `/pipeline/${row.id}`,
            badge: { label: formatDateShort(row.nextActionOn), tone: "accent" as const },
          })),
        ),
      );
    }
    if (can(actor, "projects:read")) {
      reads.push(
        repository.listDeliverablesToValidate(db, PRIORITY_LIMIT).then((rows) =>
          rows.map((row) => ({
            id: `deliverable-${row.id}`,
            label: row.title,
            detail: `À valider · ${row.projectName}`,
            href: `/projets/${row.projectId}`,
            badge: { label: "Validation", tone: "accent" as const },
          })),
        ),
      );
    }
    if (can(actor, "contracts:read")) {
      reads.push(
        repository.listUpcomingInterventions(db, horizon, PRIORITY_LIMIT).then((rows) =>
          rows.map((row) => ({
            id: `intervention-${row.id}`,
            label: row.title,
            detail: `Intervention · ${row.companyName}`,
            href: `/contrats/${row.contractId}`,
            badge: { label: formatDateShort(row.plannedOn), tone: "neutral" as const },
          })),
        ),
      );
    }
    const { items, failed } = await settle(reads);
    return {
      figure: { kind: "number", value: items.length },
      note: `${plural(items.length, "action")} à mener`,
      rowStyle: "badge",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: items,
      partial: failed ? SOURCE_FAILED_NOTE : undefined,
      empty:
        items.length === 0 && !failed
          ? {
              title: "Rien d’urgent aujourd’hui",
              description: "Retards, relances et validations s’afficheront ici.",
            }
          : undefined,
    };
  },

  async alerts(sources) {
    const { ctx, now, today, health, support } = sources;
    const { actor, db } = ctx;
    const reads: Promise<TileRow[]>[] = [];
    if (can(actor, "sites:read")) {
      reads.push(
        health().then((summary) =>
          summary.rows
            .filter((row) => row.check === "down")
            .map((row) => ({
              id: `site-${row.id}`,
              label: `${row.primaryDomain ?? row.name} hors ligne`,
              detail: "Incident site",
              href: `/sites/${row.id}`,
              badge: { label: "Incident", tone: "danger" as const },
            })),
        ),
      );
    }
    if (can(actor, "support:read")) {
      reads.push(
        support().then((summary) =>
          summary.critical > 0
            ? [
                {
                  id: "tickets-critical",
                  label: `${summary.critical} ${plural(summary.critical, "demande critique", "demandes critiques")}`,
                  detail: "Support",
                  href: "/support",
                  badge: { label: "Critique", tone: "danger" as const },
                },
              ]
            : [],
        ),
      );
    }
    if (can(actor, "projects:read")) {
      reads.push(
        listProjects(ctx, { view: "late", pageSize: 5 }, { now }).then((page) =>
          page.items.map((project) => ({
            id: `project-${project.id}`,
            label: project.name,
            detail: `Projet · ${project.companyName}`,
            href: `/projets/${project.id}`,
            badge: { label: project.health.label, tone: project.health.tone },
          })),
        ),
      );
    }
    if (can(actor, "finance:read")) {
      reads.push(
        listOverdueInvoices(db, now).then((rows) =>
          rows.slice(0, 5).map((row) => ({
            id: `invoice-${row.id}`,
            label: `${row.companyName} · ${formatCents(row.amountCents)}`,
            detail: `Impayé · ${row.externalRef ?? "sans référence"}`,
            href: `/finances/factures/${row.id}`,
            badge: { label: `Échue le ${formatDateShort(row.dueOn)}`, tone: "danger" as const },
          })),
        ),
      );
    }
    if (can(actor, "contracts:read")) {
      reads.push(
        listContractsDueForRenewal(db, now, { limit: 5 }).then((rows) =>
          rows.map((row) => ({
            id: `contract-${row.contractId}`,
            label: `${row.companyName} · ${row.contractName}`,
            detail: "Échéance de contrat",
            href: `/contrats/${row.contractId}`,
            badge: {
              label: formatDateShort(row.dueOn),
              tone: row.dueOn < today ? ("danger" as const) : ("warn" as const),
            },
          })),
        ),
      );
    }
    const { items, failed } = await settle(reads);
    return {
      figure: { kind: "number", value: items.length },
      note: `${plural(items.length, "alerte")} en cours`,
      noteTone: items.length > 0 ? "danger" : "muted",
      rowStyle: "badge",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: items,
      partial: failed ? SOURCE_FAILED_NOTE : undefined,
      empty:
        items.length === 0 && !failed
          ? {
              title: "Aucune alerte",
              description: "Retards, incidents, impayés et échéances de contrat s’afficheront ici.",
            }
          : undefined,
    };
  },

  async overview({ ctx, now, health, support, contracts }) {
    const { actor, db } = ctx;
    const reads: Promise<TileRow[]>[] = [];
    if (can(actor, "crm:read")) {
      reads.push(
        repository.countCompaniesByStatus(db).then((counts) => [
          {
            id: "clients",
            label: "Clients actifs",
            value: String((counts.get("client") ?? 0) + (counts.get("subscriber") ?? 0)),
            href: "/clients",
          },
          {
            id: "prospects",
            label: "Prospects",
            value: String(counts.get("prospect") ?? 0),
            href: "/clients",
          },
        ]),
      );
    }
    if (can(actor, "projects:read")) {
      reads.push(
        getProjectsOverview(ctx, { now }).then((overview) => [
          {
            id: "projects",
            label: "Projets en cours",
            value: String(overview.open),
            href: "/projets",
          },
        ]),
      );
    }
    if (can(actor, "contracts:read")) {
      reads.push(
        contracts().then((summary) => [
          {
            id: "contracts",
            label: "Contrats actifs",
            value: String(summary.activeCount),
            href: "/contrats",
          },
        ]),
      );
    }
    if (can(actor, "support:read")) {
      reads.push(
        support().then((summary) => [
          {
            id: "tickets",
            label: "Demandes ouvertes",
            value: String(summary.open),
            href: "/support",
          },
        ]),
      );
    }
    if (can(actor, "sites:read")) {
      reads.push(
        health().then((summary) => [
          { id: "sites", label: "Sites en ligne", value: String(summary.live), href: "/sites" },
        ]),
      );
    }
    const { items, failed } = await settle(reads);
    const first = items[0];
    return {
      figure: { kind: "text", text: first?.value ?? "—" },
      note: first?.label,
      rowStyle: "plain",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: items,
      partial: failed ? SOURCE_FAILED_NOTE : undefined,
    };
  },

  async late_projects({ ctx, now }) {
    const page = await listProjects(ctx, { view: "late", pageSize: 8 }, { now });
    const first = page.items[0];
    return {
      figure: { kind: "text", text: `${page.total} ${plural(page.total, "projet")}` },
      note: first ? `${first.name} · ${first.health.label}` : "Aucun projet en retard",
      noteTone: first ? "danger" : "muted",
      rowStyle: "badge",
      rows: page.items.map((project) => ({
        id: project.id,
        label: project.name,
        detail: project.companyName,
        href: `/projets/${project.id}`,
        badge: { label: project.health.label, tone: project.health.tone },
      })),
    };
  },

  async time_vs_quote({ ctx }) {
    const data = await repository.listTimeAgainstEstimate(ctx.db, 8);
    const percent =
      data.estimatedMinutes > 0
        ? Math.round((data.spentMinutes / data.estimatedMinutes) * 100)
        : null;
    return {
      figure: {
        kind: "text",
        text: `${formatMinutes(data.spentMinutes)} / ${formatMinutes(data.estimatedMinutes)}`,
      },
      note: `sur ${data.projects} ${plural(data.projects, "projet ouvert", "projets ouverts")}`,
      badge:
        percent === null
          ? undefined
          : {
              label: `${percent} %`,
              tone: percent > 100 ? "danger" : percent >= 80 ? "warn" : "accent",
            },
      rowStyle: "gauge",
      rows: data.items.map((row) => {
        const share = Math.round((row.spentMinutes / row.estimatedMinutes) * 100);
        return {
          id: row.id,
          label: row.name,
          detail: `${share} %`,
          href: `/projets/${row.id}`,
          gauge: {
            percent: Math.min(100, share),
            scale: "budget" as const,
            scaleValue: share,
            valueText: `${formatMinutes(row.spentMinutes)} sur ${formatMinutes(row.estimatedMinutes)}`,
          },
        };
      }),
      empty:
        data.projects === 0
          ? {
              title: "Aucun projet estimé en cours",
              description: "Le temps passé se compare ici au temps vendu au devis.",
            }
          : undefined,
    };
  },

  async subscriptions({ ctx, now, contracts }) {
    const [summary, renewals] = await Promise.all([
      contracts(),
      listContractsDueForRenewal(ctx.db, now, { limit: 8 }),
    ]);
    return {
      figure: { kind: "number", value: summary.activeCount },
      note:
        summary.dueForRenewalCount > 0
          ? `${summary.dueForRenewalCount} ${plural(summary.dueForRenewalCount, "échéance")} sous 30 jours`
          : "Aucune échéance sous 30 jours",
      noteTone: summary.dueForRenewalCount > 0 ? "warn" : "muted",
      rowStyle: "plain",
      rows: renewals.map((row) => ({
        id: row.contractId,
        label: `${row.companyName} · ${row.contractName}`,
        value: formatDateShort(row.dueOn),
        href: `/contrats/${row.contractId}`,
      })),
      empty:
        summary.activeCount === 0
          ? {
              title: "Aucun abonnement en vigueur",
              actionHref: "/contrats",
              actionLabel: "Ouvrir les contrats",
            }
          : undefined,
    };
  },

  async missing_content({ ctx, today }) {
    const data = await repository.listExpectedRequirements(ctx.db, today, 8);
    return {
      figure: { kind: "number", value: data.total },
      note:
        data.late > 0
          ? `dont ${data.late} en retard`
          : `${plural(data.total, "contenu attendu", "contenus attendus")}`,
      noteTone: data.late > 0 ? "danger" : "muted",
      rowStyle: "plain",
      rows: data.items.map((row) => ({
        id: row.id,
        label: row.label,
        detail: row.projectName,
        value: row.dueOn ? formatDateShort(row.dueOn) : undefined,
        tone: row.dueOn && row.dueOn < today ? "danger" : undefined,
        href: `/projets/${row.projectId}`,
      })),
      empty:
        data.total === 0
          ? {
              title: "Aucun contenu attendu",
              description: "Les contenus demandés aux clients s’afficheront ici.",
            }
          : undefined,
    };
  },

  async invoices({ ctx, now, finance }) {
    const [summary, overdue] = await Promise.all([finance(), listOverdueInvoices(ctx.db, now)]);
    return {
      figure: { kind: "number", value: summary.overdueCount },
      note:
        summary.overdueCount > 0
          ? `${plural(summary.overdueCount, "facture échue", "factures échues")} · ${formatCents(summary.overdueCents)}`
          : "Aucune facture échue",
      noteTone: summary.overdueCount > 0 ? "danger" : "muted",
      badge: { label: "API à vérifier", tone: "warn" },
      rowStyle: "plain",
      rows: [
        ...overdue.slice(0, 6).map((row) => ({
          id: row.id,
          label: row.companyName,
          detail: row.externalRef ?? "Sans référence",
          value: formatCents(row.amountCents),
          tone: "danger" as const,
          href: `/finances/factures/${row.id}`,
        })),
        {
          id: "import",
          label: "Dernier import",
          value: summary.lastImportAt ? formatRelativeDate(summary.lastImportAt, now) : "aucun",
          href: "/finances/imports",
        },
      ],
      empty:
        summary.documentCount === 0
          ? {
              title: "Aucune facture référencée",
              description: "Importez le fichier Indy pour suivre les factures ici.",
              actionHref: "/finances/imports",
              actionLabel: "Importer des factures",
            }
          : undefined,
    };
  },

  async automations({ ctx, now }) {
    const summary = await getAutomationsSummary(ctx.db, now);
    return {
      figure: { kind: "text", text: `${summary.rulesEnabled} / ${summary.rulesTotal}` },
      note: `${plural(summary.rulesEnabled, "règle active", "règles actives")} · ${summary.runsThisMonth} ${plural(summary.runsThisMonth, "exécution")} ce mois`,
      badge:
        summary.failed > 0
          ? { label: `${summary.failed} ${plural(summary.failed, "échec")}`, tone: "danger" }
          : undefined,
      rowStyle: "plain",
      rows: summary.lastRuns.map((run, index) => ({
        id: `${run.ruleName}-${index}`,
        label: run.ruleName,
        value: formatRelativeDate(run.at, now),
        tone: run.status === "failed" ? "danger" : undefined,
      })),
    };
  },

  async treasury({ finance }) {
    const summary = await finance();
    return {
      figure: { kind: "euros", value: centsToEuros(summary.collectedCents) },
      note: "encaissés ce mois · factures connues, pas un solde bancaire",
      rowStyle: "plain",
      rows: [
        { id: "outstanding", label: "À encaisser", value: formatCents(summary.outstandingCents) },
        {
          id: "overdue",
          label: "En retard",
          value: formatCents(summary.overdueCents),
          tone: summary.overdueCents > 0 ? "danger" : undefined,
        },
        {
          id: "planned",
          label: "Échéances à facturer",
          value: formatCents(summary.plannedScheduleCents),
        },
      ],
    };
  },

  async monthly_report({ ctx, now, today }) {
    const month = lastMonths(today, 2)[0];
    if (!month) throw new Error("Mois précédent introuvable.");
    const [revenue, margin, sales, recurring] = await Promise.all([
      getRevenueByBucket(ctx.db, [{ key: month.key, range: month.range }]),
      getPeriodMargin(ctx.db, month.range, now),
      getSalesPerformance(ctx.db, month.range),
      getRecurringRevenue(ctx.db, { at: new Date(`${month.range.to}T21:00:00Z`) }),
    ]);
    const total = revenue[0]?.totalCents ?? 0;
    return {
      figure: { kind: "euros", value: centsToEuros(total), suffix: " HT" },
      note: capitalize(month.longLabel),
      rowStyle: "plain",
      rowsOnlyAt: [],
      rows: [
        {
          id: "recurring",
          label: "Revenus récurrents",
          value: `${formatCents(recurring.mrrCents)}/mois`,
        },
        {
          id: "margin",
          label: "Marge réelle",
          value: margin.percent === null ? "non calculable" : `${formatNumber(margin.percent)} %`,
        },
        { id: "won", label: "Affaires gagnées", value: String(sales.won) },
        { id: "lost", label: "Affaires perdues", value: String(sales.lost) },
        {
          id: "conversion",
          label: "Conversion",
          value: sales.conversionPercent === null ? "—" : `${sales.conversionPercent} %`,
        },
      ],
    };
  },

  async projects_progress({ ctx, now }) {
    const page = await listProjects(ctx, { view: "active", pageSize: 8 }, { now });
    return {
      figure: { kind: "number", value: page.total },
      note: `${plural(page.total, "projet")} en cours`,
      rowStyle: "gauge",
      rowsOnlyAt: ["2x2", "4x2"],
      rows: page.items.map((project) => ({
        id: project.id,
        label: project.name,
        value: project.dueOn ? formatDateShort(project.dueOn) : undefined,
        detail: `${project.progress.percent} %`,
        href: `/projets/${project.id}`,
        gauge: {
          percent: project.progress.percent,
          tone: project.health.tone === "danger" ? ("danger" as const) : ("accent" as const),
          valueText: `${project.progress.percent} % réalisé`,
        },
      })),
      empty:
        page.total === 0
          ? {
              title: "Aucun projet en cours",
              actionHref: "/projets",
              actionLabel: "Ouvrir les projets",
            }
          : undefined,
    };
  },

  async projects_risk({ ctx, now }) {
    const [page, time] = await Promise.all([
      listProjects(ctx, { view: "active", pageSize: 100 }, { now }),
      repository.listTimeAgainstEstimate(ctx.db, 100),
    ]);
    const overrun = new Map(
      time.items
        .filter((row) => row.spentMinutes > row.estimatedMinutes)
        .map((row) => [row.id, Math.round((row.spentMinutes / row.estimatedMinutes) * 100)]),
    );
    const atRisk = page.items.filter(
      (project) => PROJECT_RISK_KINDS.has(project.health.kind) || overrun.has(project.id),
    );
    return {
      figure: { kind: "number", value: atRisk.length },
      note: `${plural(atRisk.length, "projet")} à reprendre en main`,
      noteTone: atRisk.length > 0 ? "warn" : "muted",
      rowStyle: "badge",
      rowsOnlyAt: ["2x1", "2x2", "4x2"],
      rows: atRisk.map((project) => ({
        id: project.id,
        label: project.name,
        detail: project.companyName,
        href: `/projets/${project.id}`,
        badge: PROJECT_RISK_KINDS.has(project.health.kind)
          ? { label: project.health.label, tone: project.health.tone }
          : { label: `Charge ${overrun.get(project.id)} %`, tone: "danger" as const },
      })),
      empty:
        atRisk.length === 0
          ? {
              title: "Aucun projet à risque",
              description: "Retards, blocages et dépassements de charge s’afficheront ici.",
            }
          : undefined,
    };
  },

  async weekly_load({ ctx, today }) {
    const weeks = await getSixWeekLoad(ctx.db, { today });
    const measured = weeks.filter((week) => week.loadPercent !== null);
    const peak = measured.reduce<(typeof weeks)[number] | null>(
      (best, week) => ((week.loadPercent ?? 0) > (best?.loadPercent ?? -1) ? week : best),
      null,
    );
    return {
      figure: {
        kind: "text",
        text: peak?.loadPercent == null ? "—" : `${Math.round(peak.loadPercent)} %`,
      },
      note: peak ? `Pic de charge en ${peak.label}` : "Aucune capacité renseignée",
      rowStyle: "gauge",
      rowsOnlyAt: ["2x2", "4x2"],
      rows: weeks.map((week) => {
        const percent = week.loadPercent === null ? null : Math.round(week.loadPercent);
        return {
          id: week.weekKey,
          label: week.label,
          detail: percent === null ? "—" : `${percent} %`,
          gauge: {
            percent: Math.min(100, percent ?? 0),
            scale: "load" as const,
            scaleValue: percent ?? 0,
            valueText: percent === null ? "Pas de capacité" : `${percent} % de la capacité`,
          },
        };
      }),
    };
  },
};

function addDaysTo(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

/** Chaque tuile est isolée : son échec reste le sien et le reste du tableau s'affiche. */
async function loadTile(key: TileKey, sources: Sources): Promise<TileState> {
  try {
    return { status: "ready", view: await LOADERS[key](sources) };
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      return { status: "unavailable", service: tileDefinition(key).title, message: error.message };
    }
    logger.error("dashboard.tile_failed", { tile: key, error });
    return { status: "error" };
  }
}

/**
 * Le tableau d'un compte. Seules les tuiles posées sont lues ; en mode édition, celles de la galerie
 * aussi, pour que chaque ajout montre déjà ses vraies données.
 */
export async function getDashboard(
  ctx: ServiceContext,
  options: { editing?: boolean; now?: Date } = {},
): Promise<DashboardData> {
  assertCan(ctx.actor, "dashboard:read");
  const now = options.now ?? new Date();
  const layout = await getDashboardLayout(ctx);
  const onBoard = new Set(layout.tiles.map((tile) => tile.key));
  const gallery: LayoutTile[] = visibleTiles(ctx.actor)
    .filter((definition) => !onBoard.has(definition.key))
    .map(({ key, size }) => ({ key, size }));
  const keys = [...layout.tiles, ...(options.editing ? gallery : [])].map((tile) => tile.key);
  const sources = buildSources(ctx, now);
  const states = await Promise.all(keys.map((key) => loadTile(key, sources)));
  return {
    layout,
    gallery,
    tiles: Object.fromEntries(keys.map((key, index) => [key, states[index]])),
  };
}

/**
 * Cloche de l'en-tête : les dernières notifications de ce compte, et de lui seul. NULL si elles ne se
 * lisent pas : la cloche manque, le tableau de bord reste.
 */
export async function getDashboardNotifications(ctx: ServiceContext) {
  assertCan(ctx.actor, "dashboard:read");
  try {
    return await getNotificationCenter(ctx.db, ctx.actor.userId);
  } catch (error) {
    logger.error("dashboard.notifications_failed", { error });
    return null;
  }
}
