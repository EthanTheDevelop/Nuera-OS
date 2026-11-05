import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/info-card";
import type { IntegrationStatus } from "@/lib/domain-enums";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import {
  getPermissionMatrix,
  listSensitiveActions,
  listUsers,
  PERMISSION_COLUMNS,
  type AuditEntryView,
} from "@/modules/admin/admin.service";
import {
  ExportButton,
  InviteUserButton,
  ManageUserButton,
  RequireTwoFactorSwitch,
} from "@/modules/admin/components/admin-controls";
import { EXPORT_DATASETS } from "@/modules/admin/export.service";
import { listAutomationRuns } from "@/modules/platform/automation.service";
import { RetryAllButton } from "@/modules/platform/components/automation-controls";
import { listConnections } from "@/modules/platform/connections.service";
import { isTwoFactorRequired } from "@/modules/platform/settings.service";
import { can } from "@/server/auth/permissions";
import { ROLE_LABELS, type Role } from "@/server/auth/roles";
import { getServiceContext } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";

export const metadata: Metadata = { title: "Administration et sécurité" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const TONES: Record<IntegrationStatus, BadgeTone> = {
  connected: "success",
  degraded: "warn",
  unavailable: "danger",
  not_configured: "neutral",
  to_verify: "warn",
};

/** L'ordre et les libellés de la carte Connexions externes (écran 24). */
const EXTERNAL = [
  ["coolify", "Coolify · API"],
  ["indy", "Indy"],
  ["uptime_kuma", "Uptime Kuma"],
  ["docuseal", "Signature électronique"],
  ["openai", "ChatGPT"],
  ["smtp", "E-mails"],
] as const;

type UserRow = Awaited<ReturnType<typeof listUsers>>["items"][number];

function roleBadge(role: Role) {
  if (role === "admin") return <Badge tone="accent">Associé · admin</Badge>;
  if (role === "client") return <Badge tone="neutral">Client · portail</Badge>;
  return <Badge tone="neutral">{ROLE_LABELS[role]}</Badge>;
}

function twoFactorBadge(row: UserRow) {
  if (row.role === "client") return <Badge tone="neutral">Lien e-mail</Badge>;
  return row.twoFactorEnabled ? (
    <Badge tone="success">Activée</Badge>
  ) : (
    <Badge tone="warn">Non activée</Badge>
  );
}

const permissionColumnsHeaders: Record<(typeof PERMISSION_COLUMNS)[number], string> = {
  admin: "Associé",
  member: "Collab.",
  contractor: "Prestat.",
  viewer: "Lecture",
  client: "Client",
};

function auditColumns(): DataTableColumn<AuditEntryView>[] {
  return [
    {
      key: "action",
      header: "Action sensible",
      primary: true,
      cell: (row) => (
        <span className="block text-cell font-semibold text-ink">
          {row.label}
          {row.detail ? ` : ${row.detail}` : ""}
        </span>
      ),
    },
    {
      key: "auteur",
      header: "Auteur",
      width: 150,
      cell: (row) =>
        row.actorName ? (
          <span className="flex items-center gap-2">
            <Avatar name={row.actorName} size={24} />
            <span className="truncate">{row.actorName.split(" ")[0]}</span>
          </span>
        ) : (
          "Système"
        ),
    },
    {
      key: "date",
      header: "Date",
      width: 150,
      cell: (row) => formatDateTime(row.occurredAt),
    },
  ];
}

export default async function AdministrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "admin:read")) return <ForbiddenState />;

  const params = await searchParams;
  const canManageUsers = can(ctx.actor, "users:manage");
  const [users, sensitive, connections, runs, required] = await Promise.all([
    listUsers(ctx, { page: one(params.page), pageSize: 10 }),
    listSensitiveActions(ctx, 5),
    listConnections(ctx),
    listAutomationRuns(ctx, { pageSize: 3 }),
    isTwoFactorRequired(ctx.db, getEnv().NODE_ENV),
  ]);
  const matrix = getPermissionMatrix(ctx);

  const userColumns: DataTableColumn<UserRow>[] = [
    {
      key: "utilisateur",
      header: "Utilisateur",
      primary: true,
      cell: (row) => (
        <CellIdentity
          name={row.name}
          title={row.name}
          subtitle={row.banned ? "Compte désactivé" : row.email}
          avatarSize={26}
        />
      ),
    },
    { key: "role", header: "Rôle", width: 150, cell: (row) => roleBadge(row.role) },
    { key: "deux", header: "Double auth.", width: 120, cell: twoFactorBadge },
    {
      key: "connexion",
      header: "Dernière connexion",
      width: 140,
      cell: (row) => (row.lastSignInAt ? formatRelativeTime(row.lastSignInAt) : "Jamais"),
    },
    ...(canManageUsers
      ? [
          {
            key: "gerer",
            header: "",
            width: 70,
            cell: (row: UserRow) => (
              <ManageUserButton
                user={{
                  id: row.id,
                  name: row.name,
                  email: row.email,
                  role: row.role,
                  banned: row.banned,
                  isSelf: row.id === ctx.actor.userId,
                }}
              />
            ),
          },
        ]
      : []),
  ];

  type MatrixRow = (typeof matrix)[number];
  const matrixColumns: DataTableColumn<MatrixRow>[] = [
    {
      key: "permission",
      header: "Permission",
      primary: true,
      cell: (row) => <span className="text-cell font-semibold text-ink">{row.label}</span>,
    },
    ...PERMISSION_COLUMNS.map((role): DataTableColumn<MatrixRow> => ({
      key: role,
      header: permissionColumnsHeaders[role],
      width: 72,
      cell: (row) =>
        row.roles[role] ? (
          <span
            role="img"
            aria-label="Autorisé"
            className="flex size-5 items-center justify-center rounded-full bg-success-pale text-success"
          >
            <Icon name="check" size={12} />
          </span>
        ) : (
          <span className="sr-only">Refusé</span>
        ),
    })),
  ];

  return (
    <>
      <PageHeader
        title="Administration et sécurité"
        subtitle="Comptes, rôles, journal des actions sensibles, connexions et export des données"
        actions={
          <>
            {can(ctx.actor, "export:run") ? (
              <ExportButton label="Exporter les données" datasets={EXPORT_DATASETS} />
            ) : null}
            {canManageUsers ? <InviteUserButton /> : null}
          </>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-(--cols-main-side)">
        <div className="flex min-w-0 flex-col gap-5">
          <DataTable
            caption="Utilisateurs"
            columns={userColumns}
            rows={users.items}
            rowKey={(row) => row.id}
            rowHeight="md"
            query={{ pathname: "/administration", searchParams: {} }}
            pagination={{ page: users.page, pageSize: users.pageSize, total: users.total }}
            empty={<EmptyState compact icon="clients" title="Aucun utilisateur" />}
          />
          <DataTable
            caption="Permissions par rôle"
            columns={matrixColumns}
            rows={matrix}
            rowKey={(row) => row.label}
          />
          <div className="flex flex-col gap-2">
            <DataTable
              caption="Actions sensibles"
              columns={auditColumns()}
              rows={sensitive}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  compact
                  icon="shield"
                  title="Aucune action sensible"
                  description="Les changements de droits, exports et déploiements apparaîtront ici."
                />
              }
            />
            <Link
              href="/administration/journal"
              className="hit-44 self-end text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Tout le journal
            </Link>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard
            icon="link"
            title="Connexions externes"
            rows={EXTERNAL.map(([service, label]) => {
              const connection = connections.find((row) => row.service === service);
              return {
                key: service,
                label,
                value: connection ? (
                  <Badge tone={TONES[connection.status]}>{connection.label}</Badge>
                ) : null,
              };
            })}
          >
            {can(ctx.actor, "integrations:read") ? (
              <Link
                href="/reglages/connexions"
                className="hit-44 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Ouvrir les connexions
              </Link>
            ) : null}
          </InfoCard>

          <InfoCard
            icon="automatisations"
            title="Automatisations · exécutions"
            aside={
              runs.failedTotal > 0 ? (
                <Badge tone="danger">
                  {runs.failedTotal} {runs.failedTotal > 1 ? "échecs" : "échec"}
                </Badge>
              ) : null
            }
            rows={runs.items.map((run) => ({
              key: run.id,
              label: run.ruleName,
              value: (
                <StatusBadge kind="automation" status={run.status}>
                  {`${run.status === "failed" ? "Échec" : run.status === "succeeded" ? "Réussie" : run.status === "skipped" ? "Ignorée" : "En cours"} · ${formatRelativeTime(run.finishedAt ?? run.startedAt)}`}
                </StatusBadge>
              ),
            }))}
          >
            {runs.items.length === 0 ? (
              <p className="text-sm text-muted">Aucune exécution pour le moment.</p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {can(ctx.actor, "automations:manage") && runs.failed > 0 ? <RetryAllButton /> : null}
              <Link
                href="/administration/executions"
                className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Toutes les exécutions
              </Link>
            </div>
          </InfoCard>

          <InfoCard icon="shield" title="Double authentification">
            <RequireTwoFactorSwitch
              required={required}
              canManage={can(ctx.actor, "admin:manage")}
            />
          </InfoCard>

          {can(ctx.actor, "export:run") ? (
            <InfoCard icon="download" title="Réversibilité">
              <p className="text-sm text-text">
                Toutes les données métier de Nuera OS s&apos;exportent en un clic (CSV et JSON).
              </p>
              <div>
                <ExportButton label="Exporter maintenant" datasets={EXPORT_DATASETS} />
              </div>
            </InfoCard>
          ) : null}
        </div>
      </div>
    </>
  );
}
