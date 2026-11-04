import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { QuoteEditor } from "@/modules/quotes/components/quote-editor";
import { isOpenStatus, todayInParis } from "@/modules/quotes/quote.rules";
import { getQuoteEditor } from "@/modules/quotes/quote.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";

export const metadata: Metadata = { title: "Modifier un devis" };

export default async function ModifierDevisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "quotes:update")) {
    return (
      <>
        <PageHeader title="Modifier un devis" />
        <ForbiddenState description="Votre rôle permet de lire les devis, pas de les modifier." />
      </>
    );
  }

  let editor: Awaited<ReturnType<typeof getQuoteEditor>>;
  try {
    editor = await getQuoteEditor(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { quote, version, lines, catalog, companyName } = editor;
  if (!isOpenStatus(quote.status)) redirect(`/devis/${quote.id}`);

  return (
    <>
      <PageHeader
        title={`Modifier ${quote.number}`}
        subtitle={`${companyName} · version ${version.version}${version.sentAt ? " envoyée" : ""}`}
        breadcrumbs={[
          { label: "Devis", href: "/devis" },
          { label: quote.number, href: `/devis/${quote.id}` },
          { label: "Modifier" },
        ]}
      />
      <QuoteEditor
        quoteId={quote.id}
        number={quote.number}
        companyName={companyName}
        title={quote.title}
        issuedByNote={quote.issuedByNote ?? ""}
        versionNumber={version.version}
        versionFrozen={version.sentAt !== null}
        scope={version.scope ?? ""}
        exclusions={version.exclusions ?? ""}
        conditions={version.conditions ?? ""}
        validUntil={version.validUntil ?? ""}
        depositPercent={version.depositPercent}
        taxPercent={version.taxPercent}
        today={todayInParis()}
        lines={lines.map((line) => ({
          key: line.id,
          catalogItemId: line.catalogItemId,
          label: line.label,
          unitLabel: line.unitLabel ?? "",
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          estimatedCostCents: line.estimatedCostCents,
          estimatedMinutes: line.estimatedMinutes,
          recurring: line.recurring,
        }))}
        catalog={catalog.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          priceCents: item.priceCents,
          estimatedCostCents: item.estimatedCostCents,
          estimatedMinutes: item.estimatedMinutes,
          scope: item.scope,
          exclusions: item.exclusions,
          conditions: item.conditions,
          validityDays: item.validityDays,
          depositPercent: item.depositPercent,
        }))}
      />
    </>
  );
}
