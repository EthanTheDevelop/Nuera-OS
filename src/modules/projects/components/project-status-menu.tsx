"use client";

import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { Menu } from "@/components/ui/popover";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/domain-enums";
import {
  archiveProjectAction,
  changeProjectStatusAction,
  goLiveProjectAction,
  restoreProjectAction,
} from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { TRANSITION_LABELS } from "./project-view";
import { useCommand } from "./use-project-command";

type Dialog = "go_live" | "close" | "archive" | null;

/** Cycle de vie du projet : les transitions autorisées, proposées par le service. */
export function ProjectStatusMenu({ project }: { project: ProjectDetail }) {
  const { run, announce, pending } = useCommand();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [siteId, setSiteId] = useState(project.sites[0]?.id ?? "");
  const close = () => setDialog(null);

  function select(status: ProjectStatus) {
    if (status === "delivered") setDialog("go_live");
    else if (status === "closed") setDialog("close");
    else run(() => changeProjectStatusAction(project.id, status));
  }

  if (project.archived) {
    return project.capabilities.archive ? (
      <CompactButton
        variant="secondary"
        loading={pending}
        onClick={() => run(() => restoreProjectAction(project.id))}
      >
        Restaurer le projet
      </CompactButton>
    ) : null;
  }

  const transitions = project.capabilities.edit
    ? project.nextStatuses.map((status) => ({
        key: status,
        label: TRANSITION_LABELS[status],
        icon: status === "delivered" ? ("rocket" as const) : undefined,
        onSelect: () => select(status),
      }))
    : [];
  const archive = project.capabilities.archive
    ? [
        {
          key: "archive",
          label: "Archiver le projet",
          icon: "minus" as const,
          danger: true,
          separatorBefore: transitions.length > 0,
          onSelect: () => setDialog("archive"),
        },
      ]
    : [];
  const items = [...transitions, ...archive];
  if (items.length === 0) return null;

  const site = project.sites.find((candidate) => candidate.id === siteId);

  return (
    <>
      <Menu
        label="Changer le statut du projet"
        placement="bottom-start"
        items={items}
        trigger={(props) => (
          <CompactButton variant="quiet" loading={pending} {...props}>
            Changer le statut
          </CompactButton>
        )}
      />
      <ConfirmDialog
        open={dialog === "go_live"}
        title="Mettre en ligne"
        description={
          site
            ? `Le projet passe à « ${PROJECT_STATUS_LABELS.delivered} » et le site ${site.name} est activé. Si le site ne peut pas l’être, rien ne change.`
            : `Le projet passe à « ${PROJECT_STATUS_LABELS.delivered} ». Aucun site n’y est rattaché.`
        }
        confirmLabel="Mettre en ligne"
        onCancel={close}
        onConfirm={async () => {
          if (announce(await goLiveProjectAction(project.id, siteId || null))) close();
        }}
      >
        {project.sites.length > 1 ? (
          <Field id="go-live-site" label="Site à mettre en ligne">
            <Select
              id="go-live-site"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              {project.sites.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "close"}
        title="Clôturer le projet"
        description="Un projet clôturé ne se modifie plus. La passation doit être terminée."
        confirmLabel="Clôturer"
        onCancel={close}
        onConfirm={async () => {
          if (announce(await changeProjectStatusAction(project.id, "closed"))) close();
        }}
      />
      <ConfirmDialog
        open={dialog === "archive"}
        title="Archiver le projet"
        description="Le projet disparaît des listes. Il reste consultable et peut être restauré."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={close}
        onConfirm={async () => {
          if (announce(await archiveProjectAction(project.id))) close();
        }}
      />
    </>
  );
}
