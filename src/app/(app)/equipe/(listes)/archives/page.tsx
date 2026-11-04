import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { CellIdentity, DataTable } from "@/components/ui/data-table";
import { MEMBER_KIND_LABELS } from "@/lib/domain-enums";
import { formatDate } from "@/lib/format";
import { listTeamMembers } from "@/modules/team/team.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Membres archivés" };

export default async function ArchivedMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) return <ForbiddenState />;

  const params = await searchParams;
  const members = await listTeamMembers(ctx, { archived: true }, parsePagination(params));

  return (
    <>
      <PageHeader
        title="Membres archivés"
        subtitle={`${members.total} fiche${members.total > 1 ? "s" : ""} · à restaurer depuis la fiche`}
        breadcrumbs={[{ label: "Équipe", href: "/equipe" }, { label: "Archives" }]}
      />
      <DataTable
        columns={[
          {
            key: "name",
            header: "MEMBRE",
            primary: true,
            cell: (member) => (
              <CellIdentity
                name={member.fullName}
                title={member.fullName}
                subtitle={member.title ?? undefined}
                avatarSize={28}
              />
            ),
          },
          {
            key: "kind",
            header: "TYPE",
            width: 160,
            cell: (member) => MEMBER_KIND_LABELS[member.kind],
          },
          {
            key: "archived",
            header: "ARCHIVÉ LE",
            width: 160,
            cell: (member) => formatDate(member.archivedAt),
          },
        ]}
        rows={members.items}
        rowKey={(member) => member.id}
        rowHref={(member) => `/equipe/${member.id}`}
        caption="Membres archivés"
        query={{ pathname: "/equipe/archives", searchParams: params }}
        pagination={members}
        empty={<EmptyState icon="equipe" title="Aucun membre archivé" />}
      />
    </>
  );
}
