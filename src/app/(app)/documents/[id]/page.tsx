import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ConnectionRequired, ForbiddenState } from "@/components/states/states";
import { Alert } from "@/components/ui/feedback";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonExternalLink } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { InfoCard } from "@/components/ui/info-card";
import { DOCUMENT_KIND_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/domain-enums";
import { formatDateShort, formatDateTime } from "@/lib/format";
import {
  DocumentControls,
  EditDocumentButton,
  ReferenceVersionButton,
} from "@/modules/documents/components/document-controls";
import { NewVersionButton } from "@/modules/documents/components/new-version-button";
import {
  documentDownloadHref,
  documentLinkLabel,
  documentPreviewHref,
  firstName,
  formatFileSize,
  isPreviewable,
  withCurrentLinks,
  withOption,
} from "@/modules/documents/document.format";
import {
  getDocumentDetail,
  getDocumentStorageStatus,
  listDocumentCompanyOptions,
  listDocumentLinkOptions,
} from "@/modules/documents/document.service";
import type { DocumentVersionRow } from "@/modules/documents/document.types";
import { can, canAny } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";

/** Lien vers la fiche liée, ou simple texte si le rôle n'y a pas accès. */
function LinkedRecord({
  allowed,
  href,
  children,
}: {
  allowed: boolean;
  href: string;
  children: ReactNode;
}) {
  if (!allowed) return <>{children}</>;
  return (
    <Link href={href} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

async function loadDetail(ctx: Awaited<ReturnType<typeof getServiceContext>>, id: string) {
  try {
    return await getDocumentDetail(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getServiceContext();
  if (!canAny(ctx.actor, ["documents:read", "documents:read_assigned"])) {
    return <ForbiddenState />;
  }

  const { id } = await params;
  const { document, versions } = await loadDetail(ctx, id);
  const canUpdate = can(ctx.actor, "documents:update");
  const archived = Boolean(document.archivedAt);
  const storage = getDocumentStorageStatus();

  const [activeCompanies, activeLinks] = canUpdate
    ? await Promise.all([
        listDocumentCompanyOptions(ctx),
        document.companyId ? listDocumentLinkOptions(ctx, document.companyId) : null,
      ])
    : [[], null];
  // Le client et les liens en place restent proposés, même archivés depuis.
  const companies = withOption(
    activeCompanies.map((company) => ({ id: company.id, label: company.name })),
    document.companyId,
    document.companyName,
  ).map((option) => ({ id: option.id, name: option.label }));
  const linkOptions = withCurrentLinks(activeLinks, document);

  const canOpen = {
    client: can(ctx.actor, "crm:read"),
    project: canAny(ctx.actor, ["projects:read", "projects:read_assigned"]),
    contract: can(ctx.actor, "contracts:read"),
    site: can(ctx.actor, "sites:read"),
    ticket: canAny(ctx.actor, ["support:read", "support:read_assigned"]),
    quote: can(ctx.actor, "quotes:read"),
  };

  const columns: DataTableColumn<DocumentVersionRow>[] = [
    {
      key: "version",
      header: "Version",
      width: 150,
      primary: true,
      cell: (row) => (
        <span className="text-cell font-semibold text-ink">
          v{row.version}
          {row.id === document.currentVersionId ? " · référence" : ""}
        </span>
      ),
    },
    {
      key: "fichier",
      header: "Fichier",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block truncate text-text" title={row.filename}>
            {row.filename}
          </span>
          <span className="block text-row-secondary text-muted">
            {formatFileSize(row.sizeBytes)}
            {row.note ? ` · ${row.note}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "auteur",
      header: "Déposé",
      width: 140,
      cell: (row) => `${formatDateShort(row.createdAt)} · ${firstName(row.authorName)}`,
    },
    {
      key: "actions",
      header: "Actions",
      width: 190,
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          {storage.configured ? (
            <span className="flex flex-wrap gap-x-3">
              <a
                href={documentDownloadHref(document.id, row.version)}
                download
                className="hit-44 text-sm font-medium text-accent hover:underline hover:underline-offset-4"
              >
                Télécharger
              </a>
              {isPreviewable(row.mimeType) ? (
                <a
                  href={documentPreviewHref(document.id, row.version)}
                  target="_blank"
                  rel="noopener"
                  className="hit-44 text-sm font-medium text-accent hover:underline hover:underline-offset-4"
                >
                  Aperçu
                  <span className="sr-only"> de la version {row.version} (nouvel onglet)</span>
                </a>
              ) : null}
            </span>
          ) : (
            <span className="text-sm text-muted">Indisponible</span>
          )}
          {canUpdate && !archived && row.id !== document.currentVersionId ? (
            <ReferenceVersionButton documentId={document.id} versionId={row.id} />
          ) : null}
        </span>
      ),
    },
  ];

  const detailRows = [
    { key: "type", label: "Type", value: DOCUMENT_KIND_LABELS[document.kind] },
    { key: "statut", label: "Statut", value: DOCUMENT_STATUS_LABELS[document.status] },
    {
      key: "client",
      label: "Client",
      value: document.companyId ? (
        <LinkedRecord allowed={canOpen.client} href={`/clients/${document.companyId}`}>
          {document.companyName}
        </LinkedRecord>
      ) : (
        "Aucun"
      ),
    },
    ...(document.projectId
      ? [
          {
            key: "projet",
            label: "Projet",
            value: (
              <LinkedRecord allowed={canOpen.project} href={`/projets/${document.projectId}`}>
                {document.projectNumber}
              </LinkedRecord>
            ),
          },
        ]
      : []),
    ...(document.contractId
      ? [
          {
            key: "contrat",
            label: "Contrat",
            value: (
              <LinkedRecord allowed={canOpen.contract} href={`/contrats/${document.contractId}`}>
                {document.contractNumber}
              </LinkedRecord>
            ),
          },
        ]
      : []),
    ...(document.siteId
      ? [
          {
            key: "site",
            label: "Site",
            value: (
              <LinkedRecord allowed={canOpen.site} href={`/sites/${document.siteId}`}>
                {document.siteName}
              </LinkedRecord>
            ),
          },
        ]
      : []),
    ...(document.ticketId
      ? [
          {
            key: "demande",
            label: "Demande",
            value: (
              <LinkedRecord allowed={canOpen.ticket} href={`/support/${document.ticketId}`}>
                {document.ticketNumber}
              </LinkedRecord>
            ),
          },
        ]
      : []),
    ...(document.quoteId
      ? [
          {
            key: "devis",
            label: "Devis",
            value: (
              <LinkedRecord allowed={canOpen.quote} href={`/devis/${document.quoteId}`}>
                {document.quoteNumber}
              </LinkedRecord>
            ),
          },
        ]
      : []),
    {
      key: "origine",
      label: "Origine",
      value: document.uploadedByClient ? "Déposé par le client" : "Équipe Nuera",
    },
    { key: "modifie", label: "Modifié", value: formatDateTime(document.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        title={document.title}
        subtitle={`${DOCUMENT_KIND_LABELS[document.kind]} · ${documentLinkLabel(document)} · ${versions.length} ${versions.length > 1 ? "versions" : "version"}`}
        breadcrumbs={[{ label: "Documents", href: "/documents" }, { label: document.title }]}
        badges={
          <>
            <StatusBadge kind="document" status={document.visibility} />
            {archived ? <Badge tone="warn">Archivé</Badge> : null}
          </>
        }
        actions={
          <>
            {document.currentVersionId && storage.configured ? (
              <ButtonExternalLink
                href={documentDownloadHref(document.id)}
                target="_self"
                download
                icon="download"
              >
                Télécharger
              </ButtonExternalLink>
            ) : null}
            {canUpdate && !archived ? (
              <NewVersionButton
                documentId={document.id}
                storageConfigured={storage.configured}
                maxBytes={storage.maxBytes}
              />
            ) : null}
          </>
        }
      />

      {archived ? (
        <Alert tone="warn" className="mb-6">
          Ce document est archivé : il n&apos;apparaît plus dans les listes ni dans l&apos;espace
          client. Ses fichiers sont conservés.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,728fr)_minmax(0,380fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <DataTable
            caption="Versions du document"
            columns={columns}
            rows={versions}
            rowKey={(row) => row.id}
            rowHeight="lg"
          />
          {!storage.configured ? (
            <ConnectionRequired
              compact
              service="stockage des fichiers"
              missing="Le dossier de stockage n'est pas configuré : les fichiers ne peuvent être ni déposés ni téléchargés."
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <InfoCard
            icon="devis"
            title="Détails"
            rows={detailRows}
            aside={
              canUpdate && !archived ? (
                <EditDocumentButton
                  document={document}
                  companies={companies}
                  linkOptions={linkOptions}
                />
              ) : undefined
            }
            className="h-fit"
          />
          {canUpdate ? (
            <InfoCard icon="shield" title="Partage et statut" className="h-fit">
              <DocumentControls document={document} />
            </InfoCard>
          ) : null}
        </div>
      </div>
    </>
  );
}
