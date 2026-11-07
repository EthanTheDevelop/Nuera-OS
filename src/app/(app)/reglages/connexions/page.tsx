import { ConnectionRequired, ForbiddenState } from "@/components/states/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { staggerIndex } from "@/components/motion/stagger";
import type { IntegrationService, IntegrationStatus } from "@/lib/domain-enums";
import { formatDateTime } from "@/lib/format";
import { getSuggestionSettings } from "@/modules/messaging/suggestion.service";
import {
  CheckChatgptButton,
  CheckConnectionButton,
  SuggestionSwitches,
} from "@/modules/platform/components/automation-controls";
import {
  listConnections,
  type ConnectionView,
  type TOOL_SERVICES,
} from "@/modules/platform/connections.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

const TONES: Record<IntegrationStatus, BadgeTone> = {
  connected: "success",
  degraded: "warn",
  unavailable: "danger",
  not_configured: "neutral",
  to_verify: "warn",
};

const TOOLS: Record<
  (typeof TOOL_SERVICES)[number],
  {
    name: string;
    role: string;
    hosting: string;
    icon: IconName;
  }
> = {
  twenty: {
    name: "Twenty",
    role: "CRM · contacts, affaires, tâches",
    hosting: "Notre serveur",
    icon: "clients",
  },
  payload: {
    name: "Payload",
    role: "CMS des sites clients",
    hosting: "Notre serveur",
    icon: "globe2",
  },
  docuseal: {
    name: "DocuSeal",
    role: "Signature des devis",
    hosting: "Notre serveur",
    icon: "devis",
  },
  indy: {
    name: "Indy",
    role: "Factures et comptabilité",
    hosting: "Externe, imposé",
    icon: "euro",
  },
  uptime_kuma: {
    name: "Uptime Kuma",
    role: "Surveillance des sites",
    hosting: "Notre serveur",
    icon: "server",
  },
  n8n: {
    name: "n8n",
    role: "Automatisations entre outils",
    hosting: "Notre serveur",
    icon: "automatisations",
  },
  cal: {
    name: "Cal.diy",
    role: "Prise de rendez-vous",
    hosting: "Notre serveur",
    icon: "calendar",
  },
  coolify: {
    name: "Coolify",
    role: "Mise en ligne et sauvegardes",
    hosting: "Notre serveur",
    icon: "link",
  },
  smtp: { name: "E-mails", role: "Envoi par SMTP", hosting: "Serveur d'envoi", icon: "send" },
};

function ToolCard({
  connection,
  canManage,
  index,
}: {
  connection: ConnectionView;
  canManage: boolean;
  index: number;
}) {
  const tool = TOOLS[connection.service as keyof typeof TOOLS];
  const checkedAt = connection.lastCheckAt;
  return (
    <article
      className="anim-content flex flex-col gap-3 rounded-lg bg-surface p-6 shadow-soft"
      style={staggerIndex(index)}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-accent-pale text-accent"
        >
          <Icon name={tool.icon} size={16} />
        </span>
        <h3 className="text-base font-medium text-ink">{tool.name}</h3>
      </div>
      <p className="text-xs text-muted">{tool.role}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={TONES[connection.status]}>{connection.label}</Badge>
        <span className="text-xs text-muted">{tool.hosting}</span>
      </div>
      {connection.lastError ? <p className="text-xs text-danger">{connection.lastError}</p> : null}
      <div className="mt-auto flex min-h-6 items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {checkedAt ? `Vérifié le ${formatDateTime(checkedAt)}` : "Jamais vérifié"}
        </span>
        {canManage && connection.checkable && connection.configured ? (
          <CheckConnectionButton service={connection.service} label={tool.name} />
        ) : null}
      </div>
    </article>
  );
}

const CHATGPT_SERVICE: IntegrationService = "openai";

export default async function ConnectionsPage() {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "integrations:read")) return <ForbiddenState />;

  const [connections, settings] = await Promise.all([
    listConnections(ctx),
    getSuggestionSettings(ctx.db),
  ]);
  const canManage = can(ctx.actor, "integrations:manage");
  const chatgpt = connections.find((connection) => connection.service === CHATGPT_SERVICE);
  const tools = connections.filter((connection) => connection.service !== CHATGPT_SERVICE);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted">
        Les outils branchés à Nuera OS. Tout tourne sur notre serveur, sauf ce que la loi impose
        (facturation, paiement) et ChatGPT.
      </p>
      <section
        aria-label="ChatGPT"
        className="anim-content flex flex-col gap-5 rounded-lg border border-chatgpt bg-surface p-6 shadow-soft"
      >
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-md bg-chatgpt-pale text-chatgpt"
          >
            <Icon name="sparkle" size={22} />
          </span>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-base font-semibold text-ink">ChatGPT · rédaction des réponses</h2>
            <p className="text-sm text-text">
              Utilise l&apos;API OpenAI, par une clé gardée sur notre serveur. Seul le message
              traité part, avec un contexte de projet minimal.
            </p>
          </div>
          {chatgpt ? <Badge tone={TONES[chatgpt.status]}>{chatgpt.label}</Badge> : null}
          {canManage && chatgpt?.configured ? <CheckChatgptButton /> : null}
        </div>
        <SuggestionSwitches
          enabled={settings.enabled}
          readProjectContext={settings.readProjectContext}
          canManage={canManage}
        />
        {chatgpt?.lastError ? <p className="text-xs text-danger">{chatgpt.lastError}</p> : null}
        {chatgpt && !chatgpt.configured ? (
          <ConnectionRequired
            compact
            service="OpenAI"
            missing="La clé d'API et le modèle ne sont pas renseignés sur le serveur. Sans eux, aucune suggestion n'est préparée."
            showSettingsLink={false}
          />
        ) : null}
        {chatgpt?.lastCheckAt ? (
          <p className="text-xs text-muted">Vérifié le {formatDateTime(chatgpt.lastCheckAt)}</p>
        ) : null}
      </section>

      <section aria-label="Outils branchés" className="flex flex-col gap-6">
        <h2 className="anim-header font-mono text-table-head font-normal text-muted uppercase">
          Outils branchés
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-[repeat(auto-fit,minmax(380px,1fr))]">
          {tools.map((connection, index) => (
            <ToolCard
              key={connection.service}
              connection={connection}
              canManage={canManage}
              index={index}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
