"use server";

import { notFound } from "next/navigation";
import type { CommandGroup } from "@/components/layout/command-palette";
import type { KanbanMove } from "@/components/ui/kanban";
import type { ActionState } from "@/lib/action-state";
import { SEARCH_RESULTS } from "./fixtures";

function assertDevelopment(): void {
  if (process.env.NODE_ENV !== "development") notFound();
}

export async function demoSearch(query: string): Promise<readonly CommandGroup[]> {
  assertDevelopment();
  const text = query.toLocaleLowerCase("fr-FR");
  return SEARCH_RESULTS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.label.toLocaleLowerCase("fr-FR").includes(text)),
  })).filter((group) => group.items.length > 0);
}

/** Refuse le dépôt en colonne « Gagné » : montre le retour en arrière et le message. */
export async function demoMove(move: KanbanMove): Promise<ActionState> {
  assertDevelopment();
  if (move.toColumnId === "won") {
    return { status: "error", message: "Une affaire gagnée exige un montant et un client." };
  }
  return { status: "success", message: "Carte déplacée." };
}

export async function demoSave(_previous: ActionState, formData: FormData): Promise<ActionState> {
  assertDevelopment();
  const values = Object.fromEntries(
    [...formData.entries()]
      .filter(([key]) => !key.startsWith("$"))
      .map(([key, value]) => [key, String(value)]),
  );
  if (!values.name) {
    return {
      status: "error",
      message: "Le formulaire contient des erreurs.",
      fieldErrors: { name: ["Le nom est requis."] },
      values,
    };
  }
  return {
    status: "success",
    message: `Reçu : montant ${values.amount ?? "?"} centimes, durée ${values.duration ?? "?"} minutes.`,
  };
}
