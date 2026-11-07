import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, StatusBadge, type StatusKind } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { Icon, type IconName } from "@/components/ui/icon";
import { InfoCard } from "@/components/ui/info-card";
import { StepTimeline, type StepState } from "@/components/ui/step-timeline";
import { Tile } from "@/components/ui/tile";
import { CMS_KIND_LABELS } from "@/lib/domain-enums";
import { formatDate, formatDateShort } from "@/lib/format";
import { formatCents, formatCentsHT } from "@/lib/money";
import { formatPricePerPeriod } from "@/modules/contracts/contract.format";
import type { CompanyRelated, RelatedSection } from "../../company.related";

const UNAVAILABLE = "Données indisponibles pour l'instant : le reste de la fiche reste à jour.";

/** Ligne de section : un lien, un détail, un état à droite. Un seul dessin pour toute la fiche. */
function RelatedRow({
  href,
  title,
  detail,
  aside,
}: {
  href: string;
  title: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-48">
        <Link
          href={href}
          className="hit-44 block truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
        >
          {title}
        </Link>
        {detail ? <p className="truncate text-xs text-muted">{detail}</p> : null}
      </div>
      {aside}
    </li>
  );
}

function SectionBody<T>({
  section,
  empty,
  children,
}: {
  section: Extract<RelatedSection<readonly T[]>, { state: "ready" | "unavailable" }>;
  empty: string;
  children: (rows: readonly T[]) => ReactNode;
}) {
  if (section.state === "unavailable") return <p className="text-sm text-muted">{UNAVAILABLE}</p>;
  if (section.data.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return <ul className="flex flex-col divide-y divide-border">{children(section.data)}</ul>;
}

function RowsTile<T>({
  section,
  icon,
  title,
  empty,
  aside,
  renderRow,
}: {
  section: RelatedSection<readonly T[]>;
  icon: IconName;
  title: string;
  empty: string;
  aside?: ReactNode;
  renderRow: (row: T) => ReactNode;
}) {
  if (section.state === "absent") return null;
  return (
    <Tile icon={icon} title={title} aside={aside} className="rounded-lg p-6">
      <SectionBody section={section} empty={empty}>
        {(rows) => rows.map(renderRow)}
      </SectionBody>
    </Tile>
  );
}

const PHASE_STATE: Record<string, StepState> = {
  done: "done",
  in_progress: "current",
  todo: "todo",
};

/** Projet · frise de l'écran 04, sur le projet le plus récent ; les autres en lignes dessous. */
export function ProjectSection({ section }: { section: CompanyRelated["projects"] }) {
  if (section.state === "absent") return null;
  if (section.state === "unavailable") {
    return (
      <Tile icon="projets" title="Projet" className="rounded-lg p-6">
        <p className="text-sm text-muted">{UNAVAILABLE}</p>
      </Tile>
    );
  }
  const [lead, ...others] = section.data.rows;
  if (!lead) {
    return (
      <Tile icon="projets" title="Projet" className="rounded-lg p-6">
        <p className="text-sm text-muted">
          Aucun projet : il naît de l&apos;acceptation d&apos;un devis.
        </p>
      </Tile>
    );
  }
  const steps = section.data.leadPhases.map((phase) => {
    const state = PHASE_STATE[phase.status] ?? "todo";
    return {
      id: phase.id,
      title: phase.name,
      state,
      detail: state === "done" ? "fait" : state === "current" ? "en cours" : undefined,
    };
  });
  const facts = [
    {
      label: "Montant",
      value: lead.budgetCents === null ? "—" : formatCentsHT(lead.budgetCents),
    },
    { label: "Avancement", value: `${lead.progressPercent} %` },
    {
      label: lead.deliveredOn ? "Mise en ligne" : "Échéance",
      value:
        lead.deliveredOn || lead.dueOn
          ? formatDate((lead.deliveredOn ?? lead.dueOn) as string)
          : "—",
    },
  ];
  return (
    <Tile
      icon="projets"
      title={
        <Link
          href={`/projets/${lead.id}`}
          className="hit-44 hover:underline hover:underline-offset-4"
        >
          Projet · {lead.offer}
        </Link>
      }
      aside={
        lead.stage && lead.stepCount > 0 ? (
          <Badge tone="accent">
            Étape {lead.stage.index} / {lead.stepCount}
          </Badge>
        ) : (
          <StatusBadge kind="project" status={lead.status} />
        )
      }
      className="rounded-lg p-6"
    >
      {steps.length > 0 ? <StepTimeline label="Étapes du projet" steps={steps} /> : null}
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-xs text-muted">{fact.label}</dt>
            <dd className="tabular text-sm font-semibold text-text">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {others.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border border-t border-border pt-3">
          {others.map((project) => (
            <RelatedRow
              key={project.id}
              href={`/projets/${project.id}`}
              title={`${project.number} · ${project.offer}`}
              detail={project.stage?.name}
              aside={<StatusBadge kind="project" status={project.status} />}
            />
          ))}
        </ul>
      ) : null}
    </Tile>
  );
}

export function QuotesSection({
  section,
  newQuoteHref,
}: {
  section: CompanyRelated["quotes"];
  newQuoteHref?: string;
}) {
  return (
    <RowsTile
      section={section}
      icon="devis"
      title="Devis"
      empty="Aucun devis pour ce client."
      aside={
        newQuoteHref ? (
          <CompactLink variant="quiet" icon="plus" href={newQuoteHref}>
            Nouveau devis
          </CompactLink>
        ) : null
      }
      renderRow={(quote) => (
        <RelatedRow
          key={quote.id}
          href={`/devis/${quote.id}`}
          title={`${quote.number} · ${quote.title}`}
          detail={quote.sentAt ? `Envoyé le ${formatDateShort(quote.sentAt)}` : undefined}
          aside={
            <>
              <span className="tabular text-sm text-text">
                {quote.totalCents === null ? "—" : formatCentsHT(quote.totalCents)}
              </span>
              <StatusBadge kind="quote" status={quote.status} />
            </>
          }
        />
      )}
    />
  );
}

export function ContractsSection({ section }: { section: CompanyRelated["contracts"] }) {
  return (
    <RowsTile
      section={section}
      icon="contrat"
      title="Contrats"
      empty="Aucun contrat pour ce client."
      renderRow={(contract) => (
        <RelatedRow
          key={contract.id}
          href={`/contrats/${contract.id}`}
          title={`${contract.number} · ${contract.name}`}
          detail={
            contract.nextDueOn ? `Échéance ${formatDateShort(contract.nextDueOn)}` : undefined
          }
          aside={
            <>
              <span className="tabular text-sm text-text">
                {formatPricePerPeriod(contract.priceCents, contract.period)}
              </span>
              <StatusBadge kind="contract" status={contract.status} />
            </>
          }
        />
      )}
    />
  );
}

export function TicketsSection({ section }: { section: CompanyRelated["tickets"] }) {
  return (
    <RowsTile
      section={section}
      icon="support"
      title="Demandes"
      empty="Aucune demande pour ce client."
      renderRow={(ticket) => (
        <RelatedRow
          key={ticket.id}
          href={ticket.href}
          title={`${ticket.number} · ${ticket.subject}`}
          detail={ticket.siteName ?? undefined}
          aside={<StatusBadge kind="ticket" status={ticket.status} />}
        />
      )}
    />
  );
}

export function DocumentsSection({ section }: { section: CompanyRelated["documents"] }) {
  if (section.state === "absent") return null;
  return (
    <Tile icon="devis" title="Documents" className="rounded-lg p-6">
      {section.state === "unavailable" ? (
        <p className="text-sm text-muted">{UNAVAILABLE}</p>
      ) : section.data.length === 0 ? (
        <p className="text-sm text-muted">Aucun document pour ce client.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {section.data.map((document) => (
            <li key={document.id}>
              <Link
                href={`/documents/${document.id}`}
                className="hit-44 flex min-w-0 items-center gap-2 text-sm text-text hover:underline hover:underline-offset-4"
              >
                <Icon name="devis" size={16} className="shrink-0 text-accent" />
                <span className="truncate">{document.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

export function SitesSection({ section }: { section: CompanyRelated["sites"] }) {
  if (section.state === "absent") return null;
  return (
    <Tile
      icon="sites"
      title={section.state === "ready" && section.data.length > 1 ? "Sites" : "Site"}
      className="rounded-lg p-6"
    >
      {section.state === "unavailable" ? (
        <p className="text-sm text-muted">{UNAVAILABLE}</p>
      ) : section.data.length === 0 ? (
        <p className="text-sm text-muted">Aucun site pour ce client.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {section.data.map((site) => (
            <li key={site.id} className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/sites/${site.id}`}
                  className="hit-44 block truncate text-sm font-semibold text-text hover:underline hover:underline-offset-4"
                >
                  {site.primaryDomain ?? site.name}
                </Link>
                {site.cmsKind || site.hostingLabel ? (
                  <p className="truncate text-xs text-muted">
                    {[site.cmsKind ? CMS_KIND_LABELS[site.cmsKind] : null, site.hostingLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
              <StatusBadge kind={"site" satisfies StatusKind} status={site.status} />
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

/** Marge par `getMargin` (domain-model §6), prévu et réalisé séparés, plus les dernières factures. */
export function FinanceSection({
  margin,
  invoices,
}: {
  margin: CompanyRelated["margin"];
  invoices: CompanyRelated["invoices"];
}) {
  if (margin.state === "absent" && invoices.state === "absent") return null;
  const marginRows =
    margin.state === "ready"
      ? [
          {
            label: "Marge réalisée",
            value:
              margin.data.actual.marginCents === null
                ? "Non calculable"
                : formatCentsHT(margin.data.actual.marginCents),
          },
          {
            label: "Marge prévue",
            value:
              margin.data.forecast.marginCents === null
                ? "Non calculable"
                : formatCentsHT(margin.data.forecast.marginCents),
          },
        ]
      : [];
  return (
    <InfoCard
      icon="wallet"
      title="Finances"
      aside={
        <CompactLink variant="quiet" href="/finances/rentabilite">
          Rentabilité
        </CompactLink>
      }
      rows={marginRows}
    >
      {margin.state === "unavailable" ? <p className="text-sm text-muted">{UNAVAILABLE}</p> : null}
      {invoices.state === "unavailable" ? (
        <p className="text-sm text-muted">{UNAVAILABLE}</p>
      ) : invoices.state === "ready" && invoices.data.length > 0 ? (
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="tabular min-w-0 truncate text-text">
                {invoice.externalRef ?? "Sans référence"} · {formatCents(invoice.amountCents)}
              </span>
              <StatusBadge kind="invoice" status={invoice.status} />
            </li>
          ))}
        </ul>
      ) : invoices.state === "ready" ? (
        <p className="text-sm text-muted">Aucune facture référencée.</p>
      ) : null}
    </InfoCard>
  );
}
