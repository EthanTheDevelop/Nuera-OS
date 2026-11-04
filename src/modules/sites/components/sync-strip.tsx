"use client";

import Link from "next/link";
import { useTransition } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { syncNowAction } from "../site.actions";
import { isStale, STATUS_STALE_AFTER_MS } from "../site.health";
import type { ServiceState } from "../sync.service";

/**
 * Une ligne par service externe : ce qui est relu, depuis quand, et le moyen de relire.
 * Non configuré : le dit, sans bouton. La donnée affichée au-dessus reste datée.
 */
export function SyncStrip({
  coolify,
  uptimeKuma,
  canSync,
  canOpenConnections,
  now,
}: {
  coolify: ServiceState;
  uptimeKuma: ServiceState;
  canSync: boolean;
  canOpenConnections: boolean;
  now: Date;
}) {
  return (
    <div className="anim-content flex flex-col gap-2 rounded-lg bg-surface p-4 shadow-soft sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
      <SyncLine
        label="Coolify"
        service="coolify"
        state={coolify}
        canSync={canSync}
        canOpenConnections={canOpenConnections}
        now={now}
      />
      <SyncLine
        label="Uptime Kuma"
        service="uptime_kuma"
        state={uptimeKuma}
        canSync={canSync}
        canOpenConnections={canOpenConnections}
        now={now}
      />
    </div>
  );
}

export function SyncLine({
  label,
  service,
  state,
  canSync,
  canOpenConnections,
  now,
}: {
  label: string;
  service: "coolify" | "uptime_kuma";
  state: ServiceState;
  canSync: boolean;
  /** Sans `integrations:read`, l'écran des connexions est refusé : le lien n'est pas proposé. */
  canOpenConnections: boolean;
  now: Date;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  if (!state.configured) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Icon name="link" size={14} className="text-warn" />
        <span>{label} : connexion requise</span>
        {canOpenConnections ? (
          <Link
            href="/reglages/connexions"
            className="hit-44 font-medium text-accent underline-offset-4 hover:underline"
          >
            Ouvrir les connexions
          </Link>
        ) : null}
      </p>
    );
  }

  const stale = isStale(state.lastSuccessAt, now, STATUS_STALE_AFTER_MS);
  const status = !state.lastRunAt
    ? "jamais synchronisé"
    : state.lastRunFailed
      ? `échec ${formatRelativeTime(state.lastRunAt, now)}`
      : `relu ${formatRelativeTime(state.lastRunAt, now)}`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <Icon
        name="clock"
        size={14}
        className={state.lastRunFailed ? "text-danger" : stale ? "text-warn" : "text-success"}
      />
      <span
        title={
          state.lastRunAt
            ? `${formatDateTime(state.lastRunAt)}${state.lastError ? ` · ${state.lastError}` : ""}`
            : undefined
        }
      >
        {label} : {status}
      </span>
      {canSync ? (
        <CompactButton
          variant="quiet"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await syncNowAction(service);
              if (result.status === "idle") return;
              toast({
                message: result.message,
                tone: result.status === "success" ? "success" : "danger",
              });
            })
          }
        >
          Synchroniser
        </CompactButton>
      ) : null}
    </div>
  );
}
