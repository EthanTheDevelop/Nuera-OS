"use client";

import { useState } from "react";
import { CompactButton } from "@/components/ui/compact-button";
import { Input } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Tile } from "@/components/ui/tile";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { addHandoverItemAction, toggleHandoverItemAction } from "../project.actions";
import type { ProjectDetail } from "../project.service";
import { useCommand } from "./use-project-command";

/** Recette et passation (Figma 100:5067) : coche verte quand c'est fait, horloge sinon. */
export function HandoverCard({
  projectId,
  items,
  editable,
}: {
  projectId: string;
  items: ProjectDetail["handover"];
  editable: boolean;
}) {
  const { run, pending } = useCommand();
  const [label, setLabel] = useState("");
  const done = items.filter((item) => item.doneAt).length;

  function add() {
    const value = label.trim();
    if (!value) return;
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("label", value);
    run(
      () => addHandoverItemAction(IDLE_ACTION_STATE, formData),
      () => setLabel(""),
    );
  }

  return (
    <Tile
      icon="check"
      title="Recette et passation"
      className="gap-3 rounded-lg p-6"
      aside={
        items.length > 0 ? (
          <span className="text-xs text-muted">
            {done} / {items.length}
          </span>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">Aucun point de passation pour l’instant.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => {
            const checked = item.doneAt !== null;
            const mark = (
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full",
                  checked ? "bg-success-pale text-success" : "text-muted",
                )}
              >
                <Icon name={checked ? "check" : "clock"} size={14} />
              </span>
            );
            return (
              <li key={item.id} className="min-h-8 text-sm text-text">
                {editable ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={pending}
                    onClick={() => run(() => toggleHandoverItemAction(item.id, !checked))}
                    className="flex min-h-8 w-full items-center gap-3 rounded-sm py-1 text-left hover:bg-surface-raised/60 focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {mark}
                    {item.label}
                  </button>
                ) : (
                  <span className="flex min-h-8 items-center gap-3 py-1">
                    {mark}
                    {item.label}
                    <span className="sr-only">{checked ? " : fait" : " : à faire"}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable ? (
        <form
          className="flex items-center gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            aria-label="Nouveau point de passation"
            placeholder="Ajouter un point…"
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            className="h-9 text-sm"
          />
          <CompactButton
            type="submit"
            variant="secondary"
            icon="plus"
            loading={pending}
            disabled={!label.trim()}
          >
            Ajouter
          </CompactButton>
        </form>
      ) : null}
    </Tile>
  );
}
