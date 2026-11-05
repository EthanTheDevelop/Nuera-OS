import type { Metadata } from "next";
import Link from "next/link";
import { PortalCard, PortalPageHeader } from "@/components/portal/portal-card";
import { EmptyState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { formatDateShort, formatMinutes } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue } from "@/lib/url-state";
import { SiteChangeRequest } from "@/modules/portal/components/site-change";
import { NewTicketButton } from "@/modules/portal/components/ticket-forms";
import {
  clientTicketStatus,
  formatDayMonth,
  ticketDateLabel,
} from "@/modules/portal/portal.format";
import { loadPortalHome, requirePortalPage } from "@/modules/portal/portal.page";
import { getPortalSitePage } from "@/modules/portal/portal.service";
import type { PortalSite } from "@/modules/sites/site.portal";

export const metadata: Metadata = { title: "Mon site" };

const SITE_STATUS: Record<PortalSite["status"], string> = {
  planned: "à venir",
  staging: "en préproduction",
  live: "en ligne",
  paused: "en pause",
};

const PERIOD = { monthly: "par mois", quarterly: "par trimestre", yearly: "par an" } as const;

/** Note C7 : une demande qui vient de partir entre en haut de la liste. */
const isJustSent = (at: Date) => Date.now() - at.getTime() < 60_000;

function siteSubtitle(site: PortalSite, plannedOn: string | null | undefined): string {
  const goLive = site.liveOn ?? plannedOn;
  return [
    site.primaryDomain ?? site.name,
    SITE_STATUS[site.status],
    goLive ? `mise en ligne le ${formatDayMonth(goLive)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Écran C7. Une demande envoyée arrive côté agence comme une carte « Reçue » (écran 11). */
export default async function PortalSitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePortalPage();
  const query = await searchParams;
  const [{ sites, site, tickets, contracts }, home] = await Promise.all([
    getPortalSitePage(ctx, paramValue(query, "site")),
    loadPortalHome(),
  ]);
  const plannedOn = home.projects.find((project) => project.id === site?.projectId)?.dueOn;

  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title="Mon site"
        subtitle={site ? siteSubtitle(site, plannedOn) : undefined}
        actions={
          site?.url ? (
            <CompactLink icon="globe2" href={site.url} target="_blank" rel="noopener">
              Voir mon site
            </CompactLink>
          ) : null
        }
      />
      {sites.length > 1 ? (
        <nav aria-label="Mes sites" className="flex flex-wrap gap-2">
          {sites.map((row) => (
            <Link
              key={row.id}
              href={`/espace/mon-site?site=${row.id}`}
              aria-current={row.id === site?.id ? "true" : undefined}
              className={`hit-44 rounded-full px-3 py-1 text-sm ${row.id === site?.id ? "bg-accent-pale font-medium text-accent" : "text-muted hover:text-ink"}`}
            >
              {row.primaryDomain ?? row.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,856fr)_minmax(0,480fr)]">
        {site ? (
          <PortalCard
            title="Modifier mon site"
            description="Dites-nous quel texte ou quelle photo changer et par quoi : nous l'appliquons. Le design reste protégé."
            className="gap-4"
          >
            <SiteChangeRequest siteId={site.id} />
          </PortalCard>
        ) : (
          <EmptyState
            icon="sites"
            title="Votre site n'est pas encore ici"
            description="Il apparaîtra dès sa mise en préproduction. En attendant, vous pouvez nous écrire ou ouvrir une demande."
          />
        )}
        <div className="flex min-w-0 flex-col gap-6">
          <PortalCard title="Mes demandes" className="gap-4">
            {tickets.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {tickets.slice(0, 5).map((ticket) => {
                  const status = clientTicketStatus(ticket.status);
                  return (
                    <li
                      key={ticket.id}
                      className={`relative flex items-center gap-3 ${
                        isJustSent(ticket.createdAt) ? "anim-enter-8" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/espace/demandes/${ticket.id}`}
                          className="block truncate text-base font-semibold text-ink after:absolute after:inset-0"
                        >
                          {ticket.subject}
                        </Link>
                        <p className="text-sm text-muted">{ticketDateLabel(ticket)}</p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">Aucune demande pour l&apos;instant.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <NewTicketButton
                variant="secondary"
                sites={sites.map(({ id, name }) => ({ id, name }))}
              />
              {tickets.length > 0 ? (
                <CompactLink variant="quiet" href="/espace/demandes">
                  Toutes mes demandes
                </CompactLink>
              ) : null}
            </div>
          </PortalCard>
          <PortalCard title="Hébergement et maintenance" className="gap-3">
            {contracts.length > 0 ? (
              contracts.map((contract) => (
                <div key={contract.id} className="flex flex-col gap-1.5">
                  <p className="text-base font-semibold text-ink">{contract.name}</p>
                  <p className="text-sm text-muted">
                    {formatCents(contract.priceCents)} HT {PERIOD[contract.period]}
                    {contract.nextDueOn
                      ? ` · échéance le ${formatDateShort(contract.nextDueOn)}`
                      : ""}
                  </p>
                  {contract.scope ? <p className="text-sm text-muted">{contract.scope}</p> : null}
                  {contract.exclusions ? (
                    <p className="text-sm text-muted">Non inclus : {contract.exclusions}</p>
                  ) : null}
                  {contract.responseHours ? (
                    <p className="text-sm text-muted">
                      Réponse sous {contract.responseHours} h
                      {contract.resolutionHours
                        ? `, résolution sous ${contract.resolutionHours} h`
                        : ""}
                    </p>
                  ) : null}
                  {contract.consumption.includedMinutes ? (
                    <p className="text-sm text-muted">
                      {formatMinutes(contract.consumption.consumedMinutes)} utilisées sur{" "}
                      {formatMinutes(contract.consumption.includedMinutes)} sur la période
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">Aucun contrat actif pour l&apos;instant.</p>
            )}
            <p className="text-sm text-muted">
              Votre domaine reste à votre nom, votre site et son code vous appartiennent.
            </p>
          </PortalCard>
        </div>
      </div>
    </div>
  );
}
