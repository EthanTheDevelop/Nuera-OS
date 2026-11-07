import type { Metadata } from "next";
import Link from "next/link";
import {
  PORTAL_FILL,
  PORTAL_PAGE,
  PORTAL_SCROLL,
  PortalCard,
  PortalPageHeader,
} from "@/components/portal/portal-card";
import { EmptyState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { TICKET_CATEGORY_LABELS } from "@/lib/domain-enums";
import { PortalPageTip } from "@/modules/portal/components/page-tip";
import { NewTicketButton } from "@/modules/portal/components/ticket-forms";
import { clientTicketStatus, ticketDateLabel } from "@/modules/portal/portal.format";
import { requirePortalPage } from "@/modules/portal/portal.page";
import { listSitesForPortal } from "@/modules/sites/site.portal";
import { listTicketsForPortal } from "@/modules/support/ticket.service";

export const metadata: Metadata = { title: "Mes demandes" };

/** Domaine 11.03 : ouvrir, suivre, retrouver l'historique. Sans maquette, dans le langage de C7. */
export default async function PortalTicketsPage() {
  const ctx = await requirePortalPage();
  const [tickets, sites] = await Promise.all([listTicketsForPortal(ctx), listSitesForPortal(ctx)]);
  const siteOptions = sites.map(({ id, name }) => ({ id, name }));

  return (
    <div className={PORTAL_PAGE}>
      <PortalPageTip tip="demandes" />
      <PortalPageHeader
        title="Mes demandes"
        subtitle="Ce que vous nous avez demandé, où cela en est, et nos réponses"
        actions={<NewTicketButton sites={siteOptions} />}
      />
      {tickets.length === 0 ? (
        <EmptyState
          icon="support"
          title="Aucune demande pour l'instant"
          description="Une question, un souci, une modification : ouvrez une demande, vous suivez ici son avancement."
        />
      ) : (
        <PortalCard className={PORTAL_FILL}>
          <ul
            className={`flex flex-col min-[1800px]:grid-cols-2 min-[1800px]:gap-x-10 lg:grid lg:auto-rows-[minmax(max-content,14dvh)] lg:content-start ${PORTAL_SCROLL}`}
          >
            {tickets.map((ticket) => {
              const status = clientTicketStatus(ticket.status);
              return (
                <li
                  key={ticket.id}
                  className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0 min-[1800px]:nth-2:border-t-0 min-[1800px]:nth-2:pt-0"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <Link
                      href={`/espace/demandes/${ticket.id}`}
                      className="block truncate text-base font-semibold text-ink after:absolute after:inset-0"
                    >
                      {ticket.subject}
                    </Link>
                    <p className="text-sm text-muted">
                      {[
                        ticket.number,
                        TICKET_CATEGORY_LABELS[ticket.category],
                        ticket.siteName,
                        ticketDateLabel(ticket),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </li>
              );
            })}
          </ul>
        </PortalCard>
      )}
    </div>
  );
}
