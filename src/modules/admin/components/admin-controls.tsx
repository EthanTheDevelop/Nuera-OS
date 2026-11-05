"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { FormAlert, Input, SelectField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import {
  changeUserRoleAction,
  inviteUserAction,
  revokeUserSessionsAction,
  sendAccessLinkAction,
  setTwoFactorRequiredAction,
  setUserActiveAction,
  type InviteState,
} from "../admin.actions";

const INTERNAL_ROLE_OPTIONS = [
  { value: "admin", label: "Associé · admin" },
  { value: "member", label: "Collaborateur" },
  { value: "contractor", label: "Prestataire" },
  { value: "viewer", label: "Lecture" },
];

/** Lien à usage unique : affiché une fois, à transmettre soi-même, quand aucun e-mail ne peut partir. */
function OneTimeLink({ link }: { link: string }) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="warn">
        Le serveur d&apos;envoi n&apos;est pas configuré : aucun e-mail n&apos;est parti.
        Transmettez ce lien à la personne par un canal sûr. Il ne s&apos;affichera plus, et reste
        valable 7 jours.
      </Alert>
      <Input readOnly value={link} aria-label="Lien à usage unique" className="font-mono text-xs" />
      <div>
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            toast({ message: "Lien copié.", tone: "success" });
          }}
        >
          Copier le lien
        </Button>
      </div>
    </div>
  );
}

export function InviteUserButton() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <Button
        variant="accent"
        onClick={() => {
          setGeneration((value) => value + 1);
          setOpen(true);
        }}
      >
        + Inviter un utilisateur
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Inviter un utilisateur"
        description="La personne choisit elle-même son mot de passe, par un lien à usage unique."
        width={480}
      >
        <InviteForm key={generation} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const IDLE_INVITE: InviteState = { status: "idle" };

function InviteForm({ onDone }: { onDone: () => void }) {
  const [state, action] = useActionState(inviteUserAction, IDLE_INVITE);
  useActionToast(state);
  const closed = useRef(false);
  const emailed = state.status === "success" && !state.link;
  useEffect(() => {
    if (emailed && !closed.current) {
      closed.current = true;
      onDone();
    }
  }, [emailed, onDone]);

  if (state.status === "success" && state.link) {
    return (
      <ModalRow>
        <OneTimeLink link={state.link} />
      </ModalRow>
    );
  }
  return (
    <form action={action} className="contents">
      <ModalRow className="flex flex-col gap-4">
        <FormAlert state={state} />
        <TextField
          name="name"
          label="Nom"
          state={state}
          required
          autoComplete="off"
          data-autofocus
        />
        <TextField
          name="email"
          type="email"
          label="E-mail"
          state={state}
          required
          autoComplete="off"
        />
        <SelectField name="role" label="Rôle" state={state} defaultValue="member">
          {INTERNAL_ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow className="flex justify-end gap-3">
        <Button onClick={onDone}>Annuler</Button>
        <SubmitButton>Inviter</SubmitButton>
      </ModalRow>
    </form>
  );
}

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  isSelf: boolean;
}

export function ManageUserButton({ user }: { user: ManagedUser }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"deactivate" | "sessions" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const [roleState, roleAction] = useActionState(changeUserRoleAction, IDLE_ACTION_STATE);
  useActionToast(roleState);
  const isClient = user.role === "client";

  function report(state: ActionState) {
    if (state.status !== "idle") {
      toast({ message: state.message, tone: state.status === "error" ? "danger" : "success" });
    }
    router.refresh();
  }

  return (
    <>
      <CompactButton
        variant="quiet"
        aria-label={`Gérer le compte de ${user.name}`}
        onClick={() => {
          setLink(null);
          setOpen(true);
        }}
      >
        Gérer
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={user.name}
        description={user.email}
        width={480}
      >
        {link ? (
          <ModalRow>
            <OneTimeLink link={link} />
          </ModalRow>
        ) : null}
        {isClient ? (
          <ModalRow>
            <p className="text-sm text-text">
              Compte de l&apos;espace client : le rôle ne change pas, et l&apos;accès se gère depuis
              la fiche du client.
            </p>
          </ModalRow>
        ) : (
          <form action={roleAction} className="contents">
            <ModalRow className="flex flex-col gap-3">
              <input type="hidden" name="userId" value={user.id} />
              <FormAlert state={roleState} />
              <SelectField name="role" label="Rôle" state={roleState} defaultValue={user.role}>
                {INTERNAL_ROLE_OPTIONS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </SelectField>
              <div className="flex justify-end">
                <SubmitButton variant="default">Changer le rôle</SubmitButton>
              </div>
            </ModalRow>
          </form>
        )}
        <ModalRow className="flex flex-wrap gap-3">
          {!isClient && !user.banned ? (
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const state = await sendAccessLinkAction(user.id);
                  report(state);
                  if (state.status === "success" && state.link) setLink(state.link);
                })
              }
            >
              Envoyer un lien d&apos;accès
            </Button>
          ) : null}
          <Button onClick={() => setConfirm("sessions")}>Fermer ses sessions</Button>
          {user.banned ? (
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  report(await setUserActiveAction(user.id, true));
                  setOpen(false);
                })
              }
            >
              Réactiver
            </Button>
          ) : user.isSelf ? null : (
            <Button onClick={() => setConfirm("deactivate")}>Désactiver</Button>
          )}
        </ModalRow>
      </Modal>
      <ConfirmDialog
        open={confirm === "deactivate"}
        title={`Désactiver le compte de ${user.name} ?`}
        description="La personne est déconnectée tout de suite et ne peut plus se connecter. Rien n'est supprimé : le compte se réactive à tout moment."
        confirmLabel="Désactiver"
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          report(await setUserActiveAction(user.id, false));
          setConfirm(null);
          setOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirm === "sessions"}
        title={`Fermer les sessions de ${user.name} ?`}
        description={
          user.isSelf
            ? "Vous serez déconnecté·e de cet appareil aussi."
            : "La personne devra se reconnecter sur tous ses appareils."
        }
        confirmLabel="Fermer les sessions"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          report(await revokeUserSessionsAction(user.id));
          setConfirm(null);
          setOpen(false);
        }}
      />
    </>
  );
}

export function ExportButton({
  label,
  variant = "default",
  datasets,
}: {
  label: string;
  variant?: "default" | "accent";
  datasets: readonly { key: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Exporter les données"
        description="L'export est journalisé. Il ne contient aucun mot de passe, jeton ni secret."
        width={480}
      >
        {/* Vraie requête du navigateur : le fichier se télécharge, sans passer par la mémoire de la page. */}
        <form method="get" action="/api/export" className="contents">
          <ModalRow className="flex flex-col gap-4">
            <SelectField name="jeu" label="Données" defaultValue="tout">
              <option value="tout">Toutes les données métier (JSON)</option>
              <option value="comptes">Comptes</option>
              {datasets.map((dataset) => (
                <option key={dataset.key} value={dataset.key}>
                  {dataset.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              name="format"
              label="Format"
              defaultValue="csv"
              hint="L'export complet est toujours en JSON."
            >
              <option value="csv">CSV (Excel)</option>
              <option value="json">JSON</option>
            </SelectField>
          </ModalRow>
          <ModalRow className="flex justify-end gap-3">
            <Button onClick={() => setOpen(false)}>Fermer</Button>
            <Button type="submit" variant="accent" icon="download">
              Télécharger
            </Button>
          </ModalRow>
        </form>
      </Modal>
    </>
  );
}

export function RequireTwoFactorSwitch({
  required,
  canManage,
}: {
  required: boolean;
  canManage: boolean;
}) {
  const [on, setOn] = useState(required);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Switch
      label="Exiger la double authentification"
      description="Pour tous les comptes de l'équipe. Un compte sans elle est renvoyé vers son profil pour l'activer."
      checked={on}
      disabled={!canManage || pending}
      onCheckedChange={(next) => {
        setOn(next);
        start(async () => {
          const state = await setTwoFactorRequiredAction(next);
          if (state.status === "error") setOn(!next);
          if (state.status !== "idle") {
            toast({
              message: state.message,
              tone: state.status === "error" ? "danger" : "success",
            });
          }
          router.refresh();
        });
      }}
    />
  );
}
