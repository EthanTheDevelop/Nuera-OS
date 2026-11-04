"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/lib/action-state";
import {
  archiveCompanyAction,
  archiveContactAction,
  mergeCompaniesAction,
  mergeContactsAction,
  restoreCompanyAction,
  restoreContactAction,
} from "../crm.actions";
import { CompanyPicker } from "./company-picker";

function useResultToast() {
  const toast = useToast();
  return (result: ActionState) => {
    if (result.status === "success") toast({ message: result.message });
    if (result.status === "error") toast({ message: result.message, tone: "danger" });
    return result.status === "success";
  };
}

/** Bouton qui ouvre une confirmation, puis lance une action serveur. */
function ConfirmedAction({
  label,
  title,
  description,
  confirmLabel,
  tone,
  action,
  icon,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  action: () => Promise<ActionState>;
  icon?: "minus" | "check";
}) {
  const [open, setOpen] = useState(false);
  const notify = useResultToast();
  return (
    <>
      <CompactButton variant="quiet" icon={icon} onClick={() => setOpen(true)}>
        {label}
      </CompactButton>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        tone={tone}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          notify(await action());
          setOpen(false);
        }}
      />
    </>
  );
}

export function ArchiveCompanyButton({ companyId, name }: { companyId: string; name: string }) {
  return (
    <ConfirmedAction
      label="Archiver"
      icon="minus"
      title={`Archiver ${name} ?`}
      description="La fiche sort des listes. Contacts, affaires et historique restent en place, et la restauration reste possible."
      confirmLabel="Archiver"
      action={() => archiveCompanyAction(companyId)}
    />
  );
}

export function RestoreCompanyButton({ companyId, name }: { companyId: string; name: string }) {
  return (
    <ConfirmedAction
      label="Restaurer"
      icon="check"
      title={`Restaurer ${name} ?`}
      description="La fiche revient dans les listes et dans Twenty."
      confirmLabel="Restaurer"
      action={() => restoreCompanyAction(companyId)}
    />
  );
}

export function ArchiveContactButton({ contactId, name }: { contactId: string; name: string }) {
  return (
    <ConfirmedAction
      label="Archiver"
      icon="minus"
      title={`Archiver ${name} ?`}
      description="Le contact sort de l'annuaire, son historique reste en place."
      confirmLabel="Archiver"
      action={() => archiveContactAction(contactId)}
    />
  );
}

export function RestoreContactButton({ contactId, name }: { contactId: string; name: string }) {
  return (
    <ConfirmedAction
      label="Restaurer"
      icon="check"
      title={`Restaurer ${name} ?`}
      description="Le contact revient dans l'annuaire et dans Twenty."
      confirmLabel="Restaurer"
      action={() => restoreContactAction(contactId)}
    />
  );
}

const MERGE_WORD = "FUSIONNER";

/** Fusion irréversible pour la fiche perdante : confirmation par un mot, audit côté service. */
function MergeConfirm({
  open,
  winnerName,
  loserName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  winnerName: string;
  loserName: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Fusionner ces fiches ?"
      description="Action irréversible : dans Twenty, la fiche absorbée est supprimée définitivement."
      confirmLabel="Fusionner"
      tone="danger"
      requireWord={MERGE_WORD}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <Alert tone="warn">
        <strong className="font-semibold">{loserName}</strong> sera absorbée par{" "}
        <strong className="font-semibold">{winnerName}</strong>, qui garde ses valeurs et récupère
        tous les liens : contacts, affaires, projets, sites, contrats, documents, historique.
      </Alert>
    </ConfirmDialog>
  );
}

/** Depuis une fiche : choisir l'autre fiche à absorber. */
export function MergeCompanyButton({ company }: { company: { id: string; name: string } }) {
  const router = useRouter();
  const notify = useResultToast();
  const [picking, setPicking] = useState(false);
  const [loser, setLoser] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <CompactButton variant="quiet" icon="link" onClick={() => setPicking(true)}>
        Fusionner
      </CompactButton>
      <ConfirmDialog
        open={picking}
        title={`Absorber une fiche dans ${company.name}`}
        description="Choisissez la fiche en double. Elle disparaîtra au profit de celle-ci."
        confirmLabel="Continuer"
        onCancel={() => {
          setPicking(false);
          setLoser(null);
        }}
        onConfirm={() => {
          if (!loser) return;
          setPicking(false);
        }}
      >
        <CompanyPicker
          name="mergeLoser"
          label="Fiche à absorber"
          excludeId={company.id}
          onChange={setLoser}
        />
      </ConfirmDialog>
      <MergeConfirm
        open={!picking && loser !== null}
        winnerName={company.name}
        loserName={loser?.name ?? ""}
        onCancel={() => setLoser(null)}
        onConfirm={async () => {
          if (!loser) return;
          const done = notify(
            await mergeCompaniesAction({ winnerId: company.id, loserId: loser.id }),
          );
          setLoser(null);
          if (done) router.refresh();
        }}
      />
    </>
  );
}

/** Depuis la page des doublons : la fiche conservée est choisie dans le groupe. */
export function MergeGroupButton({
  entity,
  members,
}: {
  entity: "company" | "contact";
  members: readonly { id: string; name: string }[];
}) {
  const notify = useResultToast();
  const [winnerId, setWinnerId] = useState(members[0]?.id ?? "");
  const [loser, setLoser] = useState<{ id: string; name: string } | null>(null);
  const winner = members.find((member) => member.id === winnerId);

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Fiche à conserver</legend>
        {members.map((member) => (
          <label key={member.id} className="flex min-h-11 items-center gap-3 text-sm text-text">
            <input
              type="radio"
              name={`winner-${members.map((entry) => entry.id).join("-")}`}
              checked={member.id === winnerId}
              onChange={() => setWinnerId(member.id)}
              className="size-4 accent-(--accent)"
            />
            <span className="min-w-0 flex-1 truncate">{member.name}</span>
            {member.id === winnerId ? (
              <span className="text-xs text-muted">conservée</span>
            ) : (
              <Button
                onClick={(event) => {
                  event.preventDefault();
                  setLoser(member);
                }}
              >
                Absorber
              </Button>
            )}
          </label>
        ))}
      </fieldset>
      <MergeConfirm
        open={loser !== null}
        winnerName={winner?.name ?? ""}
        loserName={loser?.name ?? ""}
        onCancel={() => setLoser(null)}
        onConfirm={async () => {
          if (!loser) return;
          const input = { winnerId, loserId: loser.id };
          notify(
            await (entity === "company" ? mergeCompaniesAction(input) : mergeContactsAction(input)),
          );
          setLoser(null);
        }}
      />
    </div>
  );
}
