"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Icon } from "@/components/ui/icon";
import { DateField, FormAlert } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Menu } from "@/components/ui/popover";
import { useActionToast, useToast } from "@/components/ui/toast";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import {
  changeInvoiceStatusAction,
  archiveDirectCostAction,
  archiveScheduleItemAction,
  setInvoiceVisibilityAction,
} from "../finance.actions";
import { EXPORT_MENU, exportHref } from "../finance.constants";
import type {
  DirectCostRow,
  FinanceFormOptions,
  InvoiceRow,
  ScheduleRow,
} from "../finance.service";
import { canInvoiceTransition } from "../invoice.status";
import { CostFormModal } from "./cost-form";
import { ImportModal } from "./import-panel";
import { InvoiceFormModal, type InvoiceFormDefaults } from "./invoice-form";
import { ScheduleFormModal } from "./schedule-form";

/** Bouton « Exporter » : un téléchargement réel par la route authentifiée. */
export function ExportMenu() {
  return (
    <Menu
      label="Exporter"
      placement="bottom-end"
      width={280}
      trigger={(props) => <Button {...props}>Exporter</Button>}
      items={EXPORT_MENU.map(({ dataset, label }) => ({
        key: dataset,
        label,
        icon: "download" as const,
        onSelect: () => {
          window.location.assign(exportHref(dataset));
        },
      }))}
    />
  );
}

/** Saisie manuelle d'une référence et import CSV. */
export function InvoiceToolbar({ options }: { options: FinanceFormOptions }) {
  const [open, setOpen] = useState<"import" | "invoice" | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CompactButton variant="secondary" icon="download" onClick={() => setOpen("import")}>
        Importer un CSV
      </CompactButton>
      <CompactButton icon="plus" onClick={() => setOpen("invoice")}>
        Nouvelle référence
      </CompactButton>
      <ImportModal open={open === "import"} onClose={close} />
      <InvoiceFormModal open={open === "invoice"} onClose={close} options={options} />
    </div>
  );
}

function MarkPaidForm({
  invoice,
  today,
  onDone,
  onCancel,
}: {
  invoice: InvoiceRow;
  today: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action] = useActionState(
    changeInvoiceStatusAction.bind(null, invoice.id),
    IDLE_ACTION_STATE,
  );
  useActionToast(state);
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="to" value="paid" />
      <FormAlert state={state} />
      <ModalRow>
        <DateField
          state={state}
          name="paidOn"
          label="Payée le"
          defaultValue={today}
          max={today}
          required
          data-autofocus
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Annuler</Button>
        <SubmitButton icon="check">Marquer payée</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Actions d'une facture : chacune n'existe que si la machine d'états l'autorise. */
export function InvoiceActions({
  invoice,
  options,
  today,
}: {
  invoice: InvoiceRow;
  options: FinanceFormOptions;
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"edit" | "paid" | "cancel" | "reopen" | null>(null);
  const [pending, startTransition] = useTransition();
  const close = useCallback(() => {
    setOpen(null);
    router.refresh();
  }, [router]);

  const notify = (state: ActionState) => {
    if (state.status === "success") toast({ message: state.message });
    if (state.status === "error") toast({ message: state.message, tone: "danger" });
    router.refresh();
  };

  async function changeStatus(to: "cancelled" | "issued") {
    const data = new FormData();
    data.set("to", to);
    notify(await changeInvoiceStatusAction(invoice.id, IDLE_ACTION_STATE, data));
    setOpen(null);
  }

  const status = invoice.storedStatus;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canInvoiceTransition(status, "paid") ? (
        <CompactButton icon="check" onClick={() => setOpen("paid")}>
          Marquer payée
        </CompactButton>
      ) : null}
      {status !== "cancelled" ? (
        <CompactButton variant="secondary" icon="edit" onClick={() => setOpen("edit")}>
          Modifier
        </CompactButton>
      ) : null}
      {status === "paid" ? (
        <CompactButton variant="secondary" onClick={() => setOpen("reopen")}>
          Annuler l&apos;encaissement
        </CompactButton>
      ) : null}
      {status !== "cancelled" ? (
        <CompactButton
          variant="secondary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              notify(await setInvoiceVisibilityAction(invoice.id, !invoice.clientVisible));
            })
          }
        >
          {invoice.clientVisible ? "Masquer au client" : "Montrer au client"}
        </CompactButton>
      ) : null}
      {canInvoiceTransition(status, "cancelled") ? (
        <CompactButton variant="quiet" onClick={() => setOpen("cancel")}>
          Annuler la facture
        </CompactButton>
      ) : null}

      <InvoiceFormModal
        open={open === "edit"}
        onClose={close}
        options={options}
        invoice={invoice}
      />
      <Modal
        open={open === "paid"}
        onClose={() => setOpen(null)}
        icon="check"
        title={`Marquer ${invoice.externalRef ?? "cette facture"} payée`}
        description="À faire quand Indy indique le paiement. La date compte dans « Encaissé »."
        width={440}
      >
        <MarkPaidForm
          invoice={invoice}
          today={today}
          onDone={close}
          onCancel={() => setOpen(null)}
        />
      </Modal>
      <ConfirmDialog
        open={open === "cancel"}
        title="Annuler cette facture ?"
        description="Elle sort des revenus et du reste à encaisser. La ligne reste dans l'historique, et cet état est définitif."
        confirmLabel="Annuler la facture"
        cancelLabel="Garder"
        tone="danger"
        onConfirm={() => changeStatus("cancelled")}
        onCancel={() => setOpen(null)}
      />
      <ConfirmDialog
        open={open === "reopen"}
        title="Annuler cet encaissement ?"
        description="La facture redevient à encaisser, ou en retard si son échéance est passée."
        confirmLabel="Annuler l'encaissement"
        cancelLabel="Garder"
        onConfirm={() => changeStatus("issued")}
        onCancel={() => setOpen(null)}
      />
    </div>
  );
}

export function NewScheduleButton({ options }: { options: FinanceFormOptions }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
        Nouvelle échéance
      </Button>
      <ScheduleFormModal open={open} onClose={close} options={options} />
    </>
  );
}

/** Détail d'une échéance : ajouter une facture, modifier, retirer. */
export function ScheduleActions({
  item,
  options,
  canDelete,
}: {
  item: ScheduleRow;
  options: FinanceFormOptions;
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"invoice" | "edit" | "delete" | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    router.refresh();
  }, [router]);

  const defaults: InvoiceFormDefaults = {
    companyId: item.companyId,
    projectId: item.projectId,
    contractId: item.contractId,
    quoteId: item.quoteId,
    scheduleItemId: item.id,
    amountCents: Math.max(0, item.amountCents - item.invoicedCents) || undefined,
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canDelete ? <Button onClick={() => setOpen("delete")}>Retirer</Button> : null}
      <Button onClick={() => setOpen("edit")}>Modifier</Button>
      {item.invoicedCents < item.amountCents ? (
        <Button variant="accent" icon="plus" onClick={() => setOpen("invoice")}>
          Ajouter une facture
        </Button>
      ) : null}
      <InvoiceFormModal
        open={open === "invoice"}
        onClose={close}
        options={options}
        defaults={defaults}
      />
      <ScheduleFormModal open={open === "edit"} onClose={close} options={options} item={item} />
      <ConfirmDialog
        open={open === "delete"}
        title="Retirer cette échéance ?"
        description="Elle ne porte aucune facture. Le retrait reste tracé dans le journal."
        confirmLabel="Retirer"
        cancelLabel="Garder"
        tone="danger"
        onConfirm={async () => {
          const state = await archiveScheduleItemAction(item.id);
          if (state.status === "success") {
            toast({ message: state.message });
            router.push("/finances/echeancier");
          } else if (state.status === "error") {
            toast({ message: state.message, tone: "danger" });
            setOpen(null);
          }
        }}
        onCancel={() => setOpen(null)}
      />
    </div>
  );
}

export function NewCostButton({ options }: { options: FinanceFormOptions }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
        Nouveau coût
      </Button>
      <CostFormModal open={open} onClose={close} options={options} />
    </>
  );
}

/** Modifier ou retirer un coût depuis sa ligne. */
export function CostRowActions({
  cost,
  options,
}: {
  cost: DirectCostRow;
  options: FinanceFormOptions;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    router.refresh();
  }, [router]);
  return (
    <span className="relative z-10 inline-flex items-center gap-1">
      <button
        type="button"
        aria-label={`Modifier ${cost.label}`}
        onClick={() => setOpen("edit")}
        className="hit-44 rounded-sm p-1 text-muted hover:text-text"
      >
        <Icon name="edit" size={16} />
      </button>
      <button
        type="button"
        aria-label={`Retirer ${cost.label}`}
        onClick={() => setOpen("delete")}
        className="hit-44 rounded-sm p-1 text-muted hover:text-danger"
      >
        <Icon name="minus" size={16} />
      </button>
      <CostFormModal open={open === "edit"} onClose={close} options={options} cost={cost} />
      <ConfirmDialog
        open={open === "delete"}
        title={`Retirer « ${cost.label} » ?`}
        description="Il sort des marges. Le journal d'audit garde sa trace complète."
        confirmLabel="Retirer"
        cancelLabel="Garder"
        tone="danger"
        onConfirm={async () => {
          const state = await archiveDirectCostAction(cost.id);
          if (state.status === "success") toast({ message: state.message });
          if (state.status === "error") toast({ message: state.message, tone: "danger" });
          close();
        }}
        onCancel={() => setOpen(null)}
      />
    </span>
  );
}
