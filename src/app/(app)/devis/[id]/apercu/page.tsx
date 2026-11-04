import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PrintButton } from "@/modules/quotes/components/print-button";
import { QUOTE_DOCUMENT_NOTICE } from "@/modules/quotes/quote.document";
import { getQuoteDocument } from "@/modules/quotes/quote.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";
import "./apercu.css";

export const metadata: Metadata = { title: "Aperçu du devis" };

/**
 * « Aperçu PDF » : le document client, sans coût interne ni rentabilité, avec une vraie impression.
 * Aucune bibliothèque de PDF : le navigateur l'enregistre depuis sa boîte d'impression.
 */
export default async function ApercuDevisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "quotes:read")) {
    return (
      <>
        <PageHeader title="Aperçu du devis" />
        <ForbiddenState />
      </>
    );
  }

  let data: Awaited<ReturnType<typeof getQuoteDocument>>;
  try {
    data = await getQuoteDocument(ctx, id, {
      versionNumber: version && /^\d+$/.test(version) ? Number(version) : undefined,
    });
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { document } = data;

  return (
    <div className="mx-auto flex max-w-[840px] flex-col gap-5">
      <div data-print-hidden className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink href={`/devis/${id}${version ? `?version=${version}` : ""}`}>
          Retour au devis
        </ButtonLink>
        <PrintButton />
      </div>

      <article
        data-quote-document
        className="anim-content flex flex-col gap-6 rounded-lg bg-surface p-6 text-sm text-text shadow-soft sm:p-10"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Logo variant="os-ink" width={132} />
            <h1 className="mt-3 text-page-title text-ink">{document.heading}</h1>
            <p className="text-muted">
              {document.title} · {document.versionLabel} · {document.dateLabel}
            </p>
            {document.issuedByNote ? <p className="text-muted">{document.issuedByNote}</p> : null}
            {document.indyReference ? (
              <p className="text-muted">Référence : {document.indyReference}</p>
            ) : null}
          </div>
          <address className="not-italic sm:text-right">
            <p className="font-semibold text-ink">{document.companyName}</p>
            {document.companyLines.map((line) => (
              <p key={line} className="text-muted">
                {line}
              </p>
            ))}
          </address>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-text font-mono text-table-head text-muted uppercase">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Prestation
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Quantité
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Prix unitaire HT
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">
                  Montant HT
                </th>
              </tr>
            </thead>
            <tbody>
              {document.rows.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="py-3 pr-3">
                    {row.label}
                    {row.unit ? <span className="ml-2 text-muted">{row.unit}</span> : null}
                  </td>
                  <td className="tabular px-3 py-3 text-right">{row.quantity}</td>
                  <td className="tabular px-3 py-3 text-right">{row.unitPrice}</td>
                  <td
                    className={cn(
                      "tabular py-3 pl-3 text-right",
                      row.recurring ? "text-muted" : "text-ink",
                    )}
                  >
                    {row.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto flex w-full max-w-[320px] flex-col gap-2">
          {document.summary.map((line) => (
            <div key={line.label} className="flex items-center justify-between gap-4">
              <dt className="text-muted">{line.label}</dt>
              <dd className={cn("tabular", line.strong ? "font-semibold text-ink" : "text-text")}>
                {line.value}
              </dd>
            </div>
          ))}
        </dl>

        {document.sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-1">
            <h2 className="text-tile-title text-ink">{section.title}</h2>
            <p className="whitespace-pre-line">{section.body}</p>
          </section>
        ))}

        {document.validityLabel ? <p className="font-medium">{document.validityLabel}</p> : null}

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="text-tile-title text-ink">Bon pour accord</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <p className="text-muted">Date :</p>
            <p className="min-h-20 text-muted">Signature :</p>
          </div>
        </section>

        <p className="text-xs text-muted">{QUOTE_DOCUMENT_NOTICE}</p>
      </article>
    </div>
  );
}
