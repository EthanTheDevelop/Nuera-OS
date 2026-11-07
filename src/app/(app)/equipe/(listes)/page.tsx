import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { DataTablePagination } from "@/components/ui/data-table";
import { InfoCard } from "@/components/ui/info-card";
import { MEMBER_KIND_LABELS, type MemberKind } from "@/lib/domain-enums";
import { formatCents } from "@/lib/money";
import { ContractorTable } from "@/modules/team/components/contractor-table";
import { MemberCard } from "@/modules/team/components/member-card";
import { MemberFormButton } from "@/modules/team/components/member-form";
import { MissionFormButton } from "@/modules/team/components/mission-form";
import { MissionTable } from "@/modules/team/components/mission-table";
import {
  getMissionFormOptions,
  getTeamAccess,
  getTeamOverview,
  listTeamMembers,
} from "@/modules/team/team.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Équipe" };

const PAGE_SIZE = 12;

function kindCount(kind: MemberKind, count: number): string | null {
  if (count === 0) return null;
  const label = MEMBER_KIND_LABELS[kind].toLocaleLowerCase("fr-FR");
  return `${count} ${label}${count > 1 ? "s" : ""}`;
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="anim-content text-right">
      <Link
        href={href}
        className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        {children}
      </Link>
    </p>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "team:read")) {
    return <ForbiddenState />;
  }

  const params = await searchParams;
  const access = getTeamAccess(ctx);
  const page = parsePagination(params, { defaultPageSize: PAGE_SIZE, maxPageSize: PAGE_SIZE });
  const [overview, options, archived] = await Promise.all([
    getTeamOverview(ctx, { page }),
    access.canManage ? getMissionFormOptions(ctx) : Promise.resolve(null),
    access.canManage
      ? listTeamMembers(ctx, { archived: true }, { page: 1, pageSize: 1 })
      : Promise.resolve(null),
  ]);

  const summary = [
    kindCount("partner", overview.counts.partner),
    kindCount("employee", overview.counts.employee),
    kindCount("contractor", overview.counts.contractor),
  ]
    .filter(Boolean)
    .join(", ");

  // Les fiches affichées incluent les membres inactifs, que les compteurs ne comptent pas.
  const inactive = Math.max(
    0,
    overview.members.total - overview.counts.partner - overview.counts.employee,
  );
  const inactiveNote =
    inactive > 0
      ? ` (+ ${inactive} fiche${inactive > 1 ? "s" : ""} inactive${inactive > 1 ? "s" : ""} non comptée${inactive > 1 ? "s" : ""})`
      : "";

  return (
    <>
      <PageHeader
        title="Équipe"
        subtitle={`${summary || "Aucun membre actif"}${inactiveNote} · qui fait quoi, et qui est disponible`}
        actions={
          access.canManage && options ? (
            <>
              <MemberFormButton
                showCosts={access.canReadCosts}
                label="Ajouter un membre"
                variant="default"
              />
              <MissionFormButton
                options={options}
                showCosts={access.canReadCosts}
                label="Affecter une mission"
              />
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-(--grid-gap)">
        {overview.members.items.length === 0 ? (
          <div className="anim-content rounded-lg bg-surface shadow-soft">
            <EmptyState
              icon="equipe"
              title="Aucune fiche interne"
              description={
                access.canManage
                  ? "Ajoutez la première fiche : sa capacité alimente le planning."
                  : "Les fiches apparaîtront ici dès qu'un compte Associé les aura créées."
              }
            />
          </div>
        ) : (
          <>
            <div className="grid gap-(--grid-gap) lg:grid-cols-2 2xl:grid-cols-(--cols-cards)">
              {overview.members.items.map((card, index) => (
                <MemberCard key={card.member.id} card={card} index={index} />
              ))}
            </div>
            {overview.members.total > overview.members.pageSize ? (
              <DataTablePagination
                query={{ pathname: "/equipe", searchParams: params }}
                {...overview.members}
                className="rounded-lg bg-surface shadow-soft"
              />
            ) : null}
          </>
        )}

        <div className="flex flex-col gap-2">
          <MissionTable
            missions={overview.missions.items}
            showCosts={access.canReadCosts}
            caption="Missions ouvertes"
            empty={
              <EmptyState
                compact
                icon="flag"
                title="Aucune mission ouverte"
                description={access.canManage ? "« Affecter une mission » en crée une." : undefined}
              />
            }
          />
          {overview.missions.total > overview.missions.items.length ? (
            <SeeAll href="/equipe/missions">
              {`Toutes les missions ouvertes (${overview.missions.total})`}
            </SeeAll>
          ) : (
            <SeeAll href="/equipe/missions?statut=delivered">Historique des missions</SeeAll>
          )}
        </div>

        <InfoCard
          icon="equipe"
          title="Sous-traitants"
          aside={
            <Badge tone={overview.counts.contractor > 0 ? "accent" : "neutral"}>
              {overview.counts.contractor} actif{overview.counts.contractor > 1 ? "s" : ""}
            </Badge>
          }
        >
          {overview.subcontracting && overview.contractors.total > 0 ? (
            <p className="tabular text-sm text-muted">
              Coûts de sous-traitance : {formatCents(overview.subcontracting.plannedCostCents)}{" "}
              prévus, {formatCents(overview.subcontracting.committedCostCents)} engagés.
            </p>
          ) : null}
          {overview.contractors.items.length === 0 ? (
            <EmptyState
              compact
              icon="equipe"
              title="Aucun prestataire"
              description={
                access.canManage
                  ? "Une fiche de type Prestataire porte sa spécialité, ses conditions et son historique."
                  : undefined
              }
            />
          ) : (
            <ContractorTable
              contractors={overview.contractors.items}
              showCosts={access.canReadCosts}
              className="shadow-none"
            />
          )}
          <p className="text-right">
            <Link
              href="/equipe/prestataires"
              className="hit-44 text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              Annuaire des prestataires
            </Link>
          </p>
        </InfoCard>

        {archived && archived.total > 0 ? (
          <SeeAll href="/equipe/archives">Membres archivés ({archived.total})</SeeAll>
        ) : null}
      </div>
    </>
  );
}
