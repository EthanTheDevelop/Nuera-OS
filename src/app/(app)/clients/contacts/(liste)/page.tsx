import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { CONTACT_ROLE_LABELS, CONTACT_ROLES } from "@/lib/domain-enums";
import { paramValue } from "@/lib/url-state";
import { ContactFormButton } from "@/modules/crm/components/contact-form";
import { listContactDirectory, type ContactDirectoryRow } from "@/modules/crm/contact.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Contacts" };

const PATH = "/clients/contacts";

const columns: DataTableColumn<ContactDirectoryRow>[] = [
  {
    key: "contact",
    header: "Contact",
    primary: true,
    cell: (row) => (
      <CellIdentity
        name={row.fullName || row.email || "?"}
        title={row.fullName || "Sans nom"}
        subtitle={row.jobTitle}
      />
    ),
  },
  {
    key: "company",
    header: "Client",
    width: 200,
    cell: (row) => <span className="block truncate">{row.companyName ?? "—"}</span>,
  },
  {
    key: "email",
    header: "E-mail",
    width: 240,
    cell: (row) => <span className="block truncate">{row.email ?? "—"}</span>,
  },
  {
    key: "roles",
    header: "Rôles",
    width: 200,
    hideWhenCollapsed: true,
    cell: (row) =>
      row.archivedAt ? (
        <Badge>Archivé</Badge>
      ) : row.roles.length === 0 ? (
        "—"
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.roles.map((role) => (
            <Badge key={role}>{CONTACT_ROLE_LABELS[role]}</Badge>
          ))}
        </span>
      ),
  },
];

/** Annuaire (02.02.01) : tous les interlocuteurs, avec leur organisation et leurs rôles. */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "crm:read")) return <ForbiddenState />;

  const raw = await searchParams;
  const params = {
    q: paramValue(raw, "q"),
    role: paramValue(raw, "role"),
    archives: paramValue(raw, "archives"),
    page: paramValue(raw, "page"),
  };
  const { items, total, page, pageSize } = await listContactDirectory(ctx, params);
  const filtered = Boolean(params.q || params.role || params.archives);

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: "Contacts" }]}
        title="Contacts"
        subtitle={`${total} ${total > 1 ? "personnes" : "personne"}`}
        className="mb-0 lg:mb-0"
        actions={
          can(ctx.actor, "crm:create") ? (
            <ContactFormButton
              companyId={null}
              companyChoice={{ company: null }}
              canMerge={can(ctx.actor, "crm:merge")}
              label="Nouveau contact"
              variant="secondary"
            />
          ) : null
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Nom ou e-mail…" label="Filtrer les contacts">
          <FilterChip param="role">Tous</FilterChip>
          {CONTACT_ROLES.map((role) => (
            <FilterChip key={role} param="role" value={role}>
              {CONTACT_ROLE_LABELS[role]}
            </FilterChip>
          ))}
          <FilterChip param="archives" value="1">
            Archivés
          </FilterChip>
        </FilterBar>
      </PageHeader>

      <DataTable
        caption="Contacts"
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        rowHref={(row) => `/clients/contacts/${row.id}`}
        rowHeight="lg"
        query={{ pathname: PATH, searchParams: params }}
        pagination={total > pageSize ? { page, pageSize, total } : undefined}
        empty={
          <EmptyState
            compact
            icon="clients"
            title={filtered ? "Aucun contact ne correspond" : "Aucun contact pour l'instant"}
            description={
              filtered
                ? "Essayez un autre terme ou levez un filtre."
                : "Ajoutez un contact ici ou depuis une fiche client."
            }
          />
        }
      />
    </div>
  );
}
