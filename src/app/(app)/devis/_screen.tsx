import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { getDocusealGateway } from "@/integrations/docuseal";
import { formatNumber } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import { paramValue, type SearchParamsLike } from "@/lib/url-state";
import { NewQuoteButton } from "@/modules/quotes/components/new-quote-button";
import { QuoteFilters, QuoteList } from "@/modules/quotes/components/quote-list";
import { QuotePanel } from "@/modules/quotes/components/quote-panel";
import {
  getSignatureAvailability,
  getSignerOptions,
} from "@/modules/quotes/quote-signature.service";
import { todayInParis } from "@/modules/quotes/quote.rules";
import { QUOTE_LIST_FILTERS, type QuoteListFilter } from "@/modules/quotes/quote.schema";
import {
  getAmendmentOptions,
  getQuoteDetail,
  getQuoteFormOptions,
  getQuoteSummary,
  listQuotes,
} from "@/modules/quotes/quote.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";

function plural(count: number, one: string, many: string) {
  return `${formatNumber(count)} ${count > 1 ? many : one}`;
}

function parseFilter(value: string | undefined): QuoteListFilter | undefined {
  return QUOTE_LIST_FILTERS.find((filter) => filter === value);
}

/**
 * Écran 09 : liste + détail côte à côte (668 + 20 + 440). `/devis` ouvre le premier devis de la
 * liste, `/devis/[id]` celui demandé. Un devis absent ou archivé répond 404.
 */
export async function DevisScreen({
  searchParams,
  selectedId,
}: {
  searchParams: SearchParamsLike;
  selectedId?: string;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "quotes:read")) {
    return (
      <>
        <PageHeader title="Devis" />
        <ForbiddenState />
      </>
    );
  }

  const now = new Date();
  const search = paramValue(searchParams, "q");
  const filter = parseFilter(paramValue(searchParams, "statut"));
  const canCreate = can(ctx.actor, "quotes:create");
  const canUpdate = can(ctx.actor, "quotes:update");
  const canSend = can(ctx.actor, "quotes:send");

  const [list, summary, options] = await Promise.all([
    listQuotes(ctx, { search, filter, page: paramValue(searchParams, "page") }),
    getQuoteSummary(ctx, now),
    canCreate ? getQuoteFormOptions(ctx) : null,
  ]);

  const targetId = selectedId ?? list.items[0]?.id;
  const versionParam = paramValue(searchParams, "version");
  const versionNumber =
    versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;
  let detail: Awaited<ReturnType<typeof getQuoteDetail>> | null = null;
  if (targetId) {
    try {
      detail = await getQuoteDetail(ctx, targetId, { versionNumber, now });
    } catch (error) {
      if (isAppError(error) && error.code === "NOT_FOUND") {
        if (selectedId) notFound();
      } else {
        throw error;
      }
    }
  }

  const docuseal = getSignatureAvailability({ docuseal: getDocusealGateway() });
  const signers =
    detail && canSend && (detail.actions.send || detail.actions.requestSignature)
      ? await getSignerOptions(ctx, detail.quote.id)
      : null;

  const changeRequests =
    detail && canCreate && detail.actions.amend
      ? await getAmendmentOptions(ctx, detail.quote.companyId)
      : [];

  const newQuote = options ? (
    <NewQuoteButton
      companies={options.companies}
      initial={{
        open: paramValue(searchParams, "nouveau") === "1",
        companyId: paramValue(searchParams, "client"),
        opportunityId: paramValue(searchParams, "affaire"),
      }}
    />
  ) : null;

  const pathname = selectedId ? `/devis/${selectedId}` : "/devis";

  return (
    <>
      <PageHeader
        title="Devis"
        subtitle={[
          plural(summary.toSignCount, "à signer", "à signer"),
          plural(summary.signedThisMonthCount, "signé ce mois", "signés ce mois"),
          formatCentsHT(summary.totalCents),
        ].join(" · ")}
        actions={
          <>
            <ButtonLink href="/devis/catalogue">Catalogue</ButtonLink>
            {newQuote}
          </>
        }
      >
        <QuoteFilters />
      </PageHeader>

      <div className="grid items-start gap-5 xl:grid-cols-(--cols-main-side-lg)">
        <QuoteList
          rows={list.items}
          pagination={{ page: list.page, pageSize: list.pageSize, total: list.total }}
          query={{ pathname, searchParams }}
          now={now}
          filtered={Boolean(search || filter)}
          emptyAction={newQuote}
        />
        {detail ? (
          // En colonne unique : le devis ouvert passe avant la liste, et /devis ne montre que la liste.
          <div
            className={selectedId ? "order-first min-w-0 xl:order-none" : "hidden min-w-0 xl:block"}
          >
            <QuotePanel
              detail={detail}
              canPreview
              documentUnavailable={paramValue(searchParams, "document") === "indisponible"}
              signature={{
                isAmendment: detail.parent !== null,
                hasOpportunity: detail.opportunity !== null,
                acceptedVersionLabel: detail.latestSentVersion
                  ? `Version acceptée : ${detail.latestSentVersion.version}, à ${formatCentsHT(
                      detail.latestSentVersion.totalCents,
                    )}, la dernière envoyée au client.`
                  : null,
                quoteId: detail.quote.id,
                number: detail.quote.number,
                title: detail.quote.title,
                actions: detail.actions,
                canUpdate,
                canSend,
                canCreate,
                signatureConfigured: docuseal.configured,
                signers: signers?.contacts ?? [],
                defaultSignerId: signers?.defaultContactId ?? null,
                indyReference: detail.quote.indyReference,
                officialDocumentUrl: detail.quote.officialDocumentUrl,
                today: todayInParis(now),
                changeRequests,
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
