import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import {
  CellIdentity,
  CellMono,
  DataTable,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { TIME_CATEGORIES, TIME_CATEGORY_LABELS, type TimeCategory } from "@/lib/domain-enums";
import { formatDateShort, formatMinutes } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { addDays, monthRange, parisToday } from "@/modules/time/calendar";
import { EntryRowActions } from "@/modules/time/components/entry-row-actions";
import { MemberSelect } from "@/modules/time/components/member-select";
import { TimeEntryButton } from "@/modules/time/components/time-entry-dialog";
import {
  entryWorkLabel,
  getTimeAccess,
  getTimeEntryOptions,
  listTimeEntries,
  listTimesheetMembers,
  type TimeEntryView,
} from "@/modules/time/time.service";
import { canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Historique du temps" };

function periodRange(period: string | undefined, today: string) {
  if (period === "mois") return monthRange(today);
  if (period === "dernier") return monthRange(addDays(monthRange(today).from, -1));
  return null;
}

export default async function TimeHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["time:read", "time:create_own", "time:manage"])) {
    return <ForbiddenState />;
  }

  const params = await searchParams;
  const today = parisToday();
  const access = await getTimeAccess(ctx);
  const categoryParam = paramValue(params, "categorie");
  const category = TIME_CATEGORIES.includes(categoryParam as TimeCategory)
    ? (categoryParam as TimeCategory)
    : undefined;
  const billableParam = paramValue(params, "facturable");
  const period = periodRange(paramValue(params, "periode"), today);
  const memberId = paramValue(params, "membre");

  const [entries, members, options] = await Promise.all([
    listTimeEntries(
      ctx,
      {
        memberId,
        category,
        billable: billableParam === "oui" ? true : billableParam === "non" ? false : undefined,
        from: period?.from,
        to: period?.to,
        search: paramValue(params, "q"),
      },
      parsePagination(params),
    ),
    access.canReadAll ? listTimesheetMembers(ctx) : Promise.resolve([]),
    access.canCreateOwn || access.canManage ? getTimeEntryOptions(ctx) : Promise.resolve(null),
  ]);

  const canEdit = (entry: TimeEntryView) =>
    options !== null && (access.canManage || entry.memberId === access.ownMemberId);

  const columns: DataTableColumn<TimeEntryView>[] = [
    {
      key: "date",
      header: "DATE",
      width: 90,
      cell: (entry) => <CellMono>{formatDateShort(entry.workOn)}</CellMono>,
    },
    {
      key: "work",
      header: "TRAVAIL",
      primary: true,
      cell: (entry) => (
        <CellIdentity title={entryWorkLabel(entry)} subtitle={entry.note ?? undefined} />
      ),
    },
    { key: "member", header: "INTERVENANT", width: 140, cell: (entry) => entry.memberName },
    {
      key: "category",
      header: "CATÉGORIE",
      width: 120,
      cell: (entry) => TIME_CATEGORY_LABELS[entry.category],
    },
    {
      key: "minutes",
      header: "DURÉE",
      width: 80,
      cell: (entry) => <span className="tabular">{formatMinutes(entry.minutes)}</span>,
    },
    {
      key: "billable",
      header: "FACTURABLE",
      width: 110,
      cell: (entry) =>
        entry.billable ? (
          <Badge tone="success">Facturable</Badge>
        ) : (
          <Badge tone="neutral">Non</Badge>
        ),
    },
    ...(access.canReadCosts
      ? [
          {
            key: "cost",
            header: "COÛT",
            width: 90,
            cell: (entry: TimeEntryView) => (
              <CellMono>
                {entry.costCents === undefined ? "—" : formatCents(entry.costCents)}
              </CellMono>
            ),
          },
        ]
      : []),
    ...(options
      ? [
          {
            key: "actions",
            header: "ACTIONS",
            width: 170,
            cell: (entry: TimeEntryView) =>
              canEdit(entry) && options ? (
                <EntryRowActions entry={entry} options={options} today={today} />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Historique du temps"
        subtitle={`${entries.total} saisie${entries.total > 1 ? "s" : ""}${access.canReadAll ? "" : " · votre temps"}`}
        breadcrumbs={[{ label: "Temps et capacité", href: "/temps" }, { label: "Historique" }]}
        actions={
          options && (access.ownMemberId || access.canManage) ? (
            <TimeEntryButton options={options} today={today} variant="accent" />
          ) : undefined
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Client, projet, note…" label="Période">
          <FilterChip param="periode">Tout</FilterChip>
          <FilterChip param="periode" value="mois">
            Ce mois
          </FilterChip>
          <FilterChip param="periode" value="dernier">
            Mois dernier
          </FilterChip>
        </FilterBar>
        <FilterBar label="Catégorie et facturation">
          <FilterChip param="categorie">Toutes</FilterChip>
          {TIME_CATEGORIES.map((item) => (
            <FilterChip key={item} param="categorie" value={item}>
              {TIME_CATEGORY_LABELS[item]}
            </FilterChip>
          ))}
          <FilterChip param="facturable" value="oui">
            Facturable
          </FilterChip>
          <FilterChip param="facturable" value="non">
            Non facturable
          </FilterChip>
          {members.length > 0 ? (
            <MemberSelect members={members} value={memberId} allLabel="Toute l'équipe" />
          ) : null}
        </FilterBar>
      </PageHeader>

      <DataTable
        columns={columns}
        rows={entries.items}
        rowKey={(entry) => entry.id}
        caption="Historique du temps"
        query={{ pathname: "/temps/historique", searchParams: params }}
        pagination={entries}
        empty={
          <EmptyState
            icon="clock"
            title="Aucune saisie"
            description="Aucune saisie ne correspond à ces filtres."
          />
        }
      />
    </>
  );
}
