import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import {
  CellIdentity,
  CellMono,
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { APPOINTMENT_SOURCE_LABELS, APPOINTMENT_STATUS_LABELS } from "@/lib/domain-enums";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { paramValue } from "@/lib/url-state";
import { parseAppointmentScope, parseLinkParam } from "@/modules/appointments/appointment.schema";
import {
  getAppointmentCounts,
  listAppointmentMemberOptions,
  listAppointments,
  type AppointmentView,
} from "@/modules/appointments/appointment.service";
import { AppointmentFormButton } from "@/modules/appointments/components/appointment-form";
import { AppointmentRowActions } from "@/modules/appointments/components/appointment-row-actions";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Rendez-vous" };

const STATUS_TONE = { planned: "accent", done: "success", cancelled: "neutral" } as const;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["messages:read", "crm:read"])) return <ForbiddenState />;

  const params = await searchParams;
  const scope = parseAppointmentScope(paramValue(params, "vue"));
  // `?affaire=` et `?client=` : les réunions d'une affaire ou d'un client, depuis leur fiche.
  const opportunityId = parseLinkParam(paramValue(params, "affaire"));
  const companyId = parseLinkParam(paramValue(params, "client"));
  const canEdit = can(ctx.actor, "messages:send");
  const [result, counts, members] = await Promise.all([
    listAppointments(ctx, { scope, opportunityId, companyId, page: paramValue(params, "page") }),
    getAppointmentCounts(ctx, { opportunityId, companyId }),
    canEdit ? listAppointmentMemberOptions(ctx) : Promise.resolve([]),
  ]);

  const columns: DataTableColumn<AppointmentView>[] = [
    {
      key: "date",
      header: "DATE",
      width: 150,
      cell: (row) => <CellMono>{formatDateTime(row.startsAt)}</CellMono>,
    },
    {
      key: "title",
      header: "RENDEZ-VOUS",
      primary: true,
      cell: (row) => (
        <CellIdentity
          title={row.title}
          subtitle={[row.kind, formatMinutes(row.durationMinutes), row.channel]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
    },
    {
      key: "link",
      header: "LIÉ À",
      width: 220,
      cell: (row) => (
        <CellIdentity
          title={row.companyName ?? row.opportunityName ?? "Sans client"}
          subtitle={[row.contactName, row.projectName ?? row.opportunityName]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
    },
    {
      key: "members",
      header: "PARTICIPANTS",
      width: 130,
      hideWhenCollapsed: true,
      cell: (row) => (
        <span className="line-clamp-2 text-row-secondary text-muted">
          {row.memberNames.join(", ") || "Personne"}
        </span>
      ),
    },
    {
      key: "status",
      header: "STATUT",
      width: 150,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[row.status]}>{APPOINTMENT_STATUS_LABELS[row.status]}</Badge>
          {row.source === "cal" ? <Badge>{APPOINTMENT_SOURCE_LABELS.cal}</Badge> : null}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            width: 270,
            align: "right" as const,
            cell: (row: AppointmentView) => (
              <AppointmentRowActions appointment={row} members={members} />
            ),
          },
        ]
      : []),
  ];

  const subtitle = [
    plural(counts.upcoming, "à venir", "à venir"),
    plural(counts.past, "passé"),
    plural(counts.cancelled, "annulé"),
  ].join(" · ");

  const filtered = Boolean(opportunityId || companyId);
  const filterLabel =
    (opportunityId ? result.items[0]?.opportunityName : result.items[0]?.companyName) ??
    (opportunityId ? "cette affaire" : "ce client");

  return (
    <>
      <PageHeader
        title="Rendez-vous"
        subtitle={subtitle}
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Rendez-vous" }]}
        actions={
          canEdit ? (
            <>
              <ButtonLink href="/messages">Retour aux messages</ButtonLink>
              <AppointmentFormButton accent label="Nouveau rendez-vous" members={members} />
            </>
          ) : (
            <ButtonLink href="/messages">Retour aux messages</ButtonLink>
          )
        }
      >
        <FilterBar>
          <FilterChip param="vue" count={counts.upcoming}>
            À venir
          </FilterChip>
          <FilterChip param="vue" value="past" count={counts.past}>
            Passés
          </FilterChip>
          <FilterChip param="vue" value="cancelled" count={counts.cancelled}>
            Annulés
          </FilterChip>
          {filtered ? (
            <Link
              href="/messages/rendez-vous"
              className="hit-44 text-compact-button text-accent underline-offset-4 hover:underline"
            >
              Rendez-vous de {filterLabel} · tout afficher
            </Link>
          ) : null}
        </FilterBar>
      </PageHeader>
      <div className="anim-content">
        <DataTable
          caption="Rendez-vous"
          columns={columns}
          rows={result.items}
          rowKey={(row) => row.id}
          query={{ pathname: "/messages/rendez-vous", searchParams: params }}
          pagination={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          empty={
            <EmptyState
              icon="calendar"
              title="Aucun rendez-vous ici"
              description={
                scope === "upcoming"
                  ? "Planifiez un rendez-vous et reliez-le à un client, une affaire ou un projet."
                  : "Les rendez-vous de cette vue apparaîtront ici."
              }
            />
          }
        />
      </div>
    </>
  );
}
