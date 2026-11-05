"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateShort, formatRelativeTime } from "@/lib/format";
import {
  invitePortalClientAction,
  issuePortalLinkAction,
  resendPortalInvitationAction,
  revokePortalAccessAction,
} from "../portal-access.actions";
import type { PortalAccessOverview, PortalAccessRow } from "../portal-access.service";

/** Ce qui s'est réellement passé : une invitation déposée n'est jamais dite envoyée. */
function accessStatus(row: PortalAccessRow): { label: string; detail?: string; tone: BadgeTone } {
  const { membership } = row;
  if (!membership) return { label: "Sans accès", tone: "neutral" };
  if (membership.status === "revoked") return { label: "Accès retiré", tone: "neutral" };
  if (membership.status === "active") {
    return {
      label: "Accès actif",
      detail: membership.lastSeenAt
        ? `Connexion ${formatRelativeTime(membership.lastSeenAt)}`
        : undefined,
      tone: "success",
    };
  }
  const delivery = membership.delivery;
  if (!delivery) return { label: "Invitation à envoyer", tone: "warn" };
  switch (delivery.status) {
    case "sent":
      return {
        label: "Invitation envoyée",
        detail: delivery.sentAt ? `Le ${formatDateShort(delivery.sentAt)}` : undefined,
        tone: "accent",
      };
    case "failed":
      return {
        label: "Échec de l'envoi",
        detail: "L'e-mail n'est pas parti.",
        tone: "danger",
      };
    case "not_configured":
      return {
        label: "E-mail non envoyé",
        detail: "Envoi d'e-mails non configuré.",
        tone: "warn",
      };
    case "pending":
      return {
        label: "En attente d'envoi",
        detail: "L'e-mail n'est pas encore parti.",
        tone: "warn",
      };
  }
}

function CopyLinkWindow({ url, onClose }: { url: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title="Lien de connexion"
      description="Ce lien n'a été envoyé à personne : transmettez-le vous-même à ce contact."
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warn">
          Il connecte directement à l&apos;espace client, une seule fois, pendant 24 heures. Il ne
          sera plus affiché après la fermeture de cette fenêtre.
        </Alert>
        <Field id="portal-link" label="Lien">
          <Input id="portal-link" readOnly value={url} className="font-mono text-xs" />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="accent"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast({ message: "Lien copié.", tone: "success" });
              } catch {
                toast({
                  message: "Copie refusée : sélectionnez le lien ci-dessus.",
                  tone: "danger",
                });
              }
            }}
          >
            Copier le lien
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AccessRow({
  row,
  companyId,
  overview,
}: {
  row: PortalAccessRow;
  companyId: string;
  overview: Pick<PortalAccessOverview, "canManage" | "canCopyLink">;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const status = accessStatus(row);
  const { membership } = row;
  const live = membership && membership.status !== "revoked";
  const waiting = membership?.status === "invited" && membership.delivery?.status === "pending";

  function run(action: () => Promise<{ status: string; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message ?? "Une erreur est survenue.");
        return;
      }
      if (result.message) toast({ message: result.message, tone: "success" });
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-row-primary text-ink">{row.fullName}</p>
          <p className="truncate text-xs text-muted">{row.email ?? "Pas d'adresse e-mail"}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {status.detail ? <p className="text-xs text-muted">{status.detail}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {overview.canManage ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {!live && row.email ? (
            <CompactButton
              variant="secondary"
              icon="send"
              loading={pending}
              onClick={() =>
                run(() => invitePortalClientAction({ companyId, contactId: row.contactId }))
              }
            >
              {membership ? "Inviter à nouveau" : "Inviter dans son espace"}
            </CompactButton>
          ) : null}
          {live && !waiting ? (
            <CompactButton
              variant="quiet"
              disabled={pending}
              onClick={() =>
                run(() => resendPortalInvitationAction({ companyId, membershipId: membership.id }))
              }
            >
              Renvoyer un lien
            </CompactButton>
          ) : null}
          {live && overview.canCopyLink ? (
            <CompactButton
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await issuePortalLinkAction({ membershipId: membership.id });
                  if (result.status === "error") setError(result.message);
                  else if (result.status === "success" && result.url) setLink(result.url);
                });
              }}
            >
              Copier le lien
            </CompactButton>
          ) : null}
          {live ? (
            <CompactButton
              variant="quiet"
              disabled={pending}
              onClick={() => setConfirming(true)}
              className="text-danger"
            >
              Retirer l&apos;accès
            </CompactButton>
          ) : null}
        </div>
      ) : null}
      {link ? <CopyLinkWindow url={link} onClose={() => setLink(null)} /> : null}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Retirer l'accès de ${row.fullName} ?`}
        description="Ses sessions se ferment tout de suite, et plus aucun lien ne lui ouvrira l'espace client."
        confirmLabel="Retirer l'accès"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (membership) {
            run(() => revokePortalAccessAction({ companyId, membershipId: membership.id }));
          }
        }}
      />
    </li>
  );
}

/** Ligne « Espace client » de la fiche (04). L'état affiché vient de `email_outbox`, sans raccourci. */
export function PortalAccessList({
  companyId,
  overview,
}: {
  companyId: string;
  overview: PortalAccessOverview;
}) {
  if (overview.rows.length === 0) {
    return <p className="text-sm text-muted">Ajoutez un contact pour l&apos;inviter.</p>;
  }
  return (
    <ul className="flex flex-col">
      {overview.rows.map((row) => (
        <AccessRow key={row.contactId} row={row} companyId={companyId} overview={overview} />
      ))}
    </ul>
  );
}

/** Bouton de l'en-tête de la fiche : ouvre la même liste, pour choisir le contact. */
export function InviteToPortalButton({
  companyId,
  overview,
}: {
  companyId: string;
  overview: PortalAccessOverview;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Inviter dans son espace</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title="Espace client"
        description="Choisissez qui reçoit l'accès. L'invitation rejoint la file d'envoi, avec un lien valable 24 heures : son état réel s'affiche sur chaque ligne."
      >
        <PortalAccessList companyId={companyId} overview={overview} />
      </Modal>
    </>
  );
}
