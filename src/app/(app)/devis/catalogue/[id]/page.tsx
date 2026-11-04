import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { InfoCard } from "@/components/ui/info-card";
import { Tile } from "@/components/ui/tile";
import { CATALOG_ITEM_KIND_LABELS, OFFER_ACTIVITY_LABELS } from "@/lib/domain-enums";
import { formatDays, formatPercent } from "@/lib/format";
import { formatCents, marginPercent } from "@/lib/money";
import { CatalogActiveToggle } from "@/modules/catalog/components/catalog-controls";
import { CatalogItemForm } from "@/modules/catalog/components/catalog-item-form";
import { canSeeCatalogCosts, getCatalogItem } from "@/modules/catalog/catalog.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { isAppError } from "@/server/errors";

export const metadata: Metadata = { title: "Prestation" };

export default async function CatalogueItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "catalog:read")) {
    return (
      <>
        <PageHeader title="Prestation" />
        <ForbiddenState />
      </>
    );
  }

  let item: Awaited<ReturnType<typeof getCatalogItem>>;
  try {
    item = await getCatalogItem(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const canManage = can(ctx.actor, "catalog:manage");
  const margin = marginPercent(item.priceCents, item.estimatedCostCents);

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${CATALOG_ITEM_KIND_LABELS[item.kind]} · ${OFFER_ACTIVITY_LABELS[item.activity]}`}
        breadcrumbs={[
          { label: "Devis", href: "/devis" },
          { label: "Catalogue", href: "/devis/catalogue" },
          { label: item.name },
        ]}
        badges={item.active ? <Badge tone="success">En vente</Badge> : <Badge>Retirée</Badge>}
        actions={
          canManage ? (
            <CatalogActiveToggle itemId={item.id} active={item.active} />
          ) : (
            <ButtonLink href="/devis/catalogue">Retour au catalogue</ButtonLink>
          )
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {canManage ? (
          <Tile className="rounded-lg p-6">
            <CatalogItemForm
              item={item}
              footer={<ButtonLink href="/devis/catalogue">Annuler</ButtonLink>}
            />
          </Tile>
        ) : (
          <InfoCard
            icon="book"
            title="Contenu"
            rows={[
              { key: "description", label: "Description", value: item.description ?? "—" },
              { key: "scope", label: "Périmètre", value: item.scope ?? "—" },
              { key: "exclusions", label: "Exclusions", value: item.exclusions ?? "—" },
              { key: "conditions", label: "Conditions", value: item.conditions ?? "—" },
            ]}
          />
        )}
        <InfoCard
          icon="euro"
          title="Chiffrage"
          rows={[
            { key: "price", label: "Prix HT", value: formatCents(item.priceCents) },
            ...(canSeeCatalogCosts(ctx.actor)
              ? [
                  {
                    key: "cost",
                    label: "Coût estimé",
                    value: formatCents(item.estimatedCostCents),
                  },
                  { key: "margin", label: "Marge estimée", value: formatPercent(margin) },
                ]
              : []),
            { key: "time", label: "Temps estimé", value: formatDays(item.estimatedMinutes) },
            {
              key: "validity",
              label: "Validité",
              value: item.validityDays ? `${item.validityDays} jours` : "—",
            },
            {
              key: "deposit",
              label: "Acompte",
              value: item.depositPercent === null ? "—" : formatPercent(item.depositPercent),
            },
          ]}
        />
      </div>
    </>
  );
}
