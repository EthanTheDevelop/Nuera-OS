import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { Tile } from "@/components/ui/tile";
import { formatDateShort } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import {
  NewOpportunityButton,
  type OpportunityFormOptions,
} from "@/modules/sales/components/opportunity-form";
import type { OpportunityView } from "@/modules/sales/opportunity.service";

/** Affaires du client, les ouvertes d'abord. Absente pour un rôle sans lecture des ventes. */
export function OpportunitiesSection({
  company,
  opportunities,
  createOptions,
}: {
  company: { id: string; name: string };
  opportunities: readonly OpportunityView[];
  /** Absent : le rôle ne crée pas d'affaire, ou la fiche est archivée. */
  createOptions?: OpportunityFormOptions;
}) {
  return (
    <Tile
      icon="pipeline"
      title="Affaires"
      aside={
        createOptions ? (
          <NewOpportunityButton options={createOptions} defaultCompany={company} compact />
        ) : null
      }
      className="rounded-lg p-6"
    >
      {opportunities.length === 0 ? (
        <p className="text-sm text-muted">Aucune affaire pour ce client.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {opportunities.map((opportunity) => (
            <li
              key={opportunity.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1 basis-48">
                <Link
                  href={`/pipeline/${opportunity.id}`}
                  className="hit-44 block truncate text-sm font-medium text-text hover:underline hover:underline-offset-4"
                >
                  {opportunity.name}
                </Link>
                {opportunity.nextAction ? (
                  <p className="truncate text-xs text-muted">
                    {opportunity.nextAction}
                    {opportunity.nextActionOn
                      ? ` · ${formatDateShort(opportunity.nextActionOn)}`
                      : ""}
                  </p>
                ) : opportunity.stage === "LOST" && opportunity.lostReason ? (
                  <p className="truncate text-xs text-muted">{opportunity.lostReason}</p>
                ) : null}
              </div>
              <span className="tabular text-sm text-text">
                {opportunity.amountCents === null ? "—" : formatCentsHT(opportunity.amountCents)}
              </span>
              <StatusBadge kind="opportunity" status={opportunity.stage} />
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
