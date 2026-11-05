import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ForbiddenState } from "@/components/states/states";
import { ForecastCard, SalesCard } from "@/modules/dashboard/components/reporting-cards";
import { ReportingFilters, ReportingView } from "@/modules/dashboard/components/reporting-view";
import { getReporting } from "@/modules/dashboard/reporting.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Reporting" };

/** Écran 16 et instant M2. Mêmes calculs que le tableau de bord (arbitrage A3). */
export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  if (!can(ctx.actor, "dashboard:read")) return <ForbiddenState />;

  const data = await getReporting(ctx, await searchParams);

  return (
    <>
      <PageHeader
        title="Reporting"
        subtitle={`${data.label} comparé à ${data.previousLabel}`}
        actions={
          <Suspense>
            <ReportingFilters data={data} />
          </Suspense>
        }
      />
      <Suspense>
        <ReportingView
          data={data}
          aside={
            data.sales || data.forecast ? (
              <>
                {data.sales ? <SalesCard section={data.sales} /> : null}
                {data.forecast ? <ForecastCard section={data.forecast} /> : null}
              </>
            ) : undefined
          }
        />
      </Suspense>
    </>
  );
}
