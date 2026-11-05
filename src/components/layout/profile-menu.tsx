"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import {
  MenuItem,
  MenuList,
  MenuSeparator,
  MenuSwitchItem,
  Popover,
} from "@/components/ui/popover";
import { writeAppearance } from "@/lib/appearance";
import type { ActionState } from "@/lib/action-state";
import { getAuthClient } from "@/lib/auth-client";
import { NotificationList, type NotificationEntry } from "./notifications";

/** Appliquée tout de suite, puis enregistrée sur le compte. Refusée : retour au thème précédent. */
function ThemeRow({ saveTheme }: { saveTheme?: SaveTheme }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const apply = (next: boolean) => {
    setDark(next);
    writeAppearance({ theme: next ? "dark" : "light" });
  };
  return (
    <MenuSwitchItem
      checked={dark}
      onCheckedChange={(next) => {
        apply(next);
        void saveTheme?.(next ? "dark" : "light").then(
          (state) => {
            if (state.status === "error") apply(!next);
          },
          () => apply(!next),
        );
      }}
    >
      Thème sombre
    </MenuSwitchItem>
  );
}

/** Déconnexion réelle : session révoquée côté serveur, puis retour à la connexion. */
export function useSignOut(redirectTo = "/login") {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      await getAuthClient().signOut();
      router.replace(redirectTo);
      router.refresh();
    });
  return { signOut, pending };
}

type SaveTheme = (theme: "light" | "dark") => Promise<ActionState>;

export interface ProfileMenuUser {
  name: string;
  email: string;
  roleLabel: string;
}

/**
 * Bloc utilisateur de la barre latérale + menu du profil (écran 13) : voile cliquable, 300 de large.
 *
 * Seules les entrées qui fonctionnent sont là. « Passer sur le compte d'Ethan » n'est pas construit :
 * l'usurpation d'identité est refusée à tous les rôles par conception (src/server/auth/auth.ts).
 *
 * - `people` : avatars du bloc (les associés, depuis le module Équipe). Défaut : l'utilisateur.
 * - `canManageAgency` : `integrations:read`, affiche ChatGPT et Réglages de l'agence.
 * - `chatgptLabel` : état réel de la connexion. Sans valeur, pas de badge.
 * - `saveTheme` : enregistre le thème sur le compte, sinon `/profil` afficherait l'ancien.
 */
export function ProfileMenu({
  user,
  title,
  detail,
  people,
  notifications = [],
  canManageAgency = false,
  chatgptLabel,
  saveTheme,
}: {
  user: ProfileMenuUser;
  title: string;
  detail: string;
  people?: readonly { name: string; initials?: string }[];
  notifications?: readonly NotificationEntry[];
  canManageAgency?: boolean;
  chatgptLabel?: string;
  saveTheme?: SaveTheme;
}) {
  const { signOut, pending } = useSignOut();
  const [view, setView] = useState<"menu" | "notifications">("menu");
  const unread = notifications.filter((item) => item.unread).length;

  return (
    <Popover
      label="Menu du profil"
      veil="menu"
      placement="top-start"
      onOpenChange={(open) => {
        if (open) setView("menu");
      }}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Menu du profil, ${user.name}`}
          className="flex w-full items-center gap-2 rounded-md bg-surface-raised-dark p-2 text-left transition-colors duration-(--dur-fast) outline-none hover:bg-hairline-on-dark focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-on-dark"
        >
          <AvatarStack people={people ?? [{ name: user.name }]} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-user-title text-paper">{title}</span>
            <span className="block truncate text-user-detail text-accent-on-dark">{detail}</span>
          </span>
        </button>
      )}
    >
      {(close) =>
        view === "notifications" ? (
          <div className="w-[min(300px,calc(100vw-16px))]">
            <div className="flex items-center gap-2 border-b border-border px-2 py-2">
              <button
                type="button"
                onClick={() => setView("menu")}
                aria-label="Retour au menu"
                className="flex size-9 items-center justify-center rounded-sm text-text hover:bg-surface-raised"
              >
                <Icon name="chevron" size={16} className="rotate-180" />
              </button>
              <p className="text-tile-title text-ink">Notifications</p>
            </div>
            <NotificationList items={notifications} onNavigate={close} />
          </div>
        ) : (
          <div className="flex w-[min(300px,calc(100vw-16px))] flex-col gap-1 p-2">
            <div className="flex items-center gap-3 p-3">
              <Avatar name={user.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-tile-title text-ink">{user.name}</p>
                <p className="truncate text-xs leading-[1.25] text-muted">
                  {user.email} · {user.roleLabel.toLocaleLowerCase("fr-FR")}
                </p>
              </div>
            </div>
            <MenuSeparator />
            <MenuList label="Mon compte">
              <MenuItem icon="clients" href="/profil" onSelect={close}>
                Mon profil
              </MenuItem>
              <MenuItem icon="edit" href="/profil#apparence" onSelect={close}>
                Personnaliser
              </MenuItem>
              <MenuItem
                icon="bell"
                onSelect={() => setView("notifications")}
                aside={unread > 0 ? <Badge tone="neutral">{unread}</Badge> : null}
              >
                Notifications
              </MenuItem>
              {canManageAgency ? (
                <>
                  <MenuItem
                    icon="sparkle"
                    href="/reglages/connexions"
                    onSelect={close}
                    aside={chatgptLabel ? <Badge tone="chatgpt">{chatgptLabel}</Badge> : null}
                  >
                    ChatGPT
                  </MenuItem>
                  <MenuItem icon="reglages" href="/reglages/connexions" onSelect={close}>
                    Réglages de l’agence
                  </MenuItem>
                </>
              ) : null}
              <ThemeRow saveTheme={saveTheme} />
              <MenuSeparator />
              <MenuItem icon="chevron" danger disabled={pending} onSelect={signOut}>
                Se déconnecter
              </MenuItem>
            </MenuList>
          </div>
        )
      }
    </Popover>
  );
}
