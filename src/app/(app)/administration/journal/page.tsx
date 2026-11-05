import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { DateField, SelectField } from "@/components/ui/form";
import { formatDateTime } from "@/lib/format";
import {
  AUDIT_GROUPS,
  listAuditActors,
  listAuditLog,
  type AuditEntryView,
} from "@/modules/admin/admin.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Journal d'audit" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

const columns: readonly DataTableColumn<AuditEntryView>[] = [
  {
    key: "action",
    header: "Action",
    primary: true,
    cell: (row) => (
      <span className="block text-cell font-semibold text-ink">
        {row.label}
        {row.detail ? ` : ${row.detail}` : ""}
      </span>
    ),
  },
  { key: "auteur", header: "Auteur", width: 180, cell: (row) => row.actorName ?? "Système" },
  { key: "date", header: "Date", width: 160, cell: (row) => formatDateTime(row.occurredAt) },
];

/** Le journal complet, filtrable et paginé côté serveur. */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "audit:read")) return <ForbiddenState />;

  const params = await searchParams;
  const group = one(params.groupe);
  const rawActor = one(params.auteur);
  const actor = rawActor && UUID.test(rawActor) ? rawActor : undefined;
  const rawFrom = one(params.du);
  const rawTo = one(params.au);
  const from = rawFrom && DATE.test(rawFrom) ? rawFrom : undefined;
  const to = rawTo && DATE.test(rawTo) ? rawTo : undefined;

  const [log, actors] = await Promise.all([
    listAuditLog(ctx, { group, actorId: actor, from, to, page: one(params.page), pageSize: 25 }),
    listAuditActors(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        subtitle={`${log.total} opérations enregistrées`}
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Journal" }]}
      >
        <FilterBar label="Filtrer par domaine">
          <FilterChip param="groupe">Tout</FilterChip>
          {AUDIT_GROUPS.map((candidate) => (
            <FilterChip key={candidate.key} param="groupe" value={candidate.key}>
              {candidate.label}
            </FilterChip>
          ))}
        </FilterBar>
        <form
          method="get"
          action="/administration/journal"
          className="anim-header flex flex-wrap items-end gap-3"
        >
          {group ? <input type="hidden" name="groupe" value={group} /> : null}
          <SelectField
            name="auteur"
            label="Auteur"
            defaultValue={actor ?? ""}
            fieldClassName="w-56"
          >
            <option value="">Tout le monde</option>
            {actors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </SelectField>
          <DateField name="du" label="Du" defaultValue={from} fieldClassName="w-44" />
          <DateField name="au" label="Au" defaultValue={to} fieldClassName="w-44" />
          <Button type="submit">Filtrer</Button>
        </form>
      </PageHeader>
      <DataTable
        caption="Journal d'audit"
        columns={columns}
        rows={log.items}
        rowKey={(row) => row.id}
        rowHeight="md"
        query={{
          pathname: "/administration/journal",
          searchParams: { groupe: group, auteur: actor, du: from, au: to },
        }}
        pagination={{ page: log.page, pageSize: log.pageSize, total: log.total }}
        empty={
          <EmptyState
            compact
            icon="shield"
            title="Aucune opération"
            description="Rien ne correspond à ces filtres."
          />
        }
      />
    </>
  );
}
