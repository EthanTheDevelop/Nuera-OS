"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CompactButton, CompactLink } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { restoreContactAction, restoreDuplicateCompanyAction } from "../crm.actions";
import type { DuplicateInfo } from "../crm.shared";

/**
 * Fiche existante signalée par une création : on propose de la restaurer ou de la fusionner.
 * Jamais de recréation : dans Twenty, une fiche archivée garde son domaine ou son e-mail.
 */
export function DuplicateAlert({
  duplicate,
  onResolved,
  canMerge,
}: {
  duplicate: DuplicateInfo;
  /** La fiche a été restaurée, ou l'utilisateur part sur la fiche existante. */
  onResolved: () => void;
  canMerge: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const isCompany = duplicate.entity === "company";
  const label = duplicate.name ? `« ${duplicate.name} »` : "une fiche connue de Twenty";
  const href = isCompany
    ? duplicate.id
      ? `/clients/${duplicate.id}`
      : null
    : duplicate.id
      ? `/clients/contacts/${duplicate.id}`
      : null;

  function restore() {
    startTransition(async () => {
      const result = isCompany
        ? duplicate.twentyId
          ? await restoreDuplicateCompanyAction(duplicate.twentyId)
          : null
        : duplicate.id
          ? await restoreContactAction(duplicate.id)
          : null;
      if (!result) return;
      if (result.status === "error") {
        toast({ message: result.message, tone: "danger" });
        return;
      }
      if (result.status === "success") toast({ message: result.message });
      onResolved();
      const target = isCompany && "id" in result && result.id ? `/clients/${result.id}` : href;
      if (target) router.push(target);
      else router.refresh();
    });
  }

  const canRestore = duplicate.archived && (isCompany ? duplicate.twentyId : duplicate.id);

  return (
    <Alert tone="warn">
      <p>
        Cette fiche existe déjà : {label}
        {duplicate.archived ? ", archivée" : ""}.{" "}
        {duplicate.archived
          ? "Restaurez-la plutôt que d'en créer une autre."
          : "Ouvrez-la plutôt que d'en créer une autre, ou fusionnez les fiches."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {canRestore ? (
          <CompactButton variant="secondary" loading={pending} onClick={restore}>
            Restaurer la fiche
          </CompactButton>
        ) : null}
        {href && !duplicate.archived ? (
          <CompactLink variant="secondary" href={href} onClick={onResolved}>
            Ouvrir la fiche
          </CompactLink>
        ) : null}
        {canMerge && !duplicate.archived ? (
          <CompactLink variant="quiet" href="/clients/doublons" onClick={onResolved}>
            Voir les doublons
          </CompactLink>
        ) : null}
      </div>
    </Alert>
  );
}
