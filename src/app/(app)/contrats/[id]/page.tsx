import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { RollingNumber } from "@/components/motion/rolling-number";
import { ForbiddenState } from "@/components/states/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { DataTablePagination } from "@/components/ui/data-table";
import { InfoCard } from "@/components/ui/info-card";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import {
  CONTRACT_EVENT_KIND_LABELS,
  CONTRACT_KIND_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_COVERAGE_LABELS,
  type TicketCoverage,
} from "@/lib/domain-enums";
import { formatDate, formatDateNumeric, formatDateShort, formatMinutes } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { paramValue, type SearchParamsLike } from "@/lib/url-state";
import {
  AddNoteButton,
  ContractSignature,
  ContractSites,
  OverageButton,
} from "@/modules/contracts/components/contract-cards";
import { EditContractButton } from "@/modules/contracts/components/contract-form";
import {
  ContractLifecycle,
  StatusButton,
  StopList,
} from "@/modules/contracts/components/contract-lifecycle";
import { InterventionJournal } from "@/modules/contracts/components/intervention-journal";
import { hasMeasurableQuota, QuotaGauges } from "@/modules/contracts/components/quota-gauges";
import { isContractSignatureConfigured } from "@/modules/contracts/contract-signature.service";
import {
  formatDeadline,
  formatPricePerPeriod,
  periodLabel,
  perPeriodLabel,
} from "@/modules/contracts/contract.format";
import {
  addDays,
  monthlyAmountCents,
  quotaExhausted,
  RENEWAL_WINDOW_DAYS,
  worstQuotaPercent,
} from "@/modules/contracts/contract.rules";
import { getContractRecord, type ContractRecord } from "@/modules/contracts/contract.service";
import type { ContractEventRow } from "@/modules/contracts/contract.types";
import { listInterventions } from "@/modules/contracts/intervention.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { parsePagination } from "@/server/pagination";

export const metadata = { title: "Contrat" };

const INTERVENTIONS_PER_PAGE = 10;

const COVERAGE_TONES: Record<TicketCoverage, "success" | "warn" | "danger" | "neutral"> = {
  covered: "success",
  overage: "warn",
  not_covered: "neutral",
  undetermined: "neutral",
};

async function loadContract(ctx: ServiceContext, id: string, page: string | undefined) {
  try {
    const [record, interventions] = await Promise.all([
      getContractRecord(ctx, id),
      listInterventions(
        ctx,
        id,
        parsePagination({ page }, { defaultPageSize: INTERVENTIONS_PER_PAGE }),
      ),
    ]);
    return { record, interventions };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Les catégories qui reçoivent la même réponse se lisent sur une seule ligne. */
function groupCoverage(coverage: ContractRecord["coverage"]) {
  const groups = new Map<
    string,
    { coverage: TicketCoverage; reason: string; categories: string[] }
  >();
  for (const { category, decision } of coverage) {
    const group = groups.get(decision.reason) ?? {
      coverage: decision.coverage,
      reason: decision.reason,
      categories: [],
    };
    group.categories.push(TICKET_CATEGORY_LABELS[category]);
    groups.set(decision.reason, group);
  }
  return [...groups.values()];
}

function hours(value: number | null): string {
  return value === null ? "—" : `${value} h`;
}

function eventDetail(event: ContractEventRow): string | null {
  if (event.fromPriceCents !== null && event.toPriceCents !== null) {
    const change = `${formatCents(event.fromPriceCents)} → ${formatCents(event.toPriceCents)}`;
    return event.note ? `${change} · ${event.note}` : change;
  }
  return event.note;
}

function TermsBlock({ title, text, empty }: { title: string; text: string | null; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-field-label text-ink">{title}</h3>
      <p className="text-sm whitespace-pre-line text-muted">{text ?? empty}</p>
    </div>
  );
}

function Relation({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="hit-44 text-accent hover:underline hover:underline-offset-4">
      {children}
    </Link>
  );
}

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "contracts:read")) {
    return (
      <>
        <PageHeader title="Contrat" />
        <ForbiddenState />
      </>
    );
  }

  const { id } = await params;
  const query: SearchParamsLike = await searchParams;
  const { record, interventions } = await loadContract(ctx, id, paramValue(query, "page"));
  const { contract, consumption, events, sites, siteOptions, members, plans, contacts } = record;
  const { impact, margin, documents, coverage, tickets, ticketTotal, quoteOptions, today } = record;

  const canUpdate = can(ctx.actor, "contracts:update");
  const canTerminate = can(ctx.actor, "contracts:terminate");
  const canCosts = can(ctx.actor, "finance:read") || can(ctx.actor, "team:read_costs");
  const ended = contract.status === "terminated" || contract.status === "expired";
  const inForce = contract.status === "active" || contract.status === "to_review";
  const percent = worstQuotaPercent(consumption);
  const exhausted = quotaExhausted(consumption);
  const measured = hasMeasurableQuota(consumption);
  const dueSoon =
    !ended &&
    contract.nextDueOn !== null &&
    contract.nextDueOn <= addDays(today, RENEWAL_WINDOW_DAYS);
  const per = perPeriodLabel(contract.period);

  return (
    <div className="flex flex-col gap-(--grid-gap)">
      <PageHeader
        className="mb-0 lg:mb-0"
        breadcrumbs={[{ label: "Contrats", href: "/contrats" }, { label: contract.number }]}
        title={
          contract.name.includes(contract.companyName)
            ? contract.name
            : `${contract.companyName} · ${contract.name}`
        }
        subtitle={`${contract.number} · ${CONTRACT_KIND_LABELS[contract.kind]} · ${formatPricePerPeriod(contract.priceCents, contract.period)}`}
        badges={
          <>
            <StatusBadge kind="contract" status={contract.status} />
            <StatusBadge kind="signature" status={contract.signatureStatus} />
            {contract.autoRenew && !ended ? (
              <Badge tone="neutral">Renouvellement auto</Badge>
            ) : null}
            {contract.awaitsGoLive ? <Badge tone="neutral">Dès la mise en ligne</Badge> : null}
          </>
        }
        actions={
          canUpdate && !ended ? (
            <>
              <EditContractButton
                contract={contract}
                plans={plans}
                quotes={quoteOptions}
                canReadCosts={canCosts}
              />
              {contract.status === "to_start" ? (
                <StatusButton
                  look="header"
                  contractId={contract.id}
                  status="active"
                  label="Démarrer"
                  title="Démarrer le contrat"
                  description="Il entre dans les revenus récurrents et couvre les demandes du client."
                />
              ) : null}
              {contract.status === "suspended" ? (
                <StatusButton
                  look="header"
                  contractId={contract.id}
                  status="active"
                  label="Reprendre"
                  title="Reprendre le contrat"
                  description="Il revient dans les revenus récurrents et couvre de nouveau les demandes."
                />
              ) : null}
            </>
          ) : null
        }
      />

      <KpiGrid>
        <KpiCard
          label="Prix HT"
          value={formatCents(contract.priceCents)}
          note={
            contract.period === "monthly"
              ? `par ${per}`
              : `par ${per} · ${formatCents(Math.round(monthlyAmountCents(contract.priceCents, contract.period)))} par mois`
          }
        />
        <KpiCard
          label="Prochaine échéance"
          value={!ended && contract.nextDueOn ? formatDeadline(contract.nextDueOn, today) : "—"}
          note={
            ended
              ? "contrat terminé"
              : contract.nextDueOn
                ? contract.autoRenew
                  ? "renouvellement automatique"
                  : "à renouveler à la main"
                : contract.awaitsGoLive
                  ? "dès la mise en ligne"
                  : "aucune échéance"
          }
          noteTone={dueSoon ? "warn" : "muted"}
        />
        <KpiCard
          label="Forfait consommé"
          value={percent === null ? "—" : <RollingNumber value={Math.round(percent)} suffix=" %" />}
          note={
            percent === null
              ? "pas de quota sur ce contrat"
              : `du ${formatDateShort(consumption.periodStart)} au ${formatDateShort(consumption.periodEnd)}`
          }
          noteTone={exhausted ? "danger" : percent !== null && percent >= 80 ? "warn" : "muted"}
        />
        {can(ctx.actor, "finance:read") ? (
          <KpiCard
            label="Marge HT réalisée"
            value={
              margin?.actual.marginCents == null ? "—" : formatCents(margin.actual.marginCents)
            }
            note={
              margin?.actual.marginPercent == null
                ? (margin?.actual.unavailable[0] ?? "non calculable")
                : `${Math.round(margin.actual.marginPercent)} % après temps et coûts`
            }
          />
        ) : (
          <KpiCard
            label="Sites couverts"
            value={<RollingNumber value={sites.length} />}
            note={sites.length === 0 ? "tous les sites du client" : "rattachés à ce contrat"}
          />
        )}
      </KpiGrid>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-(--cols-main-side)">
        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard icon="clock" title="Consommation de la période">
            {measured ? (
              <QuotaGauges consumption={consumption} />
            ) : (
              <p className="text-sm text-muted">Ce contrat ne prévoit pas de quota mesurable.</p>
            )}
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <h3 className="text-field-label text-ink">
                Couverture des demandes aujourd&apos;hui
              </h3>
              <ul className="flex flex-col gap-2">
                {groupCoverage(coverage).map((group) => (
                  <li key={group.reason} className="flex items-start justify-between gap-3 text-sm">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-text">{group.categories.join(", ")}</span>
                      <span className="text-kpi-note text-muted">{group.reason}</span>
                    </span>
                    <Badge tone={COVERAGE_TONES[group.coverage]} className="shrink-0">
                      {TICKET_COVERAGE_LABELS[group.coverage]}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
            {canUpdate && inForce ? (
              <div>
                <OverageButton
                  contractId={contract.id}
                  canQuote={can(ctx.actor, "quotes:create")}
                  prominent={exhausted}
                />
              </div>
            ) : null}
          </InfoCard>

          <InfoCard icon="contrat" title="Périmètre">
            <TermsBlock
              title="Inclus"
              text={contract.scope}
              empty="Le périmètre n'est pas encore décrit."
            />
            <TermsBlock
              title="Exclusions"
              text={contract.exclusions}
              empty="Aucune exclusion écrite."
            />
            <TermsBlock
              title="Conditions"
              text={contract.conditions}
              empty="Aucune condition écrite."
            />
          </InfoCard>

          <InfoCard icon="check" title="Journal de maintenance">
            <InterventionJournal
              contractId={contract.id}
              rows={interventions.items}
              today={today}
              sites={siteOptions}
              members={members}
              canEdit={canUpdate}
              canPlan={!ended}
              canLog={contract.status !== "to_start"}
            />
            {interventions.total > interventions.pageSize ? (
              <DataTablePagination
                query={{ pathname: `/contrats/${contract.id}`, searchParams: query }}
                page={interventions.page}
                pageSize={interventions.pageSize}
                total={interventions.total}
                className="-mx-6 -mb-6"
              />
            ) : null}
          </InfoCard>

          <InfoCard
            icon="book"
            title="Historique"
            aside={canUpdate ? <AddNoteButton contractId={contract.id} /> : null}
          >
            {events.length === 0 ? (
              <p className="text-sm text-muted">Aucun événement enregistré.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {events.map((event) => {
                  const detail = eventDetail(event);
                  return (
                    <li key={event.id} className="flex items-baseline gap-3 text-sm">
                      <span className="w-20 shrink-0 font-mono text-amount-compact text-muted">
                        {formatDateNumeric(event.at)}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-text">{CONTRACT_EVENT_KIND_LABELS[event.kind]}</span>
                        {detail ? <span className="text-muted">{detail}</span> : null}
                        <span className="text-kpi-note text-muted">
                          {event.actorName ?? "Automatique"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </InfoCard>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard
            icon="euro"
            title="Abonnement"
            rows={[
              {
                key: "client",
                label: "Client",
                value: (
                  <Relation href={`/clients/${contract.companyId}`}>
                    {contract.companyName}
                  </Relation>
                ),
              },
              { key: "period", label: "Périodicité", value: periodLabel(contract.period) },
              { key: "plan", label: "Formule", value: contract.planName ?? "Sans formule" },
              {
                key: "start",
                label: "Début",
                value: contract.startOn ? formatDate(contract.startOn) : "—",
              },
              {
                key: "renews",
                label: "Renouvellement",
                value: contract.renewsOn ? formatDate(contract.renewsOn) : "—",
              },
              {
                key: "end",
                label: "Fin",
                value: contract.endOn ? formatDate(contract.endOn) : "—",
              },
              {
                key: "included",
                label: `Temps inclus par ${per}`,
                value:
                  contract.includedMinutes === null ? "—" : formatMinutes(contract.includedMinutes),
              },
              {
                key: "tickets",
                label: `Demandes incluses par ${per}`,
                value: contract.includedTickets ?? "—",
              },
              { key: "response", label: "Délai de réponse", value: hours(contract.responseHours) },
              {
                key: "resolution",
                label: "Délai de résolution",
                value: hours(contract.resolutionHours),
              },
              ...(contract.monthlyCostCents !== null
                ? [
                    {
                      key: "cost",
                      label: "Coût mensuel",
                      value: formatCents(contract.monthlyCostCents),
                    },
                  ]
                : []),
              ...(contract.quoteId
                ? [
                    {
                      key: "quote",
                      label: "Devis d'origine",
                      value: (
                        <Relation href={`/devis/${contract.quoteId}`}>
                          {contract.quoteNumber ?? "Voir le devis"}
                        </Relation>
                      ),
                    },
                  ]
                : []),
            ]}
          />

          {canUpdate || canTerminate ? (
            <InfoCard icon="flag" title="Renouvellement et fin">
              {ended ? <p className="text-sm text-muted">Ce contrat est terminé.</p> : null}
              <ContractLifecycle
                contract={contract}
                impact={impact}
                today={today}
                canUpdate={canUpdate}
                canTerminate={canTerminate}
              />
            </InfoCard>
          ) : null}

          {contract.status === "terminated" ? (
            <InfoCard icon="alert" title="Résiliation">
              <p className="text-sm whitespace-pre-line text-text">
                {contract.terminatedAt
                  ? `Résilié le ${formatDate(contract.terminatedAt)}.`
                  : "Résilié."}
                {contract.terminationNote ? ` ${contract.terminationNote}` : ""}
              </p>
              <div className="flex flex-col gap-2">
                <h3 className="text-field-label text-ink">Services à arrêter et transferts</h3>
                <StopList impact={impact} />
              </div>
            </InfoCard>
          ) : null}

          {tickets ? (
            <InfoCard
              icon="support"
              title="Demandes"
              aside={
                ticketTotal > tickets.length ? (
                  <span className="text-kpi-note text-muted">
                    {tickets.length} sur {ticketTotal}
                  </span>
                ) : null
              }
            >
              {tickets.length === 0 ? (
                <p className="text-sm text-muted">Aucune demande rattachée à ce contrat.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {tickets.map((ticket) => (
                    <li key={ticket.id} className="flex items-start justify-between gap-3 text-sm">
                      <Link
                        href={`/support/${ticket.id}`}
                        className="min-w-0 text-text hover:underline hover:underline-offset-4"
                      >
                        <span className="font-mono text-amount-compact text-muted">
                          {ticket.number}
                        </span>{" "}
                        {ticket.subject}
                      </Link>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge kind="ticket" status={ticket.status} />
                        {ticket.coverage === "undetermined" ? null : (
                          <Badge tone={COVERAGE_TONES[ticket.coverage]}>
                            {TICKET_COVERAGE_LABELS[ticket.coverage]}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </InfoCard>
          ) : null}

          <InfoCard icon="sites" title="Sites couverts">
            <ContractSites
              contractId={contract.id}
              sites={sites}
              options={siteOptions}
              canEdit={canUpdate && !ended}
            />
          </InfoCard>

          <InfoCard icon="devis" title="Signature">
            <ContractSignature
              contract={contract}
              contacts={contacts}
              configured={isContractSignatureConfigured()}
              canEdit={canUpdate}
            />
          </InfoCard>

          {documents ? (
            <InfoCard
              icon="book"
              title="Documents"
              aside={
                <CompactLink variant="quiet" href={`/documents?contrat=${contract.id}`}>
                  Tous
                </CompactLink>
              }
            >
              {documents.length === 0 ? (
                <p className="text-sm text-muted">
                  Aucun document rattaché. Ajoutez le contrat signé depuis Documents.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {documents.map((document) => (
                    <li
                      key={document.id}
                      className="flex items-center justify-between gap-3 text-sm text-text"
                    >
                      <a
                        href={document.downloadHref}
                        className="hit-44 min-w-0 truncate hover:underline hover:underline-offset-4"
                      >
                        {document.title}
                      </a>
                      {document.version ? (
                        <span className="shrink-0 font-mono text-amount-compact text-muted">
                          v{document.version}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </InfoCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
