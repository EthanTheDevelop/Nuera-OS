"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CompactButton } from "@/components/ui/compact-button";
import { Select } from "@/components/ui/form";
import { InfoCard } from "@/components/ui/info-card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { writeAppearance, type Accent, type Theme } from "@/lib/appearance";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import {
  revokeAllMySessionsAction,
  revokeMySessionAction,
  saveProfileAction,
} from "../admin.actions";
import type { ProfileView } from "../profile.service";
import { PasswordSection, TwoFactorSection } from "./security-sections";

const THEME_CHOICES: readonly {
  value: "light" | "dark" | "system";
  label: string;
  dark: boolean;
}[] = [
  { value: "light", label: "Clair", dark: false },
  { value: "dark", label: "Sombre", dark: true },
  { value: "system", label: "Automatique", dark: false },
];

const ACCENT_CHOICES: readonly { value: Accent; label: string; color: string }[] = [
  { value: "blue", label: "Bleu", color: "#4368b1" },
  { value: "ink", label: "Encre", color: "#233353" },
  { value: "chatgpt", label: "Vert", color: "#0d8a6b" },
  { value: "warn", label: "Ocre", color: "#8a6516" },
  { value: "danger", label: "Brique", color: "#b4451f" },
];

/** La base dit `system`, le cookie d'apparence dit `auto`. */
function toAppearanceTheme(theme: "light" | "dark" | "system"): Theme {
  return theme === "system" ? "auto" : theme;
}

export function ProfileScreen({
  profile,
  homeOptions,
  enrolmentRequired,
}: {
  profile: ProfileView;
  homeOptions: readonly { href: string; label: string }[];
  enrolmentRequired: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [theme, setTheme] = useState(profile.appearance.theme);
  // Le thème change aussi depuis le menu du profil, écran ouvert : le choix enregistré fait foi.
  const [savedTheme, setSavedTheme] = useState(profile.appearance.theme);
  if (savedTheme !== profile.appearance.theme) {
    setSavedTheme(profile.appearance.theme);
    setTheme(profile.appearance.theme);
  }
  const [accent, setAccent] = useState(profile.appearance.accent as Accent);
  const [density, setDensity] = useState(profile.appearance.density);
  const [homePath, setHomePath] = useState(profile.appearance.homePath);
  const [dailyDigest, setDailyDigest] = useState(profile.dailyDigest);
  const [preferences, setPreferences] = useState(profile.notifications);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  function save() {
    startSaving(async () => {
      const state = await saveProfileAction({
        theme,
        accent,
        density,
        homePath,
        dailyDigest,
        preferences: preferences.map(({ kind, inApp, email }) => ({ kind, inApp, email })),
      });
      if (state.status === "error") {
        toast({ message: state.message, tone: "danger" });
        return;
      }
      writeAppearance({ theme: toAppearanceTheme(theme), accent, density });
      toast({ message: "Préférences enregistrées.", tone: "success" });
      router.refresh();
    });
  }

  function setPreference(kind: string, patch: { inApp?: boolean; email?: boolean }) {
    setPreferences((current) =>
      current.map((entry) => (entry.kind === kind ? { ...entry, ...patch } : entry)),
    );
  }

  async function revokeOne(id: string) {
    const state = await revokeMySessionAction(id);
    if (state.status !== "idle") {
      toast({ message: state.message, tone: state.status === "error" ? "danger" : "success" });
    }
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Mon profil"
        subtitle="Ce que vous voyez, et comment Nuera OS vous prévient"
        actions={
          <Button variant="accent" loading={saving} onClick={save}>
            Enregistrer
          </Button>
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,688fr)_minmax(0,420fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section
            aria-label="Identité"
            className="anim-content flex items-center gap-5 rounded-lg bg-surface p-6 shadow-soft"
          >
            <Avatar name={profile.identity.name} size={64} />
            <div className="min-w-0">
              <h2 className="text-lg font-medium text-ink">{profile.identity.name}</h2>
              {profile.identity.title ? (
                <p className="text-xs text-muted">{profile.identity.title}</p>
              ) : null}
              <p className="truncate text-xs text-muted">{profile.identity.email}</p>
            </div>
          </section>

          <section
            id="apparence"
            aria-labelledby="apparence-titre"
            className="anim-content flex scroll-mt-6 flex-col gap-5 rounded-lg bg-surface p-6 shadow-soft"
          >
            <h2 id="apparence-titre" className="text-tile-title text-ink">
              Apparence
            </h2>
            <div
              role="radiogroup"
              aria-label="Thème"
              className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,168px))]"
            >
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === choice.value}
                  onClick={() => setTheme(choice.value)}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border bg-surface p-2.5 text-left text-xs font-medium transition-colors duration-(--dur-fast)",
                    theme === choice.value
                      ? "border-accent text-accent"
                      : "border-border text-text hover:bg-surface-raised",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-14 rounded-sm border border-border sm:h-[90px]",
                      choice.dark ? "bg-near-black" : "bg-paper",
                    )}
                  />
                  {choice.label}
                </button>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs text-text">Couleur d&apos;accent</p>
              <div role="radiogroup" aria-label="Couleur d'accent" className="flex gap-3">
                {ACCENT_CHOICES.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={accent === choice.value}
                    aria-label={choice.label}
                    onClick={() => setAccent(choice.value)}
                    style={{ backgroundColor: choice.color }}
                    className={cn(
                      "hit-44 size-7 rounded-full outline-offset-2",
                      accent === choice.value && "outline-2 outline-accent",
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-text">Langue</span>
              <span className="text-sm text-muted">Français</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <label htmlFor="profil-accueil" className="text-sm font-medium text-text">
                Page d&apos;accueil
              </label>
              <Select
                id="profil-accueil"
                value={homePath}
                className="w-56"
                onChange={(event) => setHomePath(event.target.value)}
              >
                {homeOptions.map((option) => (
                  <option key={option.href} value={option.href}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <label htmlFor="profil-densite" className="text-sm font-medium text-text">
                Densité
              </label>
              <Select
                id="profil-densite"
                value={density}
                className="w-56"
                onChange={(event) => setDensity(event.target.value as typeof density)}
              >
                <option value="comfortable">Confortable</option>
                <option value="compact">Compacte</option>
              </Select>
            </div>
          </section>

          <section
            id="securite"
            aria-labelledby="securite-titre"
            className="anim-content flex scroll-mt-6 flex-col gap-6 rounded-lg bg-surface p-6 shadow-soft"
          >
            <h2 id="securite-titre" className="text-tile-title text-ink">
              Sécurité
            </h2>
            <TwoFactorSection
              enabled={profile.twoFactorEnabled}
              required={profile.twoFactorRequired}
              showRequiredNotice={enrolmentRequired}
            />
            <PasswordSection />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <InfoCard icon="bell" title="Me prévenir quand…">
            <div className="flex items-center justify-end gap-4 text-xs text-muted">
              <span className="w-9 text-center">Ici</span>
              <span className="w-9 text-center">E-mail</span>
            </div>
            <ul className="flex flex-col gap-2">
              {preferences.map((entry) => (
                <li key={entry.kind} className="flex min-h-7 items-center justify-between gap-4">
                  <span className="min-w-0 flex-1 text-sm text-text">{entry.label}</span>
                  <Switch
                    hideLabel
                    label={`${entry.label}, dans Nuera OS`}
                    checked={entry.inApp}
                    onCheckedChange={(inApp) => setPreference(entry.kind, { inApp })}
                  />
                  <Switch
                    hideLabel
                    label={`${entry.label}, par e-mail`}
                    checked={entry.email}
                    onCheckedChange={(email) => setPreference(entry.kind, { email })}
                  />
                </li>
              ))}
              <li className="flex min-h-7 items-center justify-between gap-4 border-t border-border pt-3">
                <span className="min-w-0 flex-1 text-sm text-text">Résumé chaque matin</span>
                <Switch
                  hideLabel
                  label="Résumé chaque matin, par e-mail"
                  checked={dailyDigest}
                  onCheckedChange={setDailyDigest}
                />
              </li>
            </ul>
          </InfoCard>

          <InfoCard icon="server" title="Sessions ouvertes">
            <ul className="flex flex-col gap-2">
              {profile.sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-text">{session.label}</span>
                  {session.current ? (
                    <span className="text-xs text-muted">maintenant</span>
                  ) : (
                    <>
                      <span className="text-xs text-muted">
                        {formatRelativeTime(session.lastActiveAt)}
                      </span>
                      <CompactButton variant="quiet" onClick={() => revokeOne(session.id)}>
                        Fermer
                      </CompactButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {profile.sessionsTotal > profile.sessions.length ? (
              <p className="text-xs text-muted">
                Et {profile.sessionsTotal - profile.sessions.length} autres, plus anciennes.
              </p>
            ) : null}
            <div>
              <Button onClick={() => setConfirmRevoke(true)}>Se déconnecter partout</Button>
            </div>
          </InfoCard>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        title="Se déconnecter partout ?"
        description="Toutes vos sessions se ferment, y compris celle-ci. Il faudra vous reconnecter."
        confirmLabel="Se déconnecter partout"
        tone="danger"
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={async () => {
          const state = await revokeAllMySessionsAction();
          if (state?.status === "error") {
            toast({ message: state.message, tone: "danger" });
            setConfirmRevoke(false);
          }
        }}
      />
    </>
  );
}
