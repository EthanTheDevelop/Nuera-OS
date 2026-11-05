"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import {
  checkConnectionAction,
  markAllNotificationsReadAction,
  retryFailedRunsAction,
  retryRunAction,
  saveSuggestionSettingsAction,
  setRuleEnabledAction,
} from "../platform.actions";

function useActionRunner() {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<ActionState>, onDone?: (state: ActionState) => void) {
    startTransition(async () => {
      const state = await action();
      if (state.status !== "idle") {
        toast({ message: state.message, tone: state.status === "error" ? "danger" : "success" });
      }
      onDone?.(state);
      router.refresh();
    });
  }
  return { run, pending };
}

/** Interrupteur d'une règle : l'état affiché revient à la valeur précédente si le serveur refuse. */
export function RuleSwitch({
  ruleKey,
  name,
  enabled,
  canManage,
}: {
  ruleKey: string;
  name: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const { run, pending } = useActionRunner();
  const [on, setOn] = useState(enabled);
  return (
    <Switch
      hideLabel
      label={`Activer : ${name}`}
      checked={on}
      disabled={!canManage || pending}
      onCheckedChange={(next) => {
        setOn(next);
        run(
          () => setRuleEnabledAction(ruleKey, next),
          (state) => {
            if (state.status === "error") setOn(!next);
          },
        );
      }}
    />
  );
}

export function RetryRunButton({ runId }: { runId: string }) {
  const { run, pending } = useActionRunner();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      onClick={() => run(() => retryRunAction(runId))}
    >
      Relancer
    </CompactButton>
  );
}

export function RetryAllButton({ label = "Relancer sans doublon" }: { label?: string }) {
  const { run, pending } = useActionRunner();
  return (
    <Button loading={pending} onClick={() => run(retryFailedRunsAction)}>
      {label}
    </Button>
  );
}

export function CheckConnectionButton({ service, label }: { service: string; label: string }) {
  const { run, pending } = useActionRunner();
  return (
    <CompactButton
      variant="quiet"
      loading={pending}
      aria-label={`Vérifier la connexion : ${label}`}
      onClick={() => run(() => checkConnectionAction(service))}
    >
      Vérifier
    </CompactButton>
  );
}

export function CheckChatgptButton() {
  const { run, pending } = useActionRunner();
  return (
    <Button loading={pending} onClick={() => run(() => checkConnectionAction("openai"))}>
      Vérifier
    </Button>
  );
}

/** Les trois interrupteurs de la carte ChatGPT : le troisième reste éteint, par conception (A10). */
export function SuggestionSwitches({
  enabled,
  readProjectContext,
  canManage,
}: {
  enabled: boolean;
  readProjectContext: boolean;
  canManage: boolean;
}) {
  const { run, pending } = useActionRunner();
  const [settings, setSettings] = useState({ enabled, readProjectContext });

  function save(next: typeof settings) {
    const previous = settings;
    setSettings(next);
    run(
      () => saveSuggestionSettingsAction(next),
      (state) => {
        if (state.status === "error") setSettings(previous);
      },
    );
  }

  return (
    <div className="grid gap-x-10 gap-y-4 md:grid-cols-3">
      <Switch
        tone="chatgpt"
        label="Suggérer une réponse"
        description="sur chaque nouveau message client"
        checked={settings.enabled}
        disabled={!canManage || pending}
        onCheckedChange={(value) => save({ ...settings, enabled: value })}
      />
      <Switch
        tone="chatgpt"
        label="Lire le contexte du projet"
        description="planning, contenus, devis"
        checked={settings.readProjectContext}
        disabled={!canManage || pending}
        onCheckedChange={(value) => save({ ...settings, readProjectContext: value })}
      />
      <Switch
        tone="chatgpt"
        label="Envoyer sans relecture"
        description="jamais : une personne valide toujours"
        checked={false}
        disabled
      />
    </div>
  );
}

export function MarkAllReadButton() {
  const { run, pending } = useActionRunner();
  return (
    <Button loading={pending} onClick={() => run(markAllNotificationsReadAction)}>
      Tout marquer comme lu
    </Button>
  );
}
