"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { ErrorState } from "@/components/states/states";
import { ActivityList } from "@/components/ui/activity-list";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommentComposer,
  CommentThread,
  type MentionCandidate,
} from "@/components/ui/comment-thread";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import {
  Checkbox,
  DateField,
  Field,
  FormAlert,
  Select,
  Textarea,
  TextareaField,
  TextField,
} from "@/components/ui/form";
import { DurationField, SubmitButton } from "@/components/ui/form-client";
import { Icon } from "@/components/ui/icon";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { UploadField } from "@/modules/documents/components/upload-field";
import { IDLE_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_CHANNEL_LABELS,
  TICKET_SEVERITY_LABELS,
  type TicketStatus,
} from "@/lib/domain-enums";
import {
  addTicketCommentAction,
  addTicketMessageAction,
  archiveTicketAction,
  assignTicketAction,
  convertTicketAction,
  logTicketTimeAction,
  refreshCoverageAction,
  transitionTicketAction,
  type CompanyTargetOptions,
} from "../ticket.actions";
import type { TicketWindowData, TicketWindowMessage } from "./ticket-view";
import { EditTicketForm } from "./ticket-form";

export interface TicketWindowPermissions {
  canUpdate: boolean;
  canComment: boolean;
  canLogTime: boolean;
  canAttach: boolean;
}

interface TicketWindowProps {
  data: TicketWindowData | null;
  open: boolean;
  onClose: () => void;
  permissions: TicketWindowPermissions;
  members: readonly { id: string; fullName: string }[];
  mentionCandidates: readonly MentionCandidate[];
  targets: CompanyTargetOptions | null;
  viewer: { name: string };
}

const SEVERITY_TONE = {
  low: "neutral",
  medium: "warn",
  high: "danger",
  critical: "danger",
} as const;

/**
 * Fiche d'une demande (note 11, dessinée d'après M4) : s'ouvre au-dessus de la liste floutée.
 * La fenêtre s'ouvre tout de suite ; son contenu arrive dès que le serveur a répondu.
 */
export function TicketWindow(props: TicketWindowProps) {
  const { data, open, onClose } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = data !== null && editingId === data.id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={data ? data.subject : "Ouverture de la demande…"}
      description={
        data
          ? [data.companyName, data.siteLabel, data.number].filter(Boolean).join(" · ")
          : undefined
      }
    >
      {data ? (
        editing ? (
          <EditTicketForm ticket={data} targets={props.targets} onDone={() => setEditingId(null)} />
        ) : (
          <TicketWindowBody
            key={data.id}
            {...props}
            data={data}
            onEdit={() => setEditingId(data.id)}
          />
        )
      ) : (
        <ModalRow>
          <WindowSkeleton />
        </ModalRow>
      )}
    </Modal>
  );
}

function WindowSkeleton() {
  return (
    <div role="status" aria-label="Chargement de la demande" className="flex flex-col gap-3">
      {[64, 48, 56, 40, 88, 72].map((width) => (
        <span
          key={width}
          aria-hidden="true"
          style={{ width: `${width}%` }}
          className="anim-pulse block h-4 rounded-sm bg-surface-raised"
        />
      ))}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 sm:grid-cols-[136px_minmax(0,1fr)]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-text">{children}</dd>
    </div>
  );
}

const NEXT_ACTION: Partial<Record<TicketStatus, { to: TicketStatus; label: string }>> = {
  received: { to: "qualified", label: "Qualifier" },
  qualified: { to: "in_progress", label: "Prendre en charge" },
  in_progress: { to: "resolved", label: "Marquer résolue" },
  resolved: { to: "closed", label: "Clôturer" },
};

function TicketWindowBody({
  data,
  onClose,
  onEdit,
  permissions,
  members,
  mentionCandidates,
  viewer,
}: TicketWindowProps & { data: TicketWindowData; onEdit: () => void }) {
  const [tab, setTab] = useState("description");
  const [closing, setClosing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const closed = data.status === "closed";
  const commentFormId = `ticket-comment-${data.id}`;

  function run(action: () => Promise<ActionState>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") toast({ message: result.message, tone: "danger" });
      else if (result.status === "success") after?.();
    });
  }

  const next = NEXT_ACTION[data.status];
  const nonClientMessages = data.messages.length;
  const commentsCount = data.comments?.length ?? 0;

  const statusActions =
    permissions.canUpdate && !closed ? (
      <>
        {data.status === "resolved" ? (
          <Button
            disabled={pending}
            onClick={() =>
              run(() =>
                transitionTicketAction({
                  ticketId: data.id,
                  toStatus: "in_progress",
                }),
              )
            }
          >
            Rouvrir
          </Button>
        ) : null}
        {next ? (
          <Button
            variant="accent"
            loading={pending}
            onClick={() => {
              if (next.to === "closed") setClosing(true);
              else run(() => transitionTicketAction({ ticketId: data.id, toStatus: next.to }));
            }}
          >
            {next.label}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <>
      <ModalRow>
        <dl className="flex flex-col gap-3">
          <FieldRow label="Responsable">
            {permissions.canUpdate && !closed ? (
              <AssigneeSelect data={data} members={members} />
            ) : data.assigneeName ? (
              <>
                <Avatar name={data.assigneeName} size={28} />
                {data.assigneeName}
              </>
            ) : (
              <span className="text-muted">Non attribuée</span>
            )}
          </FieldRow>
          <FieldRow label="Échéance">
            {data.dueText ?? <span className="text-muted">Aucune</span>}
            {data.overdueText ? <Badge tone="danger">{data.overdueText}</Badge> : null}
            {data.slaText ? (
              <span className="w-full text-xs text-muted">{data.slaText}</span>
            ) : null}
          </FieldRow>
          <FieldRow label="Statut">
            <StatusBadge
              kind="ticket"
              status={data.status}
              className="transition-colors duration-(--dur-fast)"
            />
            <Badge tone={SEVERITY_TONE[data.severity]}>
              {TICKET_SEVERITY_LABELS[data.severity]}
            </Badge>
            {data.isIncident ? <Badge tone="danger">Incident</Badge> : null}
          </FieldRow>
          <FieldRow label="Couverture">
            <StatusBadge kind="coverage" status={data.coverage} />
            {permissions.canUpdate && !closed ? (
              <CompactButton
                variant="quiet"
                disabled={pending}
                onClick={() => run(() => refreshCoverageAction(data.id))}
              >
                Recalculer
              </CompactButton>
            ) : null}
            {data.coverageReason ? (
              <span className="w-full text-xs text-muted">{data.coverageReason}</span>
            ) : null}
          </FieldRow>
        </dl>
      </ModalRow>

      <ConversionPanel data={data} canUpdate={permissions.canUpdate} />

      <ModalRow>
        <Tabs
          label="Sections de la demande"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              id: "description",
              label: "Description",
              content: (
                <DescriptionTab
                  data={data}
                  canUpdate={permissions.canUpdate && !closed}
                  canArchive={permissions.canUpdate}
                  onEdit={onEdit}
                  onArchive={() => setArchiving(true)}
                />
              ),
            },
            {
              id: "messages",
              label: `Messages · ${nonClientMessages}`,
              content: <MessagesTab data={data} canWrite={permissions.canUpdate && !closed} />,
            },
            {
              id: "commentaires",
              label: `Commentaires · ${commentsCount}`,
              content: (
                <CommentsTab
                  data={data}
                  formId={commentFormId}
                  author={viewer.name}
                  canComment={permissions.canComment}
                  members={mentionCandidates}
                />
              ),
            },
            {
              id: "historique",
              label: "Historique",
              content: (
                <ActivityList
                  items={data.history}
                  empty={<p className="text-sm text-muted">Aucun événement.</p>}
                />
              ),
            },
            {
              id: "fichiers",
              label: `Fichiers · ${data.attachments?.length ?? 0}`,
              content: <AttachmentsTab data={data} canAttach={permissions.canAttach && !closed} />,
            },
            {
              id: "temps",
              label: "Temps",
              content: <TimeTab data={data} canLogTime={permissions.canLogTime && !closed} />,
            },
          ]}
        />
      </ModalRow>

      {closing ? (
        <ModalRow>
          <CloseForm
            ticketId={data.id}
            onCancel={() => setClosing(false)}
            onDone={() => setClosing(false)}
          />
        </ModalRow>
      ) : (
        <ModalRow className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {data.people.length > 0 ? (
              <>
                <span className="text-sm text-muted">Intervenants</span>
                <AvatarStack people={data.people.map((name) => ({ name }))} size={28} max={4} />
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            {tab === "commentaires" && permissions.canComment && data.comments ? (
              <>
                <Button onClick={onClose}>Annuler</Button>
                <Button type="submit" variant="accent" form={commentFormId}>
                  Enregistrer
                </Button>
              </>
            ) : (
              statusActions
            )}
          </div>
        </ModalRow>
      )}

      <ConfirmDialog
        open={archiving}
        title="Archiver cette demande ?"
        description="Elle quitte le tableau et les listes. Son historique reste conservé."
        confirmLabel="Archiver"
        tone="danger"
        onCancel={() => setArchiving(false)}
        onConfirm={async () => {
          const result = await archiveTicketAction(data.id);
          setArchiving(false);
          if (result.status === "error") toast({ message: result.message, tone: "danger" });
          else onClose();
        }}
      />
    </>
  );
}

function AssigneeSelect({
  data,
  members,
}: {
  data: TicketWindowData;
  members: readonly { id: string; fullName: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  return (
    <>
      {data.assigneeName ? <Avatar name={data.assigneeName} size={28} /> : null}
      <div className="min-w-0 flex-1">
        <Select
          aria-label="Responsable"
          value={data.assigneeMemberId ?? ""}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            startTransition(async () => {
              const result = await assignTicketAction({
                ticketId: data.id,
                assigneeMemberId: value || null,
              });
              if (result.status === "error") toast({ message: result.message, tone: "danger" });
            });
          }}
          className="h-9 text-sm"
        >
          <option value="">Non attribuée</option>
          {/* Un membre parti ne se propose plus, mais la demande reste à son nom tant qu'on ne change rien. */}
          {data.assigneeMemberId &&
          !members.some((member) => member.id === data.assigneeMemberId) ? (
            <option value={data.assigneeMemberId}>
              {data.assigneeName ?? "Responsable actuel"}
            </option>
          ) : null}
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

/** Une demande hors forfait ou non couverte devient une prestation en un clic, sans perdre le lien. */
function ConversionPanel({ data, canUpdate }: { data: TicketWindowData; canUpdate: boolean }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const eligible = data.coverage === "overage" || data.coverage === "not_covered";
  const link = data.changeRequest;
  if (!link && !eligible) return null;

  function convert(target: "change_request" | "quote") {
    startTransition(async () => {
      const result = await convertTicketAction({ ticketId: data.id, target });
      if (result.status === "error") toast({ message: result.message, tone: "danger" });
    });
  }

  return (
    <ModalRow>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-raised px-4 py-3">
        <p className="min-w-0 flex-1 basis-56 text-sm text-text">
          {link ? (
            <>
              Demande de changement liée : <span className="font-medium">{link.title}</span>
              {link.quoteNumber && link.quoteId ? (
                <>
                  {" · devis "}
                  <Link
                    href={`/devis/${link.quoteId}`}
                    className="font-medium text-accent hover:underline hover:underline-offset-4"
                  >
                    {link.quoteNumber}
                  </Link>
                </>
              ) : null}
            </>
          ) : (
            "Cette demande sort du forfait : à transformer en prestation."
          )}
        </p>
        {canUpdate && eligible ? (
          <div className="flex flex-wrap gap-2">
            {!link ? (
              <CompactButton
                variant="secondary"
                loading={pending}
                onClick={() => convert("change_request")}
              >
                Demande de changement
              </CompactButton>
            ) : null}
            {!link?.quoteId ? (
              <CompactButton variant="primary" loading={pending} onClick={() => convert("quote")}>
                Créer un devis
              </CompactButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </ModalRow>
  );
}

function DescriptionTab({
  data,
  canUpdate,
  canArchive,
  onEdit,
  onArchive,
}: {
  data: TicketWindowData;
  canUpdate: boolean;
  canArchive: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base break-words whitespace-pre-wrap text-text">
        {data.description ?? <span className="text-muted">Aucune description.</span>}
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <FieldRow label="Canal">{TICKET_CHANNEL_LABELS[data.channel]}</FieldRow>
        <FieldRow label="Catégorie">{TICKET_CATEGORY_LABELS[data.category]}</FieldRow>
        <FieldRow label="Reçue le">{data.openedText}</FieldRow>
        <FieldRow label="Première réponse">{data.firstResponseText ?? "En attente"}</FieldRow>
        <FieldRow label="Contrat">{data.contractLabel ?? "Aucun"}</FieldRow>
        <FieldRow label="Projet">{data.projectLabel ?? "Aucun"}</FieldRow>
      </dl>
      {canUpdate || canArchive ? (
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <CompactButton variant="secondary" icon="edit" onClick={onEdit}>
              Modifier
            </CompactButton>
          ) : null}
          {canArchive ? (
            <CompactButton variant="quiet" onClick={onArchive}>
              Archiver
            </CompactButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageItem({ message }: { message: TicketWindowMessage }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3",
        message.internal && "-mx-2 rounded-md bg-warn-pale/50 p-2",
      )}
    >
      <Avatar name={message.authorName} size={32} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            <span className="font-medium text-text">{message.authorName}</span> · {message.date}
          </span>
          {message.internal ? <Badge tone="warn">Note interne</Badge> : null}
        </p>
        <p className="text-base break-words whitespace-pre-wrap text-text">{message.body}</p>
      </div>
    </div>
  );
}

function MessagesTab({ data, canWrite }: { data: TicketWindowData; canWrite: boolean }) {
  const preset = useMotionPreset();
  const [state, action] = useActionState(addTicketMessageAction, IDLE_ACTION_STATE);
  return (
    <div className="flex flex-col gap-4">
      {data.messages.length === 0 ? (
        <p className="text-sm text-muted">Aucun échange pour le moment.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {data.messages.map((message) => (
              <motion.li
                key={message.id}
                initial={preset.message.initial}
                animate={preset.message.animate}
              >
                <MessageItem message={message} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {canWrite ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="ticketId" value={data.id} />
          {state.status === "error" ? <FormAlert state={state} /> : null}
          <TextareaField
            name="body"
            label="Répondre"
            state={state}
            rows={3}
            placeholder="Votre réponse au client, ou une note pour l'équipe"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox
              name="internal"
              label="Note interne"
              description="Invisible dans l'espace client."
            />
            <SubmitButton>Envoyer</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function CommentsTab({
  data,
  formId,
  author,
  canComment,
  members,
}: {
  data: TicketWindowData;
  formId: string;
  author: string;
  canComment: boolean;
  members: readonly MentionCandidate[];
}) {
  const toast = useToast();
  if (data.comments === null) {
    return (
      <ErrorState
        compact
        title="Commentaires indisponibles"
        description="Ils n'ont pas pu être chargés. Le reste de la demande reste utilisable."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <CommentThread
        comments={data.comments}
        mentionNames={members.map((member) => member.name)}
        empty={<p className="text-sm text-muted">Aucun commentaire pour le moment.</p>}
      />
      {canComment ? (
        <CommentComposer
          author={author}
          formId={formId}
          showSubmit={false}
          members={members}
          onSubmit={async ({ body, mentionIds }) => {
            const result = await addTicketCommentAction({
              ticketId: data.id,
              body,
              mentions: mentionIds,
            });
            if (result.status === "error") {
              toast({ message: result.message, tone: "danger" });
              // Le champ garde sa saisie : `CommentComposer` ne le vide qu'à la réussite.
              throw new Error(result.message);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function AttachmentsTab({ data, canAttach }: { data: TicketWindowData; canAttach: boolean }) {
  const router = useRouter();
  const [shared, setShared] = useState(false);
  if (data.attachments === null) {
    return (
      <ErrorState
        compact
        title="Fichiers indisponibles"
        description="Ils n'ont pas pu être chargés. Le reste de la demande reste utilisable."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {data.attachments.length === 0 ? (
        <p className="text-sm text-muted">Aucun fichier joint.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.attachments.map((file) => (
            <li key={file.id}>
              <a
                href={file.href}
                className="flex items-center gap-2 rounded-sm py-1.5 text-sm text-text hover:bg-surface-raised"
              >
                <Icon name="paperclip" size={16} />
                <span className="min-w-0 flex-1 truncate">{file.title}</span>
                {file.shared ? <Badge tone="accent">Partagé client</Badge> : null}
              </a>
            </li>
          ))}
        </ul>
      )}
      {canAttach ? (
        <div className="flex flex-col gap-2">
          <UploadField
            label="Joindre un fichier"
            hint="Capture ou document, rattaché à cette demande."
            target={{
              ticketId: data.id,
              companyId: data.companyId,
              kind: "other",
              visibility: shared ? "client" : "internal",
            }}
            onUploaded={() => router.refresh()}
          />
          <Checkbox
            label="Partager dans l'espace client"
            checked={shared}
            onChange={(event) => setShared(event.target.checked)}
          />
        </div>
      ) : null}
    </div>
  );
}

function TimeTab({ data, canLogTime }: { data: TicketWindowData; canLogTime: boolean }) {
  const [state, action] = useActionState(logTicketTimeAction, IDLE_ACTION_STATE);
  if (data.time === null) {
    return (
      <ErrorState
        compact
        title="Temps indisponible"
        description="Il n'a pas pu être chargé. Le reste de la demande reste utilisable."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        <span className="text-muted">Temps passé : </span>
        <span className="font-mono font-medium">{data.time.totalText}</span>
      </p>
      {data.time.entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.time.entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 text-sm">
              <span className="w-16 shrink-0 font-mono text-xs text-muted">{entry.date}</span>
              <span className="min-w-0 flex-1 text-text">
                {entry.member}
                {entry.note ? <span className="text-muted"> · {entry.note}</span> : null}
              </span>
              {entry.billable ? null : <Badge>Non facturable</Badge>}
              <span className="shrink-0 font-mono text-xs text-text">{entry.minutes}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canLogTime ? (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="ticketId" value={data.id} />
          {state.status === "error" ? <FormAlert state={state} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <DurationField name="minutes" label="Durée" state={state} placeholder="1h30" />
            <DateField name="workOn" label="Jour" state={state} defaultValue={data.today} />
          </div>
          <TextField name="note" label="Note" state={state} maxLength={500} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Checkbox name="billable" label="Facturable" defaultChecked />
            <SubmitButton>Saisir le temps</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** Clôture : on écrit ce qui a été vérifié (09.03.03, « pas de fermeture trop tôt »). */
export function CloseForm({
  ticketId,
  onCancel,
  onDone,
}: {
  ticketId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const empty = note.trim() === "";

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty || pending) return;
        startTransition(async () => {
          const result = await transitionTicketAction({ ticketId, toStatus: "closed", note });
          if (result.status === "error") setError(result.message);
          else onDone();
        });
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        id="verification-note"
        label="Note de vérification"
        hint="Ce qui a été contrôlé avant de clôturer. Le temps saisi est alors imputé au forfait."
      >
        <Textarea
          id="verification-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          data-autofocus
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" variant="accent" loading={pending} disabled={empty}>
          Clôturer
        </Button>
      </div>
    </form>
  );
}
