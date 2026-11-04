"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Field, Input } from "./form";
import { Modal, ModalRow } from "./modal";

/**
 * Confirmation d'une action sensible (non dessinée dans Figma, même langage que la fenêtre).
 *
 * - `requireWord` : le bouton reste inactif tant que le mot n'est pas saisi à l'identique. Exigé
 *   pour un déploiement en production (cadrage §4.07).
 * - `onConfirm` peut être asynchrone : le bouton passe en chargement, la fenêtre reste ouverte et
 *   non fermable jusqu'à la fin. La fermer ensuite est à la charge de l'appelant.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  tone = "default",
  requireWord,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` : action destructrice, le mot à saisir et le bouton le disent. */
  tone?: "default" | "danger";
  requireWord?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const armed = !requireWord || typed.trim() === requireWord;

  function close() {
    if (pending) return;
    setTyped("");
    onCancel();
  }

  function confirm() {
    if (!armed || pending) return;
    startTransition(async () => {
      await onConfirm();
      setTyped("");
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      width={480}
      dismissible={!pending}
      closeLabel={cancelLabel}
    >
      {children ? <ModalRow>{children}</ModalRow> : null}
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        {requireWord ? (
          <ModalRow>
            <Field
              id={inputId}
              label={
                <>
                  Pour confirmer, saisissez{" "}
                  <strong
                    className={cn("font-mono font-medium", tone === "danger" && "text-danger")}
                  >
                    {requireWord}
                  </strong>
                </>
              }
            >
              <Input
                id={inputId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                data-autofocus
              />
            </Field>
          </ModalRow>
        ) : null}
        <ModalRow className="flex flex-wrap justify-end gap-3">
          <Button onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="accent" disabled={!armed} loading={pending}>
            {confirmLabel}
          </Button>
        </ModalRow>
      </form>
    </Modal>
  );
}
