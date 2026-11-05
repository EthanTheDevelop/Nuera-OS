import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NotificationBell } from "@/components/layout/notifications";
import { PageHeader } from "@/components/layout/page-header";
import { TileSkeleton } from "@/components/states/states";
import { ButtonLink } from "@/components/ui/button";
import { formatDateLong } from "@/lib/format";
import { DashboardBoard } from "@/modules/dashboard/components/dashboard-board";
import { capitalize } from "@/modules/dashboard/reporting.periods";
import {
  getDashboard,
  getDashboardNotifications,
  resolveHomeRedirect,
} from "@/modules/dashboard/dashboard.service";
import { can } from "@/server/auth/permissions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";

export const metadata: Metadata = { title: "Tableau de bord" };

async function Board({ ctx, editing }: { ctx: ServiceContext; editing: boolean }) {
  const data = await getDashboard(ctx, { editing });
  return <DashboardBoard key={editing ? "edition" : "lecture"} data={data} editing={editing} />;
}

function BoardSkeleton() {
  return (
    <div className="@container" aria-busy="true">
      <div className="grid auto-rows-[minmax(168px,auto)] grid-cols-2 gap-(--grid-gap) @lg:grid-cols-4 @5xl:grid-cols-6">
        <TileSkeleton className="col-span-2 row-span-2 @lg:col-span-4" lines={3} />
        <TileSkeleton className="col-span-2 row-span-2" lines={4} />
        <TileSkeleton className="col-span-2" />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
      </div>
    </div>
  );
}

/** Écrans 01 et 06 : le mode édition est un état de l'adresse, `/?edition=1`. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  const requestHeaders = await headers();
  const destination = await resolveHomeRedirect(ctx, {
    referer: requestHeaders.get("referer"),
  });
  if (destination) redirect(destination);

  const editing = (await searchParams).edition === "1";
  const firstName = ctx.actor.name.trim().split(/\s+/)[0] ?? ctx.actor.name;
  const today = capitalize(formatDateLong(new Date()));
  const notifications = editing ? null : await getDashboardNotifications(ctx);

  return (
    <>
      <PageHeader
        title={`Bonjour ${firstName}`}
        subtitle={
          editing
            ? "Mode édition · glissez pour déplacer, la poignée change la taille, le rond retire la tuile"
            : `${today} · l’agence aujourd’hui`
        }
        bell={
          notifications ? (
            <NotificationBell
              items={notifications.items}
              unreadCount={notifications.unread}
              allHref="/profil/notifications"
            />
          ) : undefined
        }
        actions={
          editing ? undefined : (
            <>
              <ButtonLink href="/?edition=1">Modifier le tableau</ButtonLink>
              {can(ctx.actor, "sales:create") ? (
                <ButtonLink href="/pipeline?nouvelle=NEW" variant="accent" icon="plus">
                  Nouvelle affaire
                </ButtonLink>
              ) : null}
            </>
          )
        }
      />
      <Suspense fallback={<BoardSkeleton />}>
        <Board ctx={ctx} editing={editing} />
      </Suspense>
    </>
  );
}
