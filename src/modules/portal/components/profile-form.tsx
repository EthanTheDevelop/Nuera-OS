"use client";

import { useActionState, useEffect } from "react";
import {
  PORTAL_PAGE,
  PORTAL_ROW,
  PORTAL_SCROLL,
  PortalCard,
  PortalPageHeader,
} from "@/components/portal/portal-card";
import { useSignOut } from "@/components/layout/profile-menu";
import { Avatar } from "@/components/ui/avatar";
import { CompactButton } from "@/components/ui/compact-button";
import { Field, FormAlert, Input, TextField } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/format";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { updateProfileAction } from "../portal.actions";
import { describeDevice } from "../portal.format";

const NOTIFICATIONS = [
  ["notifyMessage", "Un message de l'équipe m'attend"],
  ["notifyValidation", "Une maquette est à valider"],
  ["notifyInvoice", "Une facture est disponible"],
  ["notifyRequirement", "Un rappel pour mes contenus"],
  ["notifyReport", "Le rapport mensuel est prêt"],
] as const;

/** Écran C8. Le nom est celui du compte ; l'entreprise, l'e-mail et le téléphone viennent de la fiche. */
export function ProfileForm({
  name,
  email,
  companyName,
  phone,
  preferences,
  devices,
}: {
  name: string;
  email: string;
  companyName: string;
  phone: string | null;
  preferences: Record<(typeof NOTIFICATIONS)[number][0], boolean>;
  devices: readonly { id: string; userAgent: string | null; lastActiveAt: Date }[];
}) {
  const toast = useToast();
  const { signOut, pending: signingOut } = useSignOut("/espace/connexion");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateProfileAction,
    IDLE_ACTION_STATE,
  );

  useEffect(() => {
    if (state.status === "success") toast({ message: state.message, tone: "success" });
  }, [state, toast]);

  return (
    <form action={formAction} className={PORTAL_PAGE}>
      <PortalPageHeader
        title="Mon profil"
        subtitle="Vos informations et la façon dont nous vous prévenons"
        actions={
          <CompactButton type="submit" icon="check" loading={pending}>
            Enregistrer
          </CompactButton>
        }
      />
      <FormAlert state={state.status === "error" ? state : IDLE_ACTION_STATE} />
      <div className={`${PORTAL_ROW} lg:grid-cols-2 xl:grid-cols-3`}>
        <PortalCard className="gap-4 lg:justify-between">
          <Avatar name={name} size={64} />
          <TextField name="name" label="Nom" defaultValue={name} state={state} required />
          <Field id="profile-company" label="Entreprise">
            <Input id="profile-company" value={companyName} disabled readOnly />
          </Field>
          <Field id="profile-email" label="E-mail de connexion">
            <Input id="profile-email" type="email" value={email} disabled readOnly />
          </Field>
          <Field
            id="profile-phone"
            label="Téléphone"
            hint="Pour changer d'entreprise, d'e-mail ou de téléphone, écrivez-nous : nous mettons votre fiche à jour."
          >
            <Input id="profile-phone" value={phone ?? "Non renseigné"} disabled readOnly />
          </Field>
        </PortalCard>
        <div className="flex min-w-0 flex-col gap-6 xl:contents">
          <PortalCard title="M'écrire quand…" className="gap-4 lg:flex-1">
            <div className="flex flex-col gap-4 lg:flex-1 lg:gap-0">
              {NOTIFICATIONS.map(([key, label]) => (
                <div
                  key={key}
                  className="lg:flex lg:flex-[1_0_auto] lg:items-center lg:border-t lg:border-border lg:py-2 lg:*:w-full"
                >
                  <Switch name={key} label={label} defaultChecked={preferences[key]} />
                </div>
              ))}
            </div>
          </PortalCard>
          <PortalCard title="Connexion" className="lg:flex-1">
            <p className="text-sm text-muted">
              Sans mot de passe : un lien par e-mail, valable 24 h.
            </p>
            <ul className={`flex flex-col gap-2 ${PORTAL_SCROLL}`}>
              {devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {describeDevice(device.userAgent)}
                  </span>
                  <span className="shrink-0 text-muted">
                    {formatRelativeTime(device.lastActiveAt)}
                  </span>
                </li>
              ))}
            </ul>
            <div>
              <CompactButton variant="quiet" onClick={signOut} disabled={signingOut}>
                Se déconnecter
              </CompactButton>
            </div>
          </PortalCard>
        </div>
      </div>
    </form>
  );
}
