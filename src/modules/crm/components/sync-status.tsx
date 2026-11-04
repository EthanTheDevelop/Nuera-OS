import { ConnectionRequired, StaleData } from "@/components/states/states";
import { Alert } from "@/components/ui/feedback";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { CrmSyncStatus } from "../crm.sync.service";
import { SyncButton } from "./sync-button";

/**
 * État du lien avec Twenty, au-dessus d'une liste : rien tant que tout va bien. Les lectures restent
 * disponibles dans tous les cas : la page lit sa projection.
 */
export function CrmSyncBanner({ status }: { status: CrmSyncStatus }) {
  if (!status.configured) {
    return (
      <ConnectionRequired
        compact
        service="Twenty"
        missing="Les fiches restent consultables, mais rien ne peut être créé ni modifié dans le CRM tant que l'URL et la clé d'API ne sont pas définies."
        className="rounded-lg bg-surface shadow-soft"
      />
    );
  }
  if (!status.stale && !status.lastError) return null;
  if (!status.lastSuccessAt) {
    return (
      <Alert tone="warn">
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span>
            {status.lastError
              ? `La synchronisation avec Twenty a échoué : ${status.lastError}`
              : "Aucune synchronisation avec Twenty pour l'instant : les fiches affichées sont celles déjà connues de Nuera OS."}
          </span>
          {status.canSync ? <SyncButton /> : null}
        </span>
      </Alert>
    );
  }
  return (
    <StaleData
      service="Twenty"
      date={formatDateTime(status.lastSuccessAt)}
      staleness={formatRelativeTime(status.lastSuccessAt)}
      action={status.canSync ? <SyncButton /> : undefined}
    />
  );
}

/** Date de la dernière lecture, sous une liste. */
export function CrmSyncFootnote({ status }: { status: CrmSyncStatus }) {
  if (!status.configured || !status.lastSuccessAt) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
      <span>Fiches lues dans Twenty {formatRelativeTime(status.lastSuccessAt)}</span>
      {status.canSync ? <SyncButton /> : null}
    </div>
  );
}
