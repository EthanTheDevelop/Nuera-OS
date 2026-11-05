import { count, desc, eq, inArray } from "drizzle-orm";
import { getCoolifyGateway, type CoolifyGateway } from "@/integrations/coolify";
import { getDocusealGateway, type DocusealGateway } from "@/integrations/docuseal";
import { INDY_CONNECTION_STATUS } from "@/integrations/indy/indy.connection";
import { getN8nGateway, type N8nGateway } from "@/integrations/n8n";
import { getTextGenerator, type TextGenerator } from "@/integrations/openai";
import { getSmtpGateway, type SmtpGateway } from "@/integrations/smtp";
import { getCrmGateway, type CrmGateway } from "@/integrations/twenty";
import { getUptimeKumaGateway, type UptimeKumaGateway } from "@/integrations/uptime-kuma";
import type { IntegrationService, IntegrationStatus } from "@/lib/domain-enums";
import { z } from "@/lib/zod";
import { recordAudit } from "@/modules/audit/audit.service";
import { assertCan } from "@/server/auth/permissions";
import { getEnv } from "@/server/config/env";
import type { ServiceContext } from "@/server/context";
import { integrationConnections, sites, webhookReceipts } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { IntegrationError, isAppError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";
import { parseInput } from "@/server/validation";

/**
 * État réel des connexions (écran 05). L'écran ne fait aucun appel externe : il lit
 * `integration_connections`, recoupé avec la configuration du moment. Une vérification est un vrai
 * appel, à la demande ou par la tâche planifiée, et son résultat est daté.
 */
export interface ConnectionGateways {
  crm: CrmGateway;
  coolify: CoolifyGateway;
  uptimeKuma: UptimeKumaGateway;
  docuseal: DocusealGateway;
  text: TextGenerator;
  smtp: SmtpGateway;
  n8n: N8nGateway;
  calConfigured: boolean;
}

function realGateways(): ConnectionGateways {
  return {
    crm: getCrmGateway(),
    coolify: getCoolifyGateway(),
    uptimeKuma: getUptimeKumaGateway(),
    docuseal: getDocusealGateway(),
    text: getTextGenerator(),
    smtp: getSmtpGateway(),
    n8n: getN8nGateway(),
    calConfigured: Boolean(getEnv().CAL_WEBHOOK_SECRET),
  };
}

/** Sans coût ni effet : la tâche planifiée les vérifie. Ni OpenAI (payant), ni n8n (scénario). */
const AUTOMATIC_CHECKS: readonly IntegrationService[] = [
  "twenty",
  "coolify",
  "uptime_kuma",
  "docuseal",
  "smtp",
];

interface Check {
  configured: (gateways: ConnectionGateways) => boolean;
  ping: (gateways: ConnectionGateways) => Promise<unknown>;
}

const CHECKS: Partial<Record<IntegrationService, Check>> = {
  twenty: { configured: (g) => g.crm.isConfigured, ping: (g) => g.crm.listCompanies({ limit: 1 }) },
  coolify: {
    configured: (g) => g.coolify.isConfigured,
    ping: (g) => g.coolify.listApplications(),
  },
  uptime_kuma: {
    configured: (g) => g.uptimeKuma.isConfigured,
    ping: (g) => g.uptimeKuma.readMonitors(),
  },
  docuseal: {
    configured: (g) => g.docuseal.isConfigured,
    // Aucune lecture neutre dans la passerelle : une fiche absente répond 404 après authentification.
    ping: async (g) => {
      try {
        await g.docuseal.getSubmission("0");
      } catch (error) {
        if (error instanceof IntegrationError && error.status === 404) return;
        throw error;
      }
    },
  },
  openai: {
    configured: (g) => g.text.isConfigured,
    ping: (g) =>
      g.text.generate({ instructions: "Réponds OK.", input: "Test.", maxOutputTokens: 16 }),
  },
  smtp: { configured: (g) => g.smtp.isConfigured, ping: (g) => g.smtp.verify() },
  n8n: {
    configured: (g) => g.n8n.isConfigured,
    ping: (g) =>
      g.n8n.send({
        id: crypto.randomUUID(),
        type: "nuera.ping",
        entityType: "connection",
        entityId: "n8n",
        companyId: null,
        occurredAt: new Date().toISOString(),
        payload: {},
      }),
  },
};

/** Ordre de l'écran 05 ; SMTP s'ajoute, puisque les e-mails en dépendent. */
export const TOOL_SERVICES = [
  "twenty",
  "payload",
  "docuseal",
  "indy",
  "uptime_kuma",
  "n8n",
  "cal",
  "coolify",
  "smtp",
] as const satisfies readonly IntegrationService[];

const ALL_SERVICES = [...TOOL_SERVICES, "openai"] as const;

export interface ConnectionView {
  service: IntegrationService;
  status: IntegrationStatus;
  /** Libellé réel de l'état. */
  label: string;
  lastCheckAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  configured: boolean;
  /** Un appel de vérification existe. */
  checkable: boolean;
}

const LABELS: Record<IntegrationStatus, string> = {
  connected: "Connecté",
  degraded: "Dégradé",
  unavailable: "Indisponible",
  not_configured: "Connexion requise",
  to_verify: "À vérifier",
};

async function countPayloadSites(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(sites).where(eq(sites.cmsKind, "payload"));
  return row?.value ?? 0;
}

async function latestCalReceipt(db: Database): Promise<Date | null> {
  const [row] = await db
    .select({ at: webhookReceipts.receivedAt })
    .from(webhookReceipts)
    .where(eq(webhookReceipts.service, "cal"))
    .orderBy(desc(webhookReceipts.receivedAt))
    .limit(1);
  return row?.at ?? null;
}

/** Tous les états, sans appel externe. Une ligne « connecté » sans configuration ne le reste pas. */
export async function listConnections(
  ctx: ServiceContext,
  deps: { gateways?: ConnectionGateways } = {},
): Promise<ConnectionView[]> {
  assertCan(ctx.actor, "integrations:read");
  const gateways = deps.gateways ?? realGateways();
  const [rows, payloadSites, calAt] = await Promise.all([
    ctx.db
      .select()
      .from(integrationConnections)
      .where(inArray(integrationConnections.service, [...ALL_SERVICES])),
    countPayloadSites(ctx.db),
    latestCalReceipt(ctx.db),
  ]);
  const byService = new Map(rows.map((row) => [row.service, row]));

  return ALL_SERVICES.map((service): ConnectionView => {
    const row = byService.get(service);
    const check = CHECKS[service];
    const base = {
      service,
      lastCheckAt: row?.lastCheckAt ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastError: row?.lastError ?? null,
      checkable: check !== undefined,
    };
    if (service === "indy") {
      return {
        ...base,
        status: INDY_CONNECTION_STATUS,
        label: "API à vérifier",
        configured: false,
        // Aucun appel de vérification n'existe : aucune date ne doit le laisser croire.
        lastCheckAt: null,
        lastSuccessAt: null,
        lastError: null,
      };
    }
    if (service === "payload") {
      return {
        ...base,
        status: "not_configured",
        label: payloadSites > 0 ? `${payloadSites} sites · sans connexion` : "Sans connexion",
        configured: false,
      };
    }
    if (service === "cal") {
      if (!gateways.calConfigured) {
        return {
          ...base,
          status: "not_configured",
          label: LABELS.not_configured,
          configured: false,
        };
      }
      return {
        ...base,
        status: calAt ? "connected" : "to_verify",
        label: calAt ? "Connecté" : "Aucun webhook reçu",
        lastCheckAt: calAt,
        lastSuccessAt: calAt,
        configured: true,
      };
    }
    const configured = check ? check.configured(gateways) : false;
    if (!configured) {
      return {
        ...base,
        status: "not_configured",
        label: service === "n8n" ? "Optionnel" : LABELS.not_configured,
        configured,
        lastError: null,
      };
    }
    const status: IntegrationStatus =
      !row || row.status === "not_configured" ? "to_verify" : row.status;
    return { ...base, status, label: LABELS[status], configured };
  });
}

async function writeCheck(
  db: Database,
  service: IntegrationService,
  values: { status: IntegrationStatus; at: Date; error: string | null },
): Promise<void> {
  const success = values.status === "connected" ? { lastSuccessAt: values.at } : {};
  await db
    .insert(integrationConnections)
    .values({
      service,
      status: values.status,
      lastCheckAt: values.at,
      lastError: values.error,
      ...success,
    })
    .onConflictDoUpdate({
      target: integrationConnections.service,
      set: { status: values.status, lastCheckAt: values.at, lastError: values.error, ...success },
    });
}

function failure(error: unknown): { status: IntegrationStatus; message: string } {
  if (error instanceof ServiceUnavailableError) {
    return {
      status: error.reason === "not_configured" ? "not_configured" : "unavailable",
      message: error.message,
    };
  }
  if (isAppError(error)) return { status: "unavailable", message: error.message };
  logger.error("connection.check_failed", { error });
  return { status: "unavailable", message: "Le service a répondu de façon inattendue." };
}

async function runCheck(
  db: Database,
  service: IntegrationService,
  gateways: ConnectionGateways,
  now: Date,
): Promise<IntegrationStatus> {
  const check = CHECKS[service];
  if (!check) return "not_configured";
  if (!check.configured(gateways)) {
    await writeCheck(db, service, { status: "not_configured", at: now, error: null });
    return "not_configured";
  }
  try {
    await check.ping(gateways);
    await writeCheck(db, service, { status: "connected", at: now, error: null });
    return "connected";
  } catch (error) {
    const { status, message } = failure(error);
    await writeCheck(db, service, { status, at: now, error: message });
    return status;
  }
}

/** « Vérifier » : appel réel, résultat daté et journalisé. */
export async function checkConnection(
  ctx: ServiceContext,
  rawService: unknown,
  deps: { gateways?: ConnectionGateways; now?: Date } = {},
): Promise<IntegrationStatus> {
  assertCan(ctx.actor, "integrations:manage");
  const service: IntegrationService = parseInput(z.enum(ALL_SERVICES), rawService);
  const now = deps.now ?? new Date();
  const status = await runCheck(ctx.db, service, deps.gateways ?? realGateways(), now);
  await recordAudit(ctx.db, {
    actorId: ctx.actor.userId,
    action: "integration.checked",
    entityType: "integration",
    entityId: service,
    metadata: { status },
  });
  return status;
}

/** Tâche planifiée : les vérifications sans coût ni effet. */
export async function checkAutomaticConnections(
  db: Database,
  deps: { gateways?: ConnectionGateways; now?: Date } = {},
): Promise<number> {
  const gateways = deps.gateways ?? realGateways();
  const now = deps.now ?? new Date();
  for (const service of AUTOMATIC_CHECKS) await runCheck(db, service, gateways, now);
  return AUTOMATIC_CHECKS.length;
}
