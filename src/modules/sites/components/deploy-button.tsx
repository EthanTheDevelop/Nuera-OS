"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { ENVIRONMENT_KIND_LABELS, type EnvironmentKind } from "@/lib/domain-enums";
import { triggerDeploymentAction } from "../site.actions";

export interface DeployableEnvironment {
  id: string;
  kind: EnvironmentKind;
  url: string | null;
}

/** Ce que la confirmation enverrait sans mot à saisir ; le serveur l'exige de son côté. */
const SIMPLE_CONFIRMATION = "CONFIRMED";
const PRODUCTION_WORD = "PRODUCTION";

/**
 * « Déployer » (écran 19). Production : mot à saisir, jamais par défaut un simple clic.
 * Staging et développement : confirmation simple. La confirmation est revérifiée côté serveur.
 * Un environnement en cours de déploiement n'est plus proposé ; s'il n'en reste aucun, le bouton
 * passe à l'état « en cours » jusqu'à la fin (écran 19).
 */
export function DeployButton({
  siteId,
  siteLabel,
  environments,
  busyEnvironmentIds = [],
}: {
  siteId: string;
  siteLabel: string;
  environments: readonly DeployableEnvironment[];
  busyEnvironmentIds?: readonly string[];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const available = environments.filter(({ id }) => !busyEnvironmentIds.includes(id));
  const environment =
    available.find(({ id }) => id === chosenId) ??
    available.find(({ kind }) => kind === "production") ??
    available[0];
  const production = environment?.kind === "production";

  if (!environment) {
    return (
      <Button variant="accent" loading>
        Déploiement en cours
      </Button>
    );
  }
  const environmentId = environment.id;

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        Déployer
      </Button>
      <ConfirmDialog
        open={open}
        title={production ? "Déployer en production" : "Déployer ce site"}
        description={`${siteLabel} : le déploiement est demandé à Coolify, le résultat s'affiche dans le tableau.`}
        confirmLabel="Déployer"
        tone={production ? "danger" : "default"}
        requireWord={production ? PRODUCTION_WORD : undefined}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const result = await triggerDeploymentAction(
            siteId,
            environmentId,
            production ? PRODUCTION_WORD : SIMPLE_CONFIRMATION,
          );
          if (result.status === "success") {
            toast({ message: result.message });
            setOpen(false);
          } else if (result.status === "error") {
            toast({ message: result.message, tone: "danger" });
          }
        }}
      >
        <Field id="deploy-environment" label="Environnement">
          <Select
            id="deploy-environment"
            value={environmentId}
            onChange={(event) => setChosenId(event.target.value)}
          >
            {available.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {ENVIRONMENT_KIND_LABELS[candidate.kind]}
                {candidate.url ? ` · ${candidate.url.replace(/^https?:\/\//, "")}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </ConfirmDialog>
    </>
  );
}
