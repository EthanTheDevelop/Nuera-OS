"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { DateField, FormAlert, SelectField, TextareaField, TextField } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/form-client";
import type { IconName } from "@/components/ui/icon";
import { Modal, ModalRow } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, type ActivityKind } from "@/lib/domain-enums";
import type { MemberOption } from "@/modules/team/team.lookup";
import { IDLE_CRM_STATE, type CrmActionState } from "../crm.action-state";
import { completeActivityAction, createActivityAction, updateActivityAction } from "../crm.actions";

/** Objets auxquels une activité peut se rattacher, proposés selon l'écran. */
export interface ActivityLinks {
  companyId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  contacts?: readonly { id: string; fullName: string }[];
  opportunities?: readonly { id: string; name: string }[];
}

export interface ActivityFormValues {
  id: string;
  kind: ActivityKind;
  subject: string;
  body: string | null;
  dueOn: string | null;
  ownerMemberId: string | null;
}

/** Le jour de Paris, pas celui d'UTC : juste après minuit, une saisie tomberait la veille. */
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());

function ActivityForm({
  links,
  activity,
  defaultKind,
  kinds,
  members,
  onClose,
}: {
  links: ActivityLinks;
  activity?: ActivityFormValues;
  defaultKind: ActivityKind;
  kinds: readonly ActivityKind[];
  members: readonly MemberOption[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [requestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<ActivityKind>(activity?.kind ?? defaultKind);

  const [state, action] = useActionState(
    async (previous: CrmActionState, formData: FormData): Promise<CrmActionState> => {
      const result = activity
        ? await updateActivityAction(activity.id, previous, formData)
        : await createActivityAction(previous, formData);
      if (result.status === "success") {
        toast({ message: result.message });
        onClose();
      }
      return result;
    },
    IDLE_CRM_STATE,
  );

  const local = kind === "call" || kind === "meeting" || kind === "email";

  return (
    <form action={action} className="contents" noValidate>
      {activity ? null : (
        <>
          <input type="hidden" name="id" value={requestId} />
          {links.companyId ? (
            <input type="hidden" name="companyId" value={links.companyId} />
          ) : null}
          {links.opportunityId ? (
            <input type="hidden" name="opportunityId" value={links.opportunityId} />
          ) : null}
          {links.contactId ? (
            <input type="hidden" name="contactId" value={links.contactId} />
          ) : null}
        </>
      )}
      <ModalRow>
        <FormAlert state={state} />
      </ModalRow>
      <ModalRow className="grid gap-4 sm:grid-cols-2">
        {activity ? null : (
          <SelectField
            state={state}
            name="kind"
            label="Type"
            value={kind}
            onChange={(event) => setKind(event.target.value as ActivityKind)}
            hint={
              local
                ? "Conservé dans Nuera OS, disponible même si Twenty est coupé."
                : "Enregistré dans Twenty."
            }
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {ACTIVITY_KIND_LABELS[option]}
              </option>
            ))}
          </SelectField>
        )}
        {kind === "task" ? (
          <DateField
            state={state}
            name="dueOn"
            label="À faire pour le"
            defaultValue={activity?.dueOn ?? ""}
          />
        ) : activity ? null : (
          <DateField state={state} name="occurredOn" label="Date" defaultValue={today()} />
        )}
        <TextField
          state={state}
          name="subject"
          label={kind === "task" ? "Action" : "Objet"}
          required
          defaultValue={activity?.subject}
          fieldClassName="sm:col-span-2"
          data-autofocus
        />
      </ModalRow>
      {activity ? null : (
        <>
          {links.contacts && links.contacts.length > 0 && !links.contactId ? (
            <ModalRow>
              <SelectField state={state} name="contactId" label="Avec" defaultValue="">
                <option value="">Aucun contact précis</option>
                {links.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.fullName}
                  </option>
                ))}
              </SelectField>
            </ModalRow>
          ) : null}
          {links.opportunities && links.opportunities.length > 0 && !links.opportunityId ? (
            <ModalRow>
              <SelectField state={state} name="opportunityId" label="Affaire" defaultValue="">
                <option value="">Aucune affaire précise</option>
                {links.opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.name}
                  </option>
                ))}
              </SelectField>
            </ModalRow>
          ) : null}
        </>
      )}
      <ModalRow>
        <SelectField
          state={state}
          name="ownerMemberId"
          label="Responsable"
          defaultValue={activity?.ownerMemberId ?? ""}
        >
          <option value="">Non attribué</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </SelectField>
      </ModalRow>
      <ModalRow>
        <TextareaField
          state={state}
          name="body"
          label="Détail"
          rows={4}
          defaultValue={activity?.body ?? ""}
        />
      </ModalRow>
      <ModalRow className="flex flex-wrap justify-end gap-3">
        <Button onClick={onClose}>Annuler</Button>
        <SubmitButton>{activity ? "Enregistrer" : "Ajouter"}</SubmitButton>
      </ModalRow>
    </form>
  );
}

/** Consigne un appel, une réunion, un e-mail, une note ou une tâche. */
export function ActivityAddButton({
  links,
  members,
  defaultKind = "call",
  kinds = ACTIVITY_KINDS,
  label,
  icon = "plus",
  title = "Consigner un échange",
}: {
  links: ActivityLinks;
  members: readonly MemberOption[];
  defaultKind?: ActivityKind;
  kinds?: readonly ActivityKind[];
  label: string;
  icon?: IconName;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" icon={icon} onClick={() => setOpen(true)}>
        {label}
      </CompactButton>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width={560}>
        <ActivityForm
          links={links}
          defaultKind={defaultKind}
          kinds={kinds}
          members={members}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function ActivityEditButton({
  activity,
  members,
}: {
  activity: ActivityFormValues;
  members: readonly MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <CompactButton variant="quiet" onClick={() => setOpen(true)}>
        Modifier
      </CompactButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${ACTIVITY_KIND_LABELS[activity.kind]} · modifier`}
        width={560}
      >
        <ActivityForm
          links={{}}
          activity={activity}
          defaultKind={activity.kind}
          kinds={[activity.kind]}
          members={members}
          onClose={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function CompleteTaskButton({ activityId }: { activityId: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <CompactButton
      variant="quiet"
      icon="check"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await completeActivityAction(activityId);
          if (result.status === "success") toast({ message: result.message });
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
        })
      }
    >
      Terminer
    </CompactButton>
  );
}
