import { and, asc, eq, isNull } from "drizzle-orm";
import { paymentScheduleItems } from "@/server/db/schema";
import type { PortalContext } from "@/server/context";
import type { ScheduleItemStatus } from "@/lib/domain-enums";
import * as repository from "./finance.repository";
import { parisDay } from "./finance.dates";

/**
 * Carte « Paiements » du portail : ce que le client a réglé, ce qu'il reste, la prochaine échéance.
 * Calculé pour un projet déjà contrôlé, sur son `companyId`. Montants de vente HT : ni coût ni marge.
 */
export interface PortalPayments {
  paidCents: number;
  /** `null` : aucune échéance et aucun montant vendu, la carte ne peut rien affirmer. */
  totalCents: number | null;
  remainingCents: number | null;
  items: {
    id: string;
    label: string;
    dueOn: string | null;
    amountCents: number;
    status: ScheduleItemStatus;
  }[];
}

export async function getProjectPaymentsForPortal(
  ctx: Pick<PortalContext, "db" | "companyId">,
  projectId: string,
  options: { soldCents: number | null; now?: Date },
): Promise<PortalPayments> {
  const items = await ctx.db
    .select({
      id: paymentScheduleItems.id,
      label: paymentScheduleItems.label,
      dueOn: paymentScheduleItems.dueOn,
      amountCents: paymentScheduleItems.amountCents,
      status: paymentScheduleItems.status,
    })
    .from(paymentScheduleItems)
    .where(
      and(
        eq(paymentScheduleItems.companyId, ctx.companyId),
        eq(paymentScheduleItems.projectId, projectId),
        isNull(paymentScheduleItems.archivedAt),
      ),
    )
    .orderBy(asc(paymentScheduleItems.dueOn));

  const invoices = await repository.listInvoicesLimited(
    ctx.db,
    { companyId: ctx.companyId, projectId, onlyClientVisible: true, status: "paid" },
    200,
    parisDay(options.now ?? new Date()),
  );

  const scheduledPaid = items
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const invoicedPaid = invoices.reduce(
    (sum, row) => sum + (row.kind === "credit_note" ? -row.amountCents : row.amountCents),
    0,
  );
  const paidCents = Math.max(scheduledPaid, invoicedPaid);
  const scheduledTotal = items.reduce((sum, item) => sum + item.amountCents, 0);
  const totalCents = scheduledTotal > 0 ? scheduledTotal : options.soldCents;

  return {
    paidCents,
    totalCents,
    remainingCents: totalCents === null ? null : Math.max(0, totalCents - paidCents),
    items,
  };
}
