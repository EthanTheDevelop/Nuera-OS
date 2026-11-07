import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Tile } from "@/components/ui/tile";
import { paramValue } from "@/lib/url-state";
import { PortalAccessList } from "@/modules/portal/components/portal-access";
import { getPortalAccessForCompany } from "@/modules/portal/portal-access.service";
import {
  listActivitiesForCompany,
  listCompanyTimeline,
  listOpenTasksForCompany,
} from "@/modules/crm/activity.service";
import {
  getCompany,
  getCompanyFilterOptions,
  listMemberOptions,
} from "@/modules/crm/company.service";
import {
  ArchiveCompanyButton,
  MergeCompanyButton,
  RestoreCompanyButton,
} from "@/modules/crm/components/company-actions";
import { CompanyEditButton } from "@/modules/crm/components/company-form";
import { ContactsSection } from "@/modules/crm/components/record/contacts-section";
import { IdentitySection } from "@/modules/crm/components/record/identity-section";
import { NextActionsSection } from "@/modules/crm/components/record/next-actions-section";
import { NotesSection } from "@/modules/crm/components/record/notes-section";
import { OpportunitiesSection } from "@/modules/crm/components/record/opportunities-section";
import { RecordHeader } from "@/modules/crm/components/record/record-header";
import { TimelineSection } from "@/modules/crm/components/record/timeline-section";
import { loadCompanyRelated } from "@/modules/crm/company.related";
import {
  ContractsSection,
  DocumentsSection,
  FinanceSection,
  ProjectSection,
  QuotesSection,
  SitesSection,
  TicketsSection,
} from "@/modules/crm/components/record/related-sections";
import { listContactsForCompany } from "@/modules/crm/contact.service";
import { getCrmSyncStatus } from "@/modules/crm/crm.sync.service";
import { CrmSyncBanner } from "@/modules/crm/components/sync-status";
import { listOpportunitiesForCompany } from "@/modules/sales/opportunity.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Fiche client" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMELINE_PAGE_SIZE = 15;

async function loadCompany(ctx: ServiceContext, id: string) {
  if (!UUID.test(id)) notFound();
  try {
    return await getCompany(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/**
 * Fiche client (écran 04). Structure 768 + 20 + 340. Les sections d'autres domaines (projet, devis,
 * contrats, demandes, documents, site, finances) sont lues par `loadCompanyRelated`.
 */
export default async function ClientRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "crm:read")) return <ForbiddenState />;

  const { id } = await params;
  const { company, ownerName } = await loadCompany(ctx, id);
  // Fiche absorbée par une fusion : ses liens ont suivi, on mène à la gagnante.
  if (company.mergedIntoId) redirect(`/clients/${company.mergedIntoId}`);

  const raw = await searchParams;
  const pageParam = paramValue(raw, "page");
  const canSeeSales = can(ctx.actor, "sales:read");
  const canUpdate = can(ctx.actor, "crm:update");
  const canCreate = can(ctx.actor, "crm:create");
  const canMerge = can(ctx.actor, "crm:merge");
  const canArchive = can(ctx.actor, "crm:archive");
  const canCreateOpportunity = can(ctx.actor, "sales:create");
  const archived = company.archivedAt !== null;
  const canLog = canUpdate && !archived;

  const [
    contacts,
    timeline,
    tasks,
    activities,
    opportunities,
    members,
    filterOptions,
    syncStatus,
    related,
    portalAccess,
  ] = await Promise.all([
    listContactsForCompany(ctx, id, { limit: 50 }),
    listCompanyTimeline(ctx, id, {
      ...parsePagination({ page: pageParam }),
      pageSize: TIMELINE_PAGE_SIZE,
    }),
    listOpenTasksForCompany(ctx, id, { limit: 20 }),
    listActivitiesForCompany(ctx, id, { limit: 50 }),
    canSeeSales ? listOpportunitiesForCompany(ctx, id, { limit: 50 }) : [],
    canUpdate || canCreateOpportunity ? listMemberOptions(ctx) : Promise.resolve([]),
    canUpdate || canCreateOpportunity
      ? getCompanyFilterOptions(ctx)
      : Promise.resolve({ sources: [], tags: [], owners: [] }),
    getCrmSyncStatus(ctx),
    loadCompanyRelated(ctx, id),
    getPortalAccessForCompany(ctx, id),
  ]);

  const links = {
    companyId: id,
    contacts: contacts.map((contact) => ({ id: contact.id, fullName: contact.fullName })),
    opportunities: opportunities
      .filter((opportunity) => opportunity.stage !== "LOST")
      .map((opportunity) => ({ id: opportunity.id, name: opportunity.name })),
  };
  const notes = activities.filter((activity) => activity.kind === "note").slice(0, 10);

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <RecordHeader
        company={company}
        ownerName={ownerName}
        signed={opportunities.some((opportunity) => opportunity.stage === "WON")}
        actions={
          <>
            {canUpdate && !archived ? (
              <CompanyEditButton
                members={members}
                sources={filterOptions.sources}
                canMerge={canMerge}
                company={company}
              />
            ) : null}
            {can(ctx.actor, "messages:send") && !archived ? (
              <ButtonLink variant="accent" href={`/messages?client=${id}&nouvelle=1`}>
                Écrire
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <CrmSyncBanner status={syncStatus} />

      {archived ? (
        <Alert tone="warn">
          Fiche archivée : son historique reste consultable. Restaurez-la pour la modifier.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <ProjectSection section={related.projects} />
          {canSeeSales ? (
            <OpportunitiesSection
              company={{ id: company.id, name: company.name }}
              opportunities={opportunities}
              createOptions={
                canCreateOpportunity && !archived
                  ? { members, sources: filterOptions.sources, canMerge }
                  : undefined
              }
            />
          ) : null}
          <NextActionsSection
            tasks={tasks}
            opportunities={opportunities}
            links={links}
            members={members}
            canLog={canLog}
          />
          <TimelineSection
            timeline={timeline}
            pathname={`/clients/${id}`}
            query={{ page: pageParam }}
            links={links}
            members={members}
            canLog={canLog}
          />
          <QuotesSection
            section={related.quotes}
            newQuoteHref={
              can(ctx.actor, "quotes:create") && !archived
                ? `/devis?nouveau=1&client=${id}`
                : undefined
            }
          />
          <ContractsSection section={related.contracts} />
          <TicketsSection section={related.tickets} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <ContactsSection
            companyId={id}
            contacts={contacts}
            canCreate={canCreate && !archived}
            canUpdate={canUpdate && !archived}
            canMerge={canMerge}
          />
          <Tile icon="globe2" title="Espace client">
            <PortalAccessList companyId={id} overview={portalAccess} />
          </Tile>
          <DocumentsSection section={related.documents} />
          <SitesSection section={related.sites} />
          <IdentitySection company={company} />
          <NotesSection
            companyNotes={company.notes}
            notes={notes}
            links={links}
            members={members}
            canLog={canLog}
          />
          <FinanceSection margin={related.margin} invoices={related.invoices} />
          {canArchive || canMerge ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
              {canArchive ? (
                archived ? (
                  <RestoreCompanyButton companyId={id} name={company.name} />
                ) : (
                  <ArchiveCompanyButton companyId={id} name={company.name} />
                )
              ) : null}
              {canMerge && !archived ? (
                <MergeCompanyButton company={{ id, name: company.name }} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
