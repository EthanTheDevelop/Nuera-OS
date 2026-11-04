"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useActionToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { setCatalogItemActiveAction } from "../catalog.actions";
import { CatalogItemForm } from "./catalog-item-form";

/** « + Nouvelle prestation » : le formulaire s'ouvre en fenêtre. */
export function NewCatalogItemButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        + Nouvelle prestation
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle prestation" width={640}>
        <ModalRow>
          <CatalogItemForm footer={<Button onClick={() => setOpen(false)}>Annuler</Button>} />
        </ModalRow>
      </Modal>
    </>
  );
}

/** Retirer de la vente ou y remettre : jamais de suppression, d'anciens devis la référencent. */
export function CatalogActiveToggle({ itemId, active }: { itemId: string; active: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(setCatalogItemActiveAction, IDLE_ACTION_STATE);
  useActionToast(state);

  function submit() {
    const data = new FormData();
    data.set("itemId", itemId);
    data.set("active", String(!active));
    startTransition(() => action(data));
    setConfirming(false);
  }

  return (
    <>
      <Button loading={pending} onClick={active ? () => setConfirming(true) : submit}>
        {active ? "Retirer de la vente" : "Remettre en vente"}
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Retirer cette prestation de la vente ?"
        description="Elle ne sera plus proposée dans les nouveaux devis. Les devis existants ne changent pas."
        confirmLabel="Retirer de la vente"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      />
    </>
  );
}
