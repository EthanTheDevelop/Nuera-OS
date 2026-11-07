import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { initialsOf } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import {
  getCompanyFilterOptions,
  getCompanySummary,
  listCompanies,
  listMemberOptions,
  type CompanyListRow,
} from "@/modules/crm/company.service";
import { CompanyCreateButton } from "@/modules/crm/components/company-form";
import { FilterSelect } from "@/modules/crm/components/filter-select";
import { ImportButton } from "@/modules/crm/components/import-modal";
import { CrmSyncBanner, CrmSyncFootnote } from "@/modules/crm/components/sync-status";
import { getCrmSyncStatus } from "@/modules/crm/crm.sync.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Clients" };

const PATH = "/clients";

function count(value: number, one: string, many: string) {
  return `${value} ${value > 1 ? many : one}`;
}

const columns: DataTableColumn<CompanyListRow>[] = [
  {
    key: "client",
    header: "Client",
    primary: true,
    sortable: true,
    cell: ({ company, contactName }) => (
      <CellIdentity
        name={company.name}
        title={company.name}
        subtitle={[contactName, company.activity].filter(Boolean).join(" · ") || null}
      />
    ),
  },
  {
    key: "status",
    header: "Statut",
    width: 140,
    cell: ({ company, leadOpportunity }) => {
      if (company.archivedAt) return <Badge>Archivé</Badge>;
      // Maquette : un prospect dont le devis est parti se lit « Devis envoyé ».
      if (company.status === "prospect" && leadOpportunity?.stage === "QUOTE_SENT") {
        return <StatusBadge kind="opportunity" status="QUOTE_SENT" />;
      }
      return <StatusBadge kind="company" status={company.status} />;
    },
  },
  {
    key: "project",
    header: "Projet",
    width: 170,
    hideWhenCollapsed: true,
    cell: ({ leadOpportunity }) => (
      <span className="block truncate" title={leadOpportunity?.name ?? undefined}>
        {leadOpportunity?.name ?? "—"}
      </span>
    ),
  },
  {
    key: "montant",
    header: "Montant",
    width: 130,
    sortable: true,
    cell: ({ leadOpportunity }) =>
      leadOpportunity?.amountCents == null ? "—" : formatCents(leadOpportunity.amountCents),
  },
  {
    key: "origine",
    header: "Origine",
    width: 120,
    sortable: true,
    hideWhenCollapsed: true,
    cell: ({ company }) => <span className="block truncate">{company.source ?? "—"}</span>,
  },
  {
    key: "owner",
    header: "Associé",
    width: 80,
    hideWhenCollapsed: true,
    cell: ({ ownerName }) =>
      ownerName ? (
        <span title={ownerName} aria-label={ownerName}>
          {initialsOf(ownerName)}
        </span>
      ) : (
        "—"
      ),
  },
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "crm:read")) return <ForbiddenState />;

  const raw = await searchParams;
  const params = {
    statut: paramValue(raw, "statut"),
    q: paramValue(raw, "q"),
    origine: paramValue(raw, "origine"),
    responsable: paramValue(raw, "responsable"),
    tag: paramValue(raw, "tag"),
    tri: paramValue(raw, "tri"),
    sens: paramValue(raw, "sens"),
    page: paramValue(raw, "page"),
  };
  const canCreate = can(ctx.actor, "crm:create");
  const canMerge = can(ctx.actor, "crm:merge");

  const [{ items, total, page, pageSize }, summary, filters, members, syncStatus] =
    await Promise.all([
      listCompanies(ctx, params),
      getCompanySummary(ctx),
      getCompanyFilterOptions(ctx),
      canCreate ? listMemberOptions(ctx) : Promise.resolve([]),
      getCrmSyncStatus(ctx),
    ]);

  const filtered = Boolean(
    params.q || params.statut || params.origine || params.responsable || params.tag,
  );

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        title="Clients"
        subtitle={[
          count(summary.clients, "client", "clients"),
          count(summary.activeProspects, "prospect actif", "prospects actifs"),
          count(summary.subscribers, "abonné", "abonnés"),
        ].join(" · ")}
        className="mb-0 lg:mb-0"
        actions={
          canCreate ? (
            <>
              <ImportButton />
              <CompanyCreateButton
                members={members}
                sources={filters.sources}
                canMerge={canMerge}
              />
            </>
          ) : null
        }
      >
        <FilterBar searchParam="q" label="Filtrer les clients">
          <FilterChip param="statut">Tous</FilterChip>
          <FilterChip param="statut" value="client">
            Clients
          </FilterChip>
          <FilterChip param="statut" value="prospect">
            Prospects
          </FilterChip>
          <FilterChip param="statut" value="subscriber">
            Abonnés
          </FilterChip>
          <FilterChip param="statut" value="former">
            Anciens
          </FilterChip>
          <FilterChip param="statut" value="partner">
            Partenaires
          </FilterChip>
          <FilterChip param="statut" value="archived">
            Archivés
          </FilterChip>
        </FilterBar>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FilterSelect
              param="origine"
              label="Origine"
              allLabel="Toutes les origines"
              options={filters.sources.map((value) => ({ value, label: value }))}
            />
            <FilterSelect
              param="responsable"
              label="Associé référent"
              allLabel="Tous les associés"
              options={filters.owners.map((owner) => ({ value: owner.id, label: owner.fullName }))}
            />
            <FilterSelect
              param="tag"
              label="Étiquette"
              allLabel="Toutes les étiquettes"
              options={filters.tags.map((value) => ({ value, label: value }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CompactLink variant="quiet" href="/clients/contacts">
              Annuaire des contacts
            </CompactLink>
            <CompactLink variant="quiet" href="/clients/doublons">
              Doublons
            </CompactLink>
          </div>
        </div>
      </PageHeader>

      <CrmSyncBanner status={syncStatus} />

      <DataTable
        caption="Clients"
        columns={columns}
        rows={items}
        rowKey={({ company }) => company.id}
        rowHref={({ company }) => `/clients/${company.id}`}
        rowHeight="lg"
        query={{ pathname: PATH, searchParams: params }}
        pagination={total > pageSize ? { page, pageSize, total } : undefined}
        empty={
          <EmptyState
            compact
            icon="clients"
            title={filtered ? "Aucun client ne correspond" : "Aucun client pour l'instant"}
            description={
              filtered
                ? "Essayez un autre terme ou levez un filtre."
                : "Créez une première fiche ou importez un fichier CSV."
            }
          />
        }
      />

      <CrmSyncFootnote status={syncStatus} />
    </div>
  );
}
