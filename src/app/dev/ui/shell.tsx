import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ProfileMenu } from "@/components/layout/profile-menu";
import { Sidebar } from "@/components/layout/sidebar";
import { PageBuild } from "@/components/motion/page-build";
import { NAVIGATION } from "@/config/navigation";
import { demoSearch } from "./actions";
import { COUNTERS, NOTIFICATIONS, PEOPLE, USER } from "./fixtures";

/** Coque réelle de l'agence, nourrie de données fictives. */
export function DevShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      navigation={NAVIGATION.flatMap((section) =>
        section.items.map(({ key, label, href, icon }) => ({ id: key, label, href, icon })),
      )}
      search={demoSearch}
      sidebar={
        <Sidebar
          sections={NAVIGATION}
          counters={COUNTERS}
          userBlock={
            <ProfileMenu
              user={USER}
              title="Ethan et Nezar"
              detail="Nuera Studio · 2 associés"
              people={PEOPLE}
              notifications={NOTIFICATIONS}
              canManageAgency
              chatgptLabel="Connecté"
            />
          }
        />
      }
    >
      <PageBuild>{children}</PageBuild>
    </AppShell>
  );
}
