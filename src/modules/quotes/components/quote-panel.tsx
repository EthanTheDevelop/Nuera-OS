import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityList, type ActivityEntry } from "@/components/ui/activity-list";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CompactLink } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { InfoRows } from "@/components/ui/info-card";
import { Tile } from "@/components/ui/tile";
import { cn } from "@/lib/cn";
import { formatDate, formatDateShort, formatDays, formatPercent } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { AUDIT_ACTIONS, type AuditAction } from "@/modules/audit/audit.constants";
import type { QuoteDetail } from "../quote.service";
import type { QuoteActionsProps } from "./quote-actions";
import { QuoteDecisionActions, QuotePrimaryAction } from "./quote-actions";

/** Montant de ligne : le prix total, avec `/mois` déjà porté par l'unité d'une ligne récurrente. */
function lineAmount(line: QuoteDetail["lines"][number]) {
  return formatCents(line.quantity * line.unitPriceCents);
}

function versionNote(detail: QuoteDetail): string | null {
  const { version, versions } = detail;
  const previous = versions.find((candidate) => candidate.version === version.version - 1);
  const parts: string[] = [];
  if (version.sentAt) {
    parts.push(`v${version.version} envoyée le ${formatDateShort(version.sentAt)}`);
  } else if (previous?.sentAt) {
    parts.push(`v${previous.version} envoyée le ${formatDateShort(previous.sentAt)}`);
  }
  if (version.changeNote) parts.push(version.changeNote);
  return parts.length ? parts.join(" · ") : null;
}

/** Bloc vert « Rentabilité estimée » : calculé par le serveur, jamais montré au client. */
function ProfitabilityBlock({ detail }: { detail: QuoteDetail }) {
  const { version, amounts } = detail;
  const margin = amounts.marginPercent;
  const danger = margin !== null && margin < 0;
  const scope = [
    version.scope ? `périmètre : ${version.scope}` : null,
    version.exclusions ? `hors ${version.exclusions}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const facts = [
    `${formatDays(version.estimatedMinutes)} estimés`,
    `coût interne ≈ ${formatCents(version.estimatedCostCents)}`,
    scope || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      aria-label="Rentabilité estimée"
      className={cn(
        "flex flex-col gap-2 rounded-md p-4",
        danger ? "bg-danger-pale" : margin === null ? "bg-surface-raised" : "bg-success-pale",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 text-[13px] font-semibold",
          danger ? "text-danger" : margin === null ? "text-muted" : "text-success",
        )}
      >
        <h3>Rentabilité estimée</h3>
        <p className="tabular">{margin === null ? "—" : formatPercent(margin)}</p>
      </div>
      <p className="line-clamp-3 text-xs text-text">{facts}</p>
      {danger ? (
        <p className="text-xs font-medium text-danger">Ce devis est vendu à perte.</p>
      ) : null}
    </section>
  );
}

function historyEntries(detail: QuoteDetail): ActivityEntry[] {
  return detail.history.map((row) => {
    const reason = row.metadata.reason;
    const changeNote = row.metadata.changeNote;
    const note = row.metadata.note;
    const details = [
      typeof changeNote === "string" ? changeNote : null,
      typeof reason === "string" && row.action === "quote.refused" ? `Motif : ${reason}` : null,
      typeof reason === "string" && row.action === "quote.signature_declined"
        ? `Motif : ${reason}`
        : null,
      row.action === "quote.signature_ignored"
        ? typeof row.metadata.acceptedNumber === "string"
          ? `Reçue de DocuSeal alors que ${row.metadata.acceptedNumber} était déjà accepté sur cette affaire : à vérifier avec le client.`
          : "Reçue de DocuSeal alors que ce devis avait changé : à vérifier avec le client."
        : null,
      row.metadata.method === "manual" ? "Saisie manuelle" : null,
      row.metadata.method === "docuseal" ? "Signature DocuSeal" : null,
      typeof note === "string" ? note : null,
    ].filter(Boolean);
    return {
      id: row.id,
      date: formatDateShort(row.occurredAt),
      dateTime: row.occurredAt.toISOString(),
      title: AUDIT_ACTIONS[row.action as AuditAction] ?? row.action,
      detail: details.length ? details.join(" · ") : undefined,
      actor: row.actorName ?? undefined,
    };
  });
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-table-head text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Détail d'un devis (écran 09, Figma 87:2665) : lignes, totaux, rentabilité, envoi. La carte de
 * suivi, dessous, porte ce que la maquette ne dessine pas : décisions, références, versions,
 * avenants, conditions de démarrage et historique.
 */
export function QuotePanel({
  detail,
  canPreview,
  documentUnavailable = false,
  signature,
}: {
  detail: QuoteDetail;
  canPreview: boolean;
  /** Retour de `/document-signe` : DocuSeal n'a pas pu rendre le document. */
  documentUnavailable?: boolean;
  signature: QuoteActionsProps;
}) {
  const { quote, version, lines, amounts, company, isCurrentVersion } = detail;
  const note = versionNote(detail);
  const versionHref = (number?: number) =>
    number === undefined ? `/devis/${quote.id}` : `/devis/${quote.id}?version=${number}`;
  const previewHref = `/devis/${quote.id}/apercu${isCurrentVersion ? "" : `?version=${version.version}`}`;
  const invoices = detail.invoicesPerPayment;
  const acceptedVersionId = quote.acceptedVersionId;
  const canAct = signature.canUpdate || signature.canSend;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Tile className="gap-4 rounded-lg p-6" key={version.id}>
        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 text-[17px] leading-tight font-semibold text-ink">
              {quote.number} · {company.name}
            </h2>
            {detail.actions.edit && signature.canUpdate ? (
              <CompactLink variant="quiet" href={`/devis/${quote.id}/modifier`} className="-my-2">
                Modifier
              </CompactLink>
            ) : null}
          </div>
          <p className="text-[13px] text-muted">
            {quote.title}
            {detail.parent ? (
              <>
                {" · devis d’origine "}
                <Link
                  href={`/devis/${detail.parent.id}`}
                  className="hit-44 text-accent hover:underline hover:underline-offset-4"
                >
                  {detail.parent.number}
                </Link>
              </>
            ) : null}
          </p>
          {quote.issuedByNote ? (
            <p className="text-[13px] text-muted">{quote.issuedByNote}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Version {version.version}</Badge>
            {note ? <span className="text-xs text-muted">{note}</span> : null}
          </div>
          {!isCurrentVersion ? (
            <Alert tone="info">
              Version passée, figée.{" "}
              <Link href={versionHref()} className="font-medium underline underline-offset-4">
                Voir la version courante
              </Link>
            </Alert>
          ) : null}
        </header>

        {lines.length === 0 ? (
          <p className="rounded-md bg-surface-raised px-4 py-3 text-sm text-muted">
            Aucune ligne pour l’instant. Composez ce devis depuis le catalogue.
          </p>
        ) : (
          <ul className="flex flex-col">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex min-h-[50px] items-center justify-between gap-3 border-b border-border py-2"
              >
                <span className="min-w-0 text-sm text-text">
                  {line.quantity > 1 ? `${line.quantity} × ` : ""}
                  {line.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-3 font-mono text-[13px]">
                  {line.unitLabel ? <span className="text-muted">{line.unitLabel}</span> : null}
                  <span className="text-ink">{lineAmount(line)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="flex flex-col gap-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Total HT</dt>
            <dd className="tabular font-semibold text-ink">{formatCents(amounts.totalCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">TVA {version.taxPercent} %</dt>
            <dd className="tabular font-semibold text-ink">{formatCents(amounts.taxCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">
              {version.depositPercent ? `Acompte ${version.depositPercent} %` : "Acompte"}
            </dt>
            <dd className="tabular font-semibold text-ink">
              {version.depositPercent
                ? `${formatCents(amounts.depositCents)}${
                    invoices > 0 ? ` · ${invoices} facture${invoices > 1 ? "s" : ""}` : ""
                  }`
                : "Sans acompte"}
            </dd>
          </div>
          {detail.recurringCents > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Récurrent, hors total</dt>
              <dd className="tabular font-semibold text-ink">
                {formatCents(detail.recurringCents)}
              </dd>
            </div>
          ) : null}
        </dl>

        {detail.costsVisible ? <ProfitabilityBlock detail={detail} /> : null}

        <div className="flex flex-wrap gap-2">
          {canPreview ? <ButtonLink href={previewHref}>Aperçu PDF</ButtonLink> : null}
          {isCurrentVersion ? <QuotePrimaryAction {...signature} /> : null}
        </div>
        {detail.actions.edit ? (
          <p className="text-xs text-muted">
            {signature.signatureConfigured
              ? "Signature DocuSeal · relance automatique à J+7"
              : "DocuSeal non connecté : envoi et signature s’enregistrent à la main"}
          </p>
        ) : null}
      </Tile>

      <Tile className="gap-4 rounded-lg p-6">
        <Subsection title="Suivi">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="quote" status={quote.status} />
            <StatusBadge kind="signature" status={quote.signatureStatus}>
              {quote.signatureStatus === "unavailable"
                ? "Signature hors DocuSeal"
                : `Signature · ${
                    {
                      none: "non demandée",
                      pending: "en attente",
                      signed: "signée",
                      declined: "refusée",
                      unavailable: "",
                    }[quote.signatureStatus]
                  }`}
            </StatusBadge>
          </div>
          <InfoRows
            rows={[
              {
                key: "client",
                label: "Client",
                value: linkTo(`/clients/${company.id}`, company.name),
              },
              ...(detail.opportunity
                ? [
                    {
                      key: "affaire",
                      label: "Affaire",
                      value: linkTo(`/pipeline/${detail.opportunity.id}`, detail.opportunity.name),
                    },
                  ]
                : []),
              {
                key: "validite",
                label: "Valable jusqu'au",
                value: formatDate(version.validUntil),
              },
              ...(quote.signedAt
                ? [{ key: "signe", label: "Signé le", value: formatDate(quote.signedAt) }]
                : []),
              ...(detail.project
                ? [
                    {
                      key: "projet",
                      label: "Projet",
                      value: linkTo(`/projets/${detail.project.id}`, detail.project.number),
                    },
                  ]
                : []),
            ]}
          />
          {quote.signatureStatus === "declined" ? (
            <Alert tone="warn">
              Le client a refusé de signer. Négociez, préparez une nouvelle version ou enregistrez
              le refus.
            </Alert>
          ) : null}
          {canAct ? <QuoteDecisionActions {...signature} /> : null}
        </Subsection>

        <Subsection title="Conditions de démarrage">
          <ul className="flex flex-col gap-1.5 text-sm text-text">
            <StartCondition done={quote.status === "accepted"} label="Accord du client" />
            <StartCondition
              done={!version.depositPercent || detail.depositPaid}
              label={
                version.depositPercent
                  ? `Acompte de ${version.depositPercent} % : ${formatCents(amounts.depositCents)}${
                      detail.depositPaid ? ", encaissé" : ", à encaisser"
                    }`
                  : "Sans acompte à encaisser"
              }
            />
            <li className="flex items-center gap-2">
              <Badge>À vérifier</Badge>
              <span className="min-w-0">
                Disponibilité de l’équipe : {linkTo("/temps", "voir la capacité")}
              </span>
            </li>
          </ul>
        </Subsection>

        <Subsection title="Document officiel">
          <InfoRows
            rows={[
              { key: "indy", label: "Référence", value: quote.indyReference ?? "—" },
              {
                key: "url",
                label: "Document",
                value: quote.officialDocumentUrl ? (
                  <a
                    href={quote.officialDocumentUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline hover:underline-offset-4"
                  >
                    Ouvrir
                  </a>
                ) : (
                  "—"
                ),
              },
              ...(detail.hasSignedDocument
                ? [
                    {
                      key: "signe",
                      label: "Document signé",
                      value: signature.signatureConfigured ? (
                        <a
                          href={`/devis/${quote.id}/document-signe`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent hover:underline hover:underline-offset-4"
                        >
                          Ouvrir dans DocuSeal
                        </a>
                      ) : (
                        `DocuSeal n° ${quote.docusealSubmissionId}`
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {documentUnavailable ? (
            <Alert tone="warn">
              DocuSeal n’a pas pu rendre le document signé. Réessayez dans quelques instants.
            </Alert>
          ) : null}
          <p className="text-xs text-muted">
            Nuera OS garde la référence : le document légal reste émis dans Indy.
          </p>
        </Subsection>

        <Subsection title="Versions">
          <ul className="flex flex-col gap-2">
            {detail.versions.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={
                    item.id === detail.currentVersion.id ? versionHref() : versionHref(item.version)
                  }
                  aria-current={item.id === version.id ? "true" : undefined}
                  className={cn(
                    "hit-44 min-w-0 truncate hover:underline hover:underline-offset-4",
                    item.id === version.id ? "font-semibold text-ink" : "text-accent",
                  )}
                >
                  Version {item.version}
                  {item.changeNote ? ` · ${item.changeNote}` : ""}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  {item.id === acceptedVersionId ? <Badge tone="success">Acceptée</Badge> : null}
                  <span className="tabular text-xs text-muted">
                    {item.sentAt ? formatDateShort(item.sentAt) : "non envoyée"}
                  </span>
                  <span className="tabular text-xs text-ink">{formatCents(item.totalCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Subsection>

        {detail.amendments.length > 0 || detail.actions.amend ? (
          <Subsection title="Avenants">
            {detail.amendments.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {detail.amendments.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      href={`/devis/${item.id}`}
                      className="hit-44 min-w-0 truncate text-accent hover:underline hover:underline-offset-4"
                    >
                      {item.number} · {item.title}
                    </Link>
                    <StatusBadge kind="quote" status={item.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Aucun avenant.</p>
            )}
          </Subsection>
        ) : null}

        <Subsection title="Historique">
          <ActivityList
            items={historyEntries(detail)}
            empty={<p className="text-sm text-muted">Aucun événement.</p>}
          />
        </Subsection>
      </Tile>
    </div>
  );
}

function linkTo(href: string, label: string) {
  return (
    <Link href={href} className="text-accent hover:underline hover:underline-offset-4">
      {label}
    </Link>
  );
}

function StartCondition({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <Badge tone={done ? "success" : "neutral"}>{done ? "Fait" : "À faire"}</Badge>
      <span className="min-w-0">{label}</span>
    </li>
  );
}
