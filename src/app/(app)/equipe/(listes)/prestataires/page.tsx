import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { FilterBar } from "@/components/ui/filter-bar";
import { paramValue } from "@/lib/url-state";
import { ContractorTable } from "@/modules/team/components/contractor-table";
import { MemberFormButton } from "@/modules/team/components/member-form";
import { getTeamAccess, listContractors } from "@/modules/team/team.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Prestataires" };

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) return <ForbiddenState />;

  const params = await searchParams;
  const access = getTeamAccess(ctx);
  const contractors = await listContractors(
    ctx,
    { search: paramValue(params, "q") },
    parsePagination(params),
  );

  return (
    <>
      <PageHeader
        title="Prestataires"
        subtitle={`${contractors.total} prestataire${contractors.total > 1 ? "s" : ""} · spécialités, conditions et historique`}
        breadcrumbs={[{ label: "Équipe", href: "/equipe" }, { label: "Prestataires" }]}
        actions={
          access.canManage ? (
            <MemberFormButton
              showCosts={access.canReadCosts}
              label="Ajouter une fiche"
              defaultKind="contractor"
              variant="accent"
            />
          ) : undefined
        }
      >
        <FilterBar searchParam="q" searchPlaceholder="Nom, spécialité, compétence…" />
      </PageHeader>

      <ContractorTable
        contractors={contractors.items}
        showCosts={access.canReadCosts}
        query={{ pathname: "/equipe/prestataires", searchParams: params }}
        pagination={contractors}
        empty={
          <EmptyState
            icon="equipe"
            title="Aucun prestataire"
            description="Aucune fiche ne correspond à cette recherche."
          />
        }
      />
    </>
  );
}
