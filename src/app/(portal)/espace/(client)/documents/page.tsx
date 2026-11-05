import type { Metadata } from "next";
import { Suspense } from "react";
import { PortalPageHeader } from "@/components/portal/portal-card";
import { EmptyState } from "@/components/states/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CompactLink } from "@/components/ui/compact-button";
import { FilterChip } from "@/components/ui/filter-bar";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatDateShort } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { hrefWith, paramValue } from "@/lib/url-state";
import type { PortalDocumentRow } from "@/modules/documents/document.types";
import { requirePortalPage } from "@/modules/portal/portal.page";
import {
  getPortalDocumentsPage,
  parseDocumentFilter,
  type PortalInvoiceCard,
} from "@/modules/portal/portal.service";
import { parsePagination } from "@/server/pagination";

export const metadata: Metadata = { title: "Documents" };

interface CardModel {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  badge?: { label: string; tone: BadgeTone };
  href: string | null;
}

function invoiceCard(invoice: PortalInvoiceCard): CardModel {
  const noun = invoice.kind === "credit_note" ? "Avoir" : "Facture";
  const amount = `${formatCents(invoice.amountCents)} HT`;
  const detail =
    invoice.status === "paid" && invoice.paidOn
      ? `${amount} · payée le ${formatDateShort(invoice.paidOn)}`
      : invoice.status === "overdue" && invoice.dueOn
        ? `${amount} · à régler depuis le ${formatDateShort(invoice.dueOn)}`
        : invoice.dueOn
          ? `${amount} · à régler le ${formatDateShort(invoice.dueOn)}`
          : amount;
  return {
    key: `invoice-${invoice.id}`,
    icon: "euro",
    title: `${noun} · ${invoice.label}`,
    detail: invoice.downloadHref ? detail : `${detail} · fichier à venir`,
    badge:
      invoice.status === "paid"
        ? { label: "Payée", tone: "success" }
        : invoice.status === "overdue"
          ? { label: "À régler", tone: "warn" }
          : { label: "Envoyée", tone: "accent" },
    href: invoice.downloadHref,
  };
}

function documentCard(row: PortalDocumentRow): CardModel {
  const day = formatDateShort(row.updatedAt);
  if (row.uploadedByClient) {
    return {
      key: row.id,
      icon: "paperclip",
      title: row.filename ?? row.title,
      detail: `déposé par vous · ${day}`,
      badge: { label: "Votre fichier", tone: "neutral" },
      href: row.downloadHref,
    };
  }
  const design = row.kind === "mockup" || row.kind === "deliverable";
  const badge: CardModel["badge"] =
    row.status === "signed"
      ? { label: "Signé", tone: "success" }
      : row.status === "validated"
        ? { label: "Validée", tone: "accent" }
        : row.status === "to_validate"
          ? { label: "À valider", tone: "warn" }
          : undefined;
  return {
    key: row.id,
    icon: row.kind === "invoice" ? "euro" : design ? "edit" : "devis",
    title: row.title,
    detail: (row.version ?? 1) > 1 ? `Version ${row.version} · ${day}` : day,
    badge,
    href: row.downloadHref,
  };
}

function DocumentCard({ card }: { card: CardModel }) {
  const content = (
    <>
      <Icon name={card.icon} size={20} className="text-accent" />
      <h2 className="text-base leading-[1.25] font-semibold text-ink">{card.title}</h2>
      <p className="text-sm text-muted">{card.detail}</p>
      {card.badge ? (
        <div>
          <Badge tone={card.badge.tone}>{card.badge.label}</Badge>
        </div>
      ) : null}
    </>
  );
  const classes =
    "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-7 outline-none";
  return card.href ? (
    <a
      href={card.href}
      className={`${classes} transition-colors duration-(--dur-fast) hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus`}
    >
      {content}
    </a>
  ) : (
    <div className={classes}>{content}</div>
  );
}

/** Écran C6. Une carte se télécharge au clic, par la seule route contrôlée des fichiers. */
export default async function PortalDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePortalPage();
  const query = await searchParams;
  const filter = parseDocumentFilter(paramValue(query, "filtre"));
  const { page: requestedPage } = parsePagination({ page: paramValue(query, "page") });
  const data = await getPortalDocumentsPage(ctx, { filter, page: requestedPage });
  const cards = [...data.invoices.map(invoiceCard), ...data.documents.map(documentCard)];
  const last = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title="Vos documents"
        subtitle="Tout ce que nous avons échangé, au même endroit"
        actions={
          data.hasAnyFile ? (
            <CompactLink
              variant="secondary"
              icon="download"
              href="/espace/documents/archive"
              prefetch={false}
              download
            >
              Tout télécharger
            </CompactLink>
          ) : null
        }
      />
      <Suspense>
        <div role="group" aria-label="Filtrer les documents" className="flex flex-wrap gap-2">
          <FilterChip param="filtre">Tous</FilterChip>
          <FilterChip param="filtre" value="contrats">
            Devis et contrats
          </FilterChip>
          <FilterChip param="filtre" value="factures">
            Factures
          </FilterChip>
          <FilterChip param="filtre" value="maquettes">
            Maquettes
          </FilterChip>
          <FilterChip param="filtre" value="fichiers">
            Vos fichiers
          </FilterChip>
        </div>
      </Suspense>
      {cards.length === 0 ? (
        <EmptyState
          icon="devis"
          title={filter === "tous" ? "Aucun document pour l'instant" : "Rien dans cette catégorie"}
          description="Devis, factures et maquettes partagés arriveront ici, avec les fichiers que vous déposez."
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <DocumentCard key={card.key} card={card} />
          ))}
        </div>
      )}
      {last > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          {data.page > 1 ? (
            <CompactLink
              variant="secondary"
              href={hrefWith("/espace/documents", query, { page: data.page - 1 })}
            >
              Page précédente
            </CompactLink>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Page {data.page} sur {last}
          </span>
          {data.page < last ? (
            <CompactLink
              variant="secondary"
              href={hrefWith("/espace/documents", query, { page: data.page + 1 })}
            >
              Page suivante
            </CompactLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
