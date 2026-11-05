import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NotificationList } from "@/components/layout/notifications";
import { EmptyState } from "@/components/states/states";
import { DataTablePagination } from "@/components/ui/data-table";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { MarkAllReadButton } from "@/modules/platform/components/automation-controls";
import { listMyNotifications } from "@/modules/platform/notifications.service";
import { getServiceContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Notifications" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Le panneau de notifications sans écran (figma-map §8) : l'historique complet du compte. */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getServiceContext();
  const params = await searchParams;
  const unreadOnly = one(params.filtre) === "non-lues";
  const result = await listMyNotifications(ctx, {
    page: one(params.page),
    pageSize: 30,
    unreadOnly,
  });
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Ce qui demande votre attention, et ce qui s'est passé"
        breadcrumbs={[{ label: "Mon profil", href: "/profil" }, { label: "Notifications" }]}
        actions={result.items.some((item) => item.unread) ? <MarkAllReadButton /> : null}
      >
        <FilterBar label="Filtrer les notifications">
          <FilterChip param="filtre">Toutes</FilterChip>
          <FilterChip param="filtre" value="non-lues">
            Non lues
          </FilterChip>
        </FilterBar>
      </PageHeader>
      <div className="anim-content rounded-lg bg-surface shadow-soft">
        {result.items.length === 0 ? (
          <EmptyState
            compact
            icon="bell"
            title={unreadOnly ? "Tout est lu" : "Aucune notification"}
            description="Les alertes des automatisations et les mentions arrivent ici."
          />
        ) : (
          <NotificationList items={result.items} />
        )}
        <DataTablePagination
          query={{
            pathname: "/profil/notifications",
            searchParams: { filtre: one(params.filtre) },
          }}
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
        />
      </div>
    </>
  );
}
