"use client";

import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { canTransition } from "@/server/status-machine";
import type { SiteStatus } from "@/lib/domain-enums";
import { changeSiteStatusAction } from "../site.actions";
import { SITE_TRANSITIONS } from "../site.status";

const ACTIONS: { to: SiteStatus; label: string; confirm?: string; restore?: boolean }[] = [
  {
    to: "live",
    label: "Mettre en ligne",
    confirm:
      "Le site passe « En ligne » et la mise en ligne est datée d'aujourd'hui si elle ne l'est pas déjà.",
  },
  { to: "staging", label: "Passer en préprod" },
  {
    to: "paused",
    label: "Mettre en pause",
    confirm: "Le site reste enregistré mais n'est plus compté comme en ligne.",
  },
  {
    to: "archived",
    label: "Archiver",
    confirm:
      "Le site sort du registre. Il reste consultable dans les archives et peut être restauré.",
  },
];

/** Actions de statut : seules les transitions autorisées par la machine sont proposées. */
export function SiteLifecycle({
  siteId,
  status,
  canUpdate,
  canArchive,
}: {
  siteId: string;
  status: SiteStatus;
  canUpdate: boolean;
  canArchive: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<{ to: SiteStatus; title: string; text?: string } | null>(
    null,
  );

  async function apply(to: SiteStatus) {
    const result = await changeSiteStatusAction(siteId, to);
    if (result.status !== "idle") {
      toast({
        message: result.message,
        tone: result.status === "success" ? "success" : "danger",
      });
    }
    setPending(null);
  }

  const available = (
    status === "archived"
      ? [{ to: "paused" as const, label: "Restaurer", confirm: undefined }]
      : ACTIONS
  ).filter(
    ({ to }) =>
      canTransition(SITE_TRANSITIONS, status, to) && (to === "archived" ? canArchive : canUpdate),
  );
  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {available.map(({ to, label, confirm }) => (
        <CompactButton
          key={to}
          variant="quiet"
          className={to === "archived" ? "text-danger" : undefined}
          onClick={() => setPending({ to, title: label, text: confirm })}
        >
          {label}
        </CompactButton>
      ))}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        description={pending?.text}
        confirmLabel={pending?.title ?? "Confirmer"}
        tone={pending?.to === "archived" ? "danger" : "default"}
        onCancel={() => setPending(null)}
        onConfirm={() => (pending ? apply(pending.to) : undefined)}
      />
    </div>
  );
}
