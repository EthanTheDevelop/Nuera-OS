import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import type { CompanyRecord } from "../../company.service";

/**
 * En-tête de la fiche (écran 04) : fil d'Ariane mono, avatar 64, nom, badges sur la même colonne,
 * actions à droite. `PageHeader` place ses badges sous l'avatar : la maquette les veut à côté.
 */
export function RecordHeader({
  company,
  ownerName,
  signed,
  actions,
}: {
  company: CompanyRecord["company"];
  ownerName: string | null;
  /** Une affaire gagnée : le statut se lit « Client · signé » (écran 04). */
  signed: boolean;
  actions?: ReactNode;
}) {
  const place = [company.activity, company.city].filter(Boolean).join(" · ");
  return (
    <header className="mb-1 flex flex-col gap-6">
      <nav
        aria-label="Fil d'Ariane"
        className="anim-header font-mono text-table-head font-normal text-muted"
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/clients" className="hit-44 hover:text-text">
              Clients
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{company.name}</li>
        </ol>
      </nav>
      <div className="anim-header flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={company.name} size={64} />
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-page-title text-ink">{company.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {company.archivedAt ? <Badge tone="warn">Archivé</Badge> : null}
              <StatusBadge kind="company" status={company.status}>
                {company.status === "client" && signed ? "Client · signé" : undefined}
              </StatusBadge>
              {place ? <Badge>{place}</Badge> : null}
              {company.source ? <Badge>Origine : {company.source.toLowerCase()}</Badge> : null}
              {ownerName ? <Badge tone="accent">Suivi par {ownerName}</Badge> : null}
              {company.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
