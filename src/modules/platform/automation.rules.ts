import { excerpt } from "@/modules/messaging/mentions";
import {
  prepareReplySuggestion,
  type SuggestionDeps,
} from "@/modules/messaging/suggestion.service";
import { listPortalRecipients } from "@/modules/portal/portal.service";
import { recordQuoteReminder } from "@/modules/quotes/quote.service";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import type { Role } from "@/server/auth/roles";
import type { DomainEventRow } from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { logger } from "@/server/logger";
import type { IconName } from "@/components/ui/icon";
import * as lookup from "./automation.lookup";
import { enqueueEmail } from "./email-outbox";
import type { DomainEventPayloads, DomainEventType } from "./events";
import {
  absoluteAppUrl,
  escapeHtml,
  notify,
  renderNotificationEmail,
} from "./notifications.service";
import { getN8nGateway, type N8nGateway } from "@/integrations/n8n";

/**
 * Catalogue des automatisations (écran 12) : défini en code, activé en base (`automation_rules`).
 * Une règle réagit à des événements de domaine. Elle n'agit qu'une fois par événement
 * (`automation_runs`), et chaque notification porte un lien vers l'objet.
 *
 * `prepare` : étape externe éventuelle (OpenAI, n8n), hors transaction, pour ne jamais garder une
 * transaction ouverte pendant un appel réseau. `run` : écritures, dans la transaction de l'exécution.
 */
export interface AutomationDeps {
  suggestion?: SuggestionDeps;
  n8n?: N8nGateway;
}

export interface RuleExecution {
  event: DomainEventRow;
  now: Date;
  deps: AutomationDeps;
}

export type RuleResult = {
  /** `skipped` : rien à faire pour cet événement, sans que ce soit une erreur. */
  status?: "succeeded" | "skipped";
  detail?: Record<string, unknown>;
};

export interface AutomationRuleDefinition {
  key: string;
  name: string;
  /** « Quand… » */
  trigger: string;
  /** « Alors… » */
  action: string;
  tool: string;
  icon: IconName;
  group: AutomationGroup;
  events: readonly DomainEventType[];
  defaultEnabled: boolean;
  prepare?: (db: Database, execution: RuleExecution) => Promise<void>;
  run: (tx: Database, execution: RuleExecution) => Promise<RuleResult | void>;
}

export const AUTOMATION_GROUPS = [
  "Commercial",
  "Production",
  "Sites et suivi",
  "Contrats et support",
  "Finances",
  "Connecteurs",
] as const;
export type AutomationGroup = (typeof AUTOMATION_GROUPS)[number];

function payloadOf<TType extends DomainEventType>(
  event: DomainEventRow,
): DomainEventPayloads[TType] {
  return event.payload as unknown as DomainEventPayloads[TType];
}

const AGENCY: readonly Role[] = ["admin"];
const TEAM: readonly Role[] = ["admin", "member"];

/**
 * Destinataires : des rôles, plus des comptes précis, sans l'auteur de l'action ni un compte qui
 * n'aurait pas le droit d'ouvrir l'objet.
 */
async function recipients(
  tx: Database,
  event: DomainEventRow,
  input: {
    roles?: readonly Role[];
    userIds?: readonly (string | null)[];
    permission?: Permission;
  },
): Promise<string[]> {
  const byRole = input.roles ? await lookup.findActiveUsersByRoles(tx, input.roles) : [];
  const named = await lookup.findActiveUsersByIds(
    tx,
    (input.userIds ?? []).filter((id): id is string => id !== null),
  );
  const seen = new Set<string>();
  for (const user of [...byRole, ...named]) {
    if (input.permission && !hasPermission(user.role, input.permission)) continue;
    if (user.id !== event.actorId) seen.add(user.id);
  }
  return [...seen];
}

/** Clients de la société de l'événement qui acceptent ce type d'e-mail. */
async function portalRecipients(
  tx: Database,
  event: DomainEventRow,
  preference: "notifyValidation" | "notifyRequirement",
) {
  if (!event.companyId) return [];
  const clients = await listPortalRecipients(tx, event.companyId);
  return clients.filter((client) => client.preferences[preference]);
}

/** Clé d'une alerte : un événement, une règle. Une relance ne répète donc jamais l'alerte. */
function alertKey(ruleKey: string, event: DomainEventRow): string {
  return `rule:${ruleKey}:${event.id}`;
}

const RULES: AutomationRuleDefinition[] = [
  // --- Commercial --------------------------------------------------------------------------------
  {
    key: "client_message",
    name: "Un client écrit",
    trigger: "Un client écrit",
    action: "Préparer une réponse avec ChatGPT (jamais envoyée seule), prévenir l'équipe",
    tool: "ChatGPT",
    icon: "sparkle",
    group: "Commercial",
    events: ["message.received"],
    defaultEnabled: true,
    // Sans clé ou suggestions désactivées, la préparation ne fait rien : l'équipe est prévenue.
    prepare: async (db, { event, deps }) => {
      const { conversationId } = payloadOf<"message.received">(event);
      // Un échec d'OpenAI est déjà enregistré sur la suggestion : l'équipe doit quand même être
      // prévenue du message, et peut redemander une proposition depuis la conversation.
      await prepareReplySuggestion(db, { conversationId }, deps.suggestion).catch((error) =>
        logger.warn("automation.suggestion_failed", { conversationId, error }),
      );
    },
    run: async (tx, { event }) => {
      const { conversationId } = payloadOf<"message.received">(event);
      const company = await lookup.findCompanyName(tx, event.companyId);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "messages:read" });
      await notify(tx, {
        userIds,
        kind: "client_message",
        severity: "info",
        title: company ? `Nouveau message de ${company}` : "Nouveau message d'un client",
        href: `/messages/${conversationId}`,
        entityType: "conversation",
        entityId: conversationId,
        dedupeKey: alertKey("client_message", event),
      });
      return { detail: { conversationId, recipients: userIds.length } };
    },
  },
  {
    key: "quote_reminder",
    name: "Relance devis J+7",
    trigger: "Un devis n'est pas signé après 7 jours",
    action: "Relancer le client par e-mail, prévenir la direction",
    tool: "E-mail",
    icon: "devis",
    group: "Commercial",
    events: ["quote.reminder_due"],
    defaultEnabled: true,
    run: async (tx, { event, now }) => {
      const { number } = payloadOf<"quote.reminder_due">(event);
      const recipient = await lookup.findQuoteRecipient(tx, event.entityId);
      const userIds = await recipients(tx, event, { roles: AGENCY });
      if (!recipient) {
        await notify(tx, {
          userIds,
          kind: "quote_reminder",
          severity: "warning",
          title: `Devis ${number} sans réponse : aucun contact à relancer`,
          body: "Ajoutez un contact avec une adresse e-mail au client, puis relancez à la main.",
          href: `/devis/${event.entityId}`,
          entityType: "quote",
          entityId: event.entityId,
          dedupeKey: alertKey("quote_reminder", event),
        });
        return { status: "skipped", detail: { reason: "no_contact" } };
      }
      const greeting = recipient.firstName ? `Bonjour ${recipient.firstName},` : "Bonjour,";
      const body = `Nous n'avons pas encore eu votre retour sur le devis ${number}${
        recipient.title ? ` (${recipient.title})` : ""
      }. Avez-vous besoin d'un éclaircissement, ou d'un ajustement ?`;
      await enqueueEmail(tx, {
        to: recipient.email,
        subject: `Votre devis ${number} chez Nuera Studio`,
        text: `${greeting}\n\n${body}\n\nL'équipe Nuera Studio`,
        // Prénom et titre viennent du CRM et du devis : jamais de HTML brut dans un e-mail.
        html: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p>L'équipe Nuera Studio</p>`,
        template: "quote_reminder",
        dedupeKey: `quote_reminder:${event.id}`,
      });
      await recordQuoteReminder(tx, { quoteId: event.entityId, now, actorId: null });
      await notify(tx, {
        userIds,
        kind: "quote_reminder",
        severity: "info",
        title: `Devis ${number} relancé`,
        href: `/devis/${event.entityId}`,
        entityType: "quote",
        entityId: event.entityId,
        dedupeKey: alertKey("quote_reminder", event),
      });
      return { detail: { number } };
    },
  },
  {
    key: "quote_accepted",
    name: "Devis signé",
    trigger: "Un devis est signé",
    action: "Prévenir la direction ; le projet est déjà créé par l'acceptation",
    tool: "Nuera OS",
    icon: "check",
    group: "Commercial",
    events: ["quote.accepted"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const { number } = payloadOf<"quote.accepted">(event);
      const company = await lookup.findCompanyName(tx, event.companyId);
      const userIds = await recipients(tx, event, { roles: AGENCY });
      await notify(tx, {
        userIds,
        kind: "quote_signed",
        severity: "info",
        title: `Devis ${number} signé${company ? ` par ${company}` : ""}`,
        href: `/devis/${event.entityId}`,
        entityType: "quote",
        entityId: event.entityId,
        dedupeKey: alertKey("quote_accepted", event),
      });
      return { detail: { number, recipients: userIds.length } };
    },
  },
  {
    key: "opportunity_won",
    name: "Affaire gagnée",
    trigger: "Une affaire est gagnée",
    action: "Prévenir la direction",
    tool: "Twenty",
    icon: "pipeline",
    group: "Commercial",
    events: ["opportunity.won"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const company = await lookup.findCompanyName(tx, event.companyId);
      const userIds = await recipients(tx, event, { roles: AGENCY });
      await notify(tx, {
        userIds,
        kind: "opportunity_won",
        severity: "info",
        title: `Affaire gagnée${company ? ` : ${company}` : ""}`,
        href: `/pipeline/${event.entityId}`,
        entityType: "opportunity",
        entityId: event.entityId,
        dedupeKey: alertKey("opportunity_won", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },

  {
    key: "opportunity_action_due",
    name: "Rappel d'une affaire",
    trigger: "La prochaine action d'une affaire arrive à échéance",
    action: "Rappeler la personne responsable, sinon la direction",
    tool: "Nuera OS",
    icon: "clock",
    group: "Commercial",
    events: ["opportunity.action_due"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"opportunity.action_due">(event);
      const owner = await lookup.findUserIdOfMember(tx, payload.ownerMemberId);
      const userIds = await recipients(tx, event, {
        ...(owner ? { userIds: [owner] } : { roles: AGENCY }),
        permission: "sales:read",
      });
      await notify(tx, {
        userIds,
        kind: "opportunity_action",
        severity: "warning",
        title: `À faire : ${payload.nextAction ?? "prochaine action"}`,
        body: payload.name,
        href: `/pipeline/${event.entityId}`,
        entityType: "opportunity",
        entityId: event.entityId,
        dedupeKey: alertKey("opportunity_action_due", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },

  // --- Production --------------------------------------------------------------------------------
  {
    key: "deliverable_validation_reminder",
    name: "Relance de validation",
    trigger: "Une validation client se fait attendre à J+3 et J+7",
    action: "Relancer le client selon ses préférences, alerter la personne responsable",
    tool: "E-mail",
    icon: "clock",
    group: "Production",
    events: ["deliverable.validation_overdue"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"deliverable.validation_overdue">(event);
      const owner = await lookup.findProjectOwnerUserId(tx, payload.projectId);
      const userIds = await recipients(tx, event, {
        roles: AGENCY,
        userIds: [owner],
        permission: "projects:read",
      });
      await notify(tx, {
        userIds,
        kind: "deliverable",
        severity: "warning",
        title: `Validation en attente : ${payload.title}`,
        body: payload.projectName,
        href: `/projets/${payload.projectId}`,
        entityType: "deliverable",
        entityId: event.entityId,
        dedupeKey: alertKey("deliverable_validation_reminder", event),
      });
      const clients = await portalRecipients(tx, event, "notifyValidation");
      for (const client of clients) {
        const { text, html } = renderNotificationEmail({
          title: `Votre validation est attendue : ${payload.title}`,
          body: `Pour le projet ${payload.projectName}. La suite du projet dépend de votre retour.`,
          url: absoluteAppUrl("/espace"),
        });
        await enqueueEmail(tx, {
          to: client.email,
          subject: `À valider : ${payload.title}`,
          text,
          html,
          template: "client_deliverable_reminder",
          dedupeKey: `deliverable_validation_reminder:${event.id}:${client.userId}`,
        });
      }
      return { detail: { clients: clients.length, recipients: userIds.length } };
    },
  },
  {
    key: "requirement_reminder",
    name: "Relance des contenus",
    trigger: "Des contenus manquent à J+3 et J+7",
    action: "Relancer le client, alerter la personne responsable du projet",
    tool: "E-mail",
    icon: "clock",
    group: "Production",
    events: ["requirement.overdue"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"requirement.overdue">(event);
      const owner = await lookup.findProjectOwnerUserId(tx, payload.projectId);
      const userIds = await recipients(tx, event, {
        roles: AGENCY,
        userIds: [owner],
        permission: "projects:read",
      });
      await notify(tx, {
        userIds,
        kind: "requirement_overdue",
        severity: "warning",
        title: `Contenu attendu en retard : ${payload.label}`,
        body: payload.projectName,
        href: `/projets/${payload.projectId}`,
        entityType: "project",
        entityId: payload.projectId,
        dedupeKey: alertKey("requirement_reminder", event),
      });
      const clients = await portalRecipients(tx, event, "notifyRequirement");
      for (const client of clients) {
        const { text, html } = renderNotificationEmail({
          title: `Nous attendons toujours : ${payload.label}`,
          body: `Pour le projet ${payload.projectName}. La date de mise en ligne dépend de ce contenu.`,
          url: absoluteAppUrl("/espace/documents"),
        });
        await enqueueEmail(tx, {
          to: client.email,
          subject: `Contenu attendu : ${payload.label}`,
          text,
          html,
          template: "client_requirement_reminder",
          dedupeKey: `requirement_reminder:${event.id}:${client.userId}`,
        });
      }
      return { detail: { clients: clients.length, recipients: userIds.length } };
    },
  },
  {
    key: "deliverable_submitted",
    name: "Livrable à valider",
    trigger: "Un livrable est soumis à validation",
    action: "Prévenir le client par e-mail selon ses préférences, informer le responsable",
    tool: "E-mail",
    icon: "projets",
    group: "Production",
    events: ["deliverable.submitted"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"deliverable.submitted">(event);
      const owner = await lookup.findProjectOwnerUserId(tx, payload.projectId);
      const userIds = await recipients(tx, event, {
        userIds: [owner],
        permission: "projects:read",
      });
      await notify(tx, {
        userIds,
        kind: "deliverable",
        severity: "info",
        title: `Livrable soumis : ${payload.title}`,
        href: `/projets/${payload.projectId}`,
        entityType: "deliverable",
        entityId: event.entityId,
        dedupeKey: alertKey("deliverable_submitted", event),
      });
      const clients = await portalRecipients(tx, event, "notifyValidation");
      for (const client of clients) {
        const { text, html } = renderNotificationEmail({
          title: `Un élément attend votre validation : ${payload.title}`,
          body: "Vous pouvez le consulter et donner votre retour depuis votre espace.",
          url: absoluteAppUrl("/espace"),
        });
        await enqueueEmail(tx, {
          to: client.email,
          subject: `À valider : ${payload.title}`,
          text,
          html,
          template: "client_deliverable_submitted",
          dedupeKey: `deliverable_submitted:${event.id}:${client.userId}`,
        });
      }
      return { detail: { clients: clients.length } };
    },
  },
  {
    key: "deliverable_reviewed",
    name: "Retour sur un livrable",
    trigger: "Un livrable est validé ou reçoit des retours",
    action: "Prévenir la personne responsable du projet et la direction",
    tool: "Nuera OS",
    icon: "edit",
    group: "Production",
    events: ["deliverable.validated", "deliverable.changes_requested"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"deliverable.validated">(event);
      const validated = event.type === "deliverable.validated";
      const owner = await lookup.findProjectOwnerUserId(tx, payload.projectId);
      const userIds = await recipients(tx, event, {
        roles: AGENCY,
        userIds: [owner],
        permission: "projects:read",
      });
      await notify(tx, {
        userIds,
        kind: "deliverable",
        severity: validated ? "info" : "warning",
        title: validated
          ? `Livrable validé : ${payload.title}`
          : `Retours demandés sur : ${payload.title}`,
        href: `/projets/${payload.projectId}`,
        entityType: "deliverable",
        entityId: event.entityId,
        dedupeKey: alertKey("deliverable_reviewed", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },
  {
    key: "task_overdue",
    name: "Tâche en retard",
    trigger: "Une tâche dépasse son échéance",
    action: "Prévenir la personne assignée et la personne responsable du projet",
    tool: "Nuera OS",
    icon: "alert",
    group: "Production",
    events: ["task.overdue"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"task.overdue">(event);
      // Une transaction n'a qu'une connexion : lectures l'une après l'autre.
      const assignee = await lookup.findUserIdOfMember(tx, payload.assigneeMemberId);
      const owner = await lookup.findProjectOwnerUserId(tx, payload.projectId);
      const userIds = await recipients(tx, event, { userIds: [assignee, owner] });
      await notify(tx, {
        userIds,
        kind: "task_overdue",
        severity: "warning",
        title: `Tâche en retard : ${payload.title}`,
        href: `/projets/${payload.projectId}?tache=${event.entityId}`,
        entityType: "task",
        entityId: event.entityId,
        dedupeKey: alertKey("task_overdue", event),
      });
      return { status: userIds.length > 0 ? "succeeded" : "skipped" };
    },
  },
  {
    key: "budget_threshold",
    name: "Budget à 80 %",
    trigger: "Un projet atteint 80 % de son budget",
    action: "Alerter la direction et la personne responsable du projet",
    tool: "Nuera OS",
    icon: "euro",
    group: "Production",
    events: ["budget.threshold_80"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const owner = await lookup.findProjectOwnerUserId(tx, event.entityId);
      const userIds = await recipients(tx, event, {
        roles: AGENCY,
        userIds: [owner],
        permission: "projects:read",
      });
      await notify(tx, {
        userIds,
        kind: "budget_threshold",
        severity: "warning",
        title: "Budget du projet consommé à 80 %",
        href: `/projets/${event.entityId}`,
        entityType: "project",
        entityId: event.entityId,
        dedupeKey: alertKey("budget_threshold", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },

  // --- Sites et suivi ----------------------------------------------------------------------------
  {
    key: "site_down",
    name: "Site en panne",
    trigger: "Un site ne répond plus",
    action: "Alerte immédiate à la direction et à l'équipe",
    tool: "Uptime Kuma",
    icon: "server",
    group: "Sites et suivi",
    events: ["site.down"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"site.down">(event);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "sites:read" });
      await notify(tx, {
        userIds,
        kind: "site_down",
        severity: "danger",
        title: `Site en panne : ${payload.primaryDomain ?? payload.name}`,
        href: `/sites/${event.entityId}`,
        entityType: "site",
        entityId: event.entityId,
        dedupeKey: alertKey("site_down", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },
  {
    key: "deployment_failed",
    name: "Déploiement en échec",
    trigger: "Un déploiement échoue sur Coolify",
    action: "Prévenir l'équipe",
    tool: "Coolify",
    icon: "rocket",
    group: "Sites et suivi",
    events: ["deployment.finished"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"deployment.finished">(event);
      if (payload.status !== "failed") return { status: "skipped" };
      const userIds = await recipients(tx, event, {
        roles: TEAM,
        permission: "deployments:read",
      });
      await notify(tx, {
        userIds,
        kind: "deployment_failed",
        severity: "danger",
        title: "Un déploiement a échoué",
        href: `/sites/${payload.siteId}`,
        entityType: "site",
        entityId: payload.siteId,
        dedupeKey: alertKey("deployment_failed", event),
      });
      return { detail: { siteId: payload.siteId } };
    },
  },
  {
    key: "backup_failed",
    name: "Sauvegarde en échec",
    trigger: "Une sauvegarde échoue",
    action: "Alerter la direction et l'équipe",
    tool: "Coolify",
    icon: "database",
    group: "Sites et suivi",
    events: ["backup.failed"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"backup.failed">(event);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "sites:read" });
      await notify(tx, {
        userIds,
        kind: "backup_failed",
        severity: "danger",
        title: "Une sauvegarde a échoué",
        href: `/sites/${payload.siteId}`,
        entityType: "site",
        entityId: payload.siteId,
        dedupeKey: alertKey("backup_failed", event),
      });
      return { detail: { siteId: payload.siteId } };
    },
  },
  {
    key: "backup_missing",
    name: "Sauvegarde absente",
    trigger: "Un site en ligne n'a pas de sauvegarde réussie depuis 48 h",
    action: "Alerter la direction et l'équipe",
    tool: "Coolify",
    icon: "database",
    group: "Sites et suivi",
    events: ["backup.missing"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"backup.missing">(event);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "sites:read" });
      await notify(tx, {
        userIds,
        kind: "backup_failed",
        severity: "danger",
        title: `Aucune sauvegarde récente : ${payload.name}`,
        href: `/sites/${event.entityId}`,
        entityType: "site",
        entityId: event.entityId,
        dedupeKey: alertKey("backup_missing", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },
  {
    key: "domain_expiring",
    name: "Domaine à renouveler",
    trigger: "Un domaine arrive à échéance",
    action: "Prévenir la direction",
    tool: "Nuera OS",
    icon: "globe2",
    group: "Sites et suivi",
    events: ["domain.expiring"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"domain.expiring">(event);
      const userIds = await recipients(tx, event, { roles: AGENCY });
      await notify(tx, {
        userIds,
        kind: "domain_expiring",
        severity: "warning",
        title: `Domaine à renouveler : ${payload.name}`,
        body: `Échéance le ${payload.expiresOn}`,
        href: payload.siteId ? `/sites/${payload.siteId}` : "/sites/domaines",
        entityType: "domain",
        entityId: event.entityId,
        dedupeKey: alertKey("domain_expiring", event),
      });
      return { detail: { name: payload.name } };
    },
  },

  // --- Contrats et support -----------------------------------------------------------------------
  {
    key: "contract_expiring",
    name: "Contrat à renouveler",
    trigger: "Un contrat approche de son échéance",
    action: "Prévenir la direction",
    tool: "Nuera OS",
    icon: "contrat",
    group: "Contrats et support",
    events: ["contract.expiring"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"contract.expiring">(event);
      const userIds = await recipients(tx, event, { roles: AGENCY });
      await notify(tx, {
        userIds,
        kind: "contract",
        severity: "warning",
        title: `Contrat ${payload.number} bientôt à échéance`,
        href: `/contrats/${event.entityId}`,
        entityType: "contract",
        entityId: event.entityId,
        dedupeKey: alertKey("contract_expiring", event),
      });
      return { detail: { number: payload.number } };
    },
  },
  {
    key: "contract_quota",
    name: "Forfait consommé",
    trigger: "Un contrat atteint 80 % ou dépasse son forfait",
    action: "Prévenir la direction et l'équipe",
    tool: "Nuera OS",
    icon: "contrat",
    group: "Contrats et support",
    events: ["contract.quota_80", "contract.quota_exceeded"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"contract.quota_80">(event);
      const exceeded = event.type === "contract.quota_exceeded";
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "contracts:read" });
      await notify(tx, {
        userIds,
        kind: "contract",
        severity: exceeded ? "danger" : "warning",
        title: exceeded
          ? `Forfait dépassé : contrat ${payload.number}`
          : `Forfait consommé à 80 % : contrat ${payload.number}`,
        href: `/contrats/${event.entityId}`,
        entityType: "contract",
        entityId: event.entityId,
        dedupeKey: alertKey("contract_quota", event),
      });
      return { detail: { number: payload.number, exceeded } };
    },
  },
  {
    key: "ticket_created",
    name: "Nouvelle demande",
    trigger: "Une demande de support arrive",
    action: "Prévenir l'équipe",
    tool: "Nuera OS",
    icon: "support",
    group: "Contrats et support",
    events: ["ticket.created"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"ticket.created">(event);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "support:read" });
      await notify(tx, {
        userIds,
        kind: "ticket",
        severity: "info",
        title: `Nouvelle demande ${payload.number} : ${payload.subject}`,
        href: `/support/${event.entityId}`,
        entityType: "ticket",
        entityId: event.entityId,
        dedupeKey: alertKey("ticket_created", event),
      });
      return { detail: { number: payload.number } };
    },
  },
  {
    key: "ticket_critical",
    name: "Demande critique",
    trigger: "Une demande devient critique",
    action: "Alerte immédiate à la direction et à l'équipe",
    tool: "Nuera OS",
    icon: "alert",
    group: "Contrats et support",
    events: ["ticket.critical"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"ticket.critical">(event);
      const userIds = await recipients(tx, event, { roles: TEAM, permission: "support:read" });
      await notify(tx, {
        userIds,
        kind: "ticket_critical",
        severity: "danger",
        title: `Demande critique ${payload.number} : ${payload.subject}`,
        href: `/support/${event.entityId}`,
        entityType: "ticket",
        entityId: event.entityId,
        dedupeKey: alertKey("ticket_critical", event),
      });
      return { detail: { number: payload.number } };
    },
  },
  {
    key: "ticket_client_message",
    name: "Réponse d'un client sur une demande",
    trigger: "Un client écrit sur une demande",
    action: "Prévenir la personne assignée, sinon l'équipe",
    tool: "Nuera OS",
    icon: "support",
    group: "Contrats et support",
    events: ["ticket.client_message"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"ticket.client_message">(event);
      const assignee = await lookup.findTicketAssigneeUserId(tx, event.entityId);
      const userIds = await recipients(
        tx,
        event,
        assignee ? { userIds: [assignee] } : { roles: TEAM, permission: "support:read" },
      );
      await notify(tx, {
        userIds,
        kind: "client_message",
        severity: "info",
        title: `Le client a répondu sur ${payload.number}`,
        body: excerpt(payload.subject),
        href: `/support/${event.entityId}`,
        entityType: "ticket",
        entityId: event.entityId,
        dedupeKey: alertKey("ticket_client_message", event),
      });
      return { detail: { number: payload.number } };
    },
  },
  {
    key: "ticket_due_soon",
    name: "Demande bientôt hors délai",
    trigger: "L'échéance d'une demande approche",
    action: "Prévenir la personne assignée, sinon l'équipe",
    tool: "Nuera OS",
    icon: "clock",
    group: "Contrats et support",
    events: ["ticket.due_soon"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"ticket.due_soon">(event);
      const assignee = await lookup.findTicketAssigneeUserId(tx, event.entityId);
      const userIds = await recipients(
        tx,
        event,
        assignee ? { userIds: [assignee] } : { roles: TEAM, permission: "support:read" },
      );
      await notify(tx, {
        userIds,
        kind: "ticket",
        severity: "warning",
        title: `Échéance proche : ${payload.number}`,
        body: excerpt(payload.subject),
        href: `/support/${event.entityId}`,
        entityType: "ticket",
        entityId: event.entityId,
        dedupeKey: alertKey("ticket_due_soon", event),
      });
      return { detail: { number: payload.number } };
    },
  },

  // --- Finances ----------------------------------------------------------------------------------
  {
    key: "invoice_paid",
    name: "Paiement reçu",
    trigger: "Une facture est payée",
    action: "Prévenir la direction",
    tool: "Indy",
    icon: "wallet",
    group: "Finances",
    events: ["invoice.paid"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"invoice.paid">(event);
      const company = await lookup.findCompanyName(tx, event.companyId);
      const userIds = await recipients(tx, event, { roles: AGENCY, permission: "finance:read" });
      await notify(tx, {
        userIds,
        kind: "payment",
        severity: "info",
        title: `Facture payée${payload.externalRef ? ` : ${payload.externalRef}` : ""}`,
        body: company,
        href: `/finances/factures/${event.entityId}`,
        entityType: "financial_document",
        entityId: event.entityId,
        dedupeKey: alertKey("invoice_paid", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },
  {
    key: "invoice_overdue",
    name: "Facture en retard",
    trigger: "Une facture dépasse son échéance",
    action: "Alerter la direction",
    tool: "Indy",
    icon: "wallet",
    group: "Finances",
    events: ["invoice.overdue"],
    defaultEnabled: true,
    run: async (tx, { event }) => {
      const payload = payloadOf<"invoice.overdue">(event);
      const company = await lookup.findCompanyName(tx, event.companyId);
      const userIds = await recipients(tx, event, { roles: AGENCY, permission: "finance:read" });
      await notify(tx, {
        userIds,
        kind: "invoice_overdue",
        severity: "danger",
        title: `Facture en retard${payload.externalRef ? ` : ${payload.externalRef}` : ""}`,
        body: company,
        href: `/finances/factures/${event.entityId}`,
        entityType: "financial_document",
        entityId: event.entityId,
        dedupeKey: alertKey("invoice_overdue", event),
      });
      return { detail: { recipients: userIds.length } };
    },
  },

  // --- Connecteurs -------------------------------------------------------------------------------
  {
    key: "n8n_forward",
    name: "Relais vers n8n",
    trigger: "Un devis est signé ou une facture est payée",
    action: "Transmettre l'événement signé à n8n, pour les scénarios entre plusieurs outils",
    tool: "n8n",
    icon: "link",
    group: "Connecteurs",
    events: ["quote.accepted", "invoice.paid"],
    defaultEnabled: false,
    prepare: async (_db, { event, deps }) => {
      const n8n = deps.n8n ?? getN8nGateway();
      await n8n.send({
        id: event.id,
        type: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        companyId: event.companyId,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      });
    },
    run: async () => ({ detail: { forwarded: true } }),
  },
];

export const AUTOMATION_RULES: readonly AutomationRuleDefinition[] = RULES;

const BY_KEY = new Map(RULES.map((rule) => [rule.key, rule]));

export function findRuleDefinition(key: string): AutomationRuleDefinition | undefined {
  return BY_KEY.get(key);
}

export function rulesForEvent(type: string): AutomationRuleDefinition[] {
  return RULES.filter((rule) => (rule.events as readonly string[]).includes(type));
}
