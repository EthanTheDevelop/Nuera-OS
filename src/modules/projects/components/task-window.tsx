"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";
import { ActivityList, type ActivityEntry } from "@/components/ui/activity-list";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CommentComposer, CommentThread, type ThreadComment } from "@/components/ui/comment-thread";
import { CompactButton } from "@/components/ui/compact-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/form";
import { DurationField } from "@/components/ui/form-client";
import { Icon } from "@/components/ui/icon";
import { Modal, ModalRow } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { IDLE_ACTION_STATE } from "@/lib/action-state";
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/domain-enums";
import { formatDateShort } from "@/lib/format";
import {
  addTaskCommentAction,
  addTaskDependencyAction,
  archiveTaskAction,
  createTaskAction,
  removeTaskDependencyAction,
  updateTaskAction,
} from "../project.actions";
import type { TaskDetail } from "../task.service";
import { canTaskTransition } from "../task.status";
import { TaskStatusControl } from "./task-controls";
import { useCommand } from "./use-project-command";

const QUIET_CONTROL = "h-9 border-transparent bg-transparent pl-0 text-sm hover:border-border";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[104px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[152px_minmax(0,1fr)]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-base text-text">{children}</dd>
    </div>
  );
}

function Dependencies({ task }: { task: TaskDetail }) {
  const { run, pending } = useCommand();
  const editable = task.capabilities.editPlanning;
  const linked = new Set(task.dependsOn.map((dependency) => dependency.id));
  const options = task.options.tasks.filter((option) => !linked.has(option.id));
  return (
    <div className="flex flex-col gap-1">
      {task.dependsOn.length === 0 && !editable ? <span>—</span> : null}
      {task.dependsOn.map((dependency) => (
        <span key={dependency.id} className="flex items-center gap-2">
          <span className="min-w-0 truncate">
            {dependency.title} · {TASK_STATUS_LABELS[dependency.status].toLocaleLowerCase("fr-FR")}
            {dependency.dueOn ? ` · ${formatDateShort(dependency.dueOn)}` : ""}
          </span>
          {editable ? (
            <button
              type="button"
              disabled={pending}
              aria-label={`Retirer la dépendance ${dependency.title}`}
              onClick={() => run(() => removeTaskDependencyAction(task.id, dependency.id))}
              className="hit-44 shrink-0 rounded-sm text-muted hover:text-danger"
            >
              <Icon name="minus" size={14} />
            </button>
          ) : null}
        </span>
      ))}
      {editable && options.length > 0 ? (
        <Select
          aria-label="Ajouter une dépendance"
          value=""
          disabled={pending}
          className={QUIET_CONTROL}
          onChange={(event) => {
            const id = event.target.value;
            if (id) run(() => addTaskDependencyAction(task.id, id));
          }}
        >
          <option value="">{task.dependsOn.length ? "Ajouter…" : "Aucune · ajouter…"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

function Subtasks({ task, hrefOf }: { task: TaskDetail; hrefOf: (taskId: string) => string }) {
  const { run, pending } = useCommand();
  const [title, setTitle] = useState("");

  function add() {
    const value = title.trim();
    if (!value) return;
    const formData = new FormData();
    formData.set("projectId", task.projectId);
    formData.set("parentTaskId", task.id);
    formData.set("title", value);
    run(
      () => createTaskAction(IDLE_ACTION_STATE, formData),
      () => setTitle(""),
    );
  }

  if (task.parent && task.subtasks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text">Sous-tâches</h3>
      {task.subtasks.length === 0 && !task.capabilities.addSubtask ? (
        <p className="text-sm text-muted">Aucune sous-tâche.</p>
      ) : null}
      {task.subtasks.length > 0 ? (
        <ul className="flex flex-col">
          {task.subtasks.map((subtask) => (
            <li
              key={subtask.id}
              className="flex min-h-10 items-center gap-3 border-b border-border last:border-b-0"
            >
              <Link
                href={hrefOf(subtask.id)}
                scroll={false}
                className="min-w-0 flex-1 truncate text-sm text-ink hover:underline hover:underline-offset-4"
              >
                {subtask.title}
              </Link>
              {subtask.assigneeName ? (
                <Avatar name={subtask.assigneeName} size={22} label={subtask.assigneeName} />
              ) : null}
              <TaskStatusControl
                taskId={subtask.id}
                title={subtask.title}
                status={subtask.status}
                nextStatuses={task.nextStatuses.length > 0 ? nextOf(subtask.status) : []}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {task.capabilities.addSubtask ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            aria-label="Nouvelle sous-tâche"
            placeholder="Ajouter une sous-tâche…"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 text-sm"
          />
          <CompactButton
            type="submit"
            variant="secondary"
            icon="plus"
            loading={pending}
            disabled={!title.trim()}
          >
            Ajouter
          </CompactButton>
        </form>
      ) : null}
    </section>
  );
}

/** La machine de statuts décide ; le service vérifie encore à l'exécution. */
function nextOf(status: TaskDetail["status"]): TaskDetail["status"][] {
  return (["todo", "in_progress", "blocked", "done"] as const).filter((next) =>
    canTaskTransition(status, next),
  );
}

function DescriptionTab({
  task,
  formId,
  hrefOf,
}: {
  task: TaskDetail;
  formId: string;
  hrefOf: (taskId: string) => string;
}) {
  const { run, pending } = useCommand();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const { editDescription, editPlanning, archive } = task.capabilities;

  return (
    <div className="flex flex-col gap-5 pt-4">
      {editDescription ? (
        <form
          id={formId}
          className="flex flex-col gap-3"
          action={(formData) => run(() => updateTaskAction(IDLE_ACTION_STATE, formData))}
        >
          <input type="hidden" name="taskId" value={task.id} />
          {editPlanning ? (
            <label className="flex flex-col gap-2 text-field-label text-text">
              Titre
              <Input name="title" required maxLength={200} defaultValue={task.title} />
            </label>
          ) : null}
          <label className="flex flex-col gap-2 text-field-label text-text">
            Description
            <Textarea
              name="description"
              rows={4}
              maxLength={8000}
              defaultValue={task.description ?? ""}
              placeholder="Ce qu’il faut faire, et comment savoir que c’est fait."
            />
          </label>
          {editPlanning ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-2 text-field-label text-text">
                Jalon
                <Select name="phaseId" defaultValue={task.phaseId ?? ""}>
                  <option value="">Sans jalon</option>
                  {task.options.phases.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-2 text-field-label text-text">
                Priorité
                <Select name="priority" defaultValue={task.priority}>
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </Select>
              </label>
              <DurationField
                id={`${formId}-estimate`}
                name="estimatedMinutes"
                label="Temps estimé"
                defaultMinutes={task.estimatedMinutes}
              />
            </div>
          ) : null}
        </form>
      ) : (
        <p className="text-base whitespace-pre-wrap text-text">
          {task.description || "Aucune description."}
        </p>
      )}
      <Subtasks task={task} hrefOf={hrefOf} />
      {archive ? (
        <div>
          <CompactButton variant="quiet" loading={pending} onClick={() => setConfirming(true)}>
            Archiver la tâche
          </CompactButton>
          <ConfirmDialog
            open={confirming}
            title="Archiver la tâche"
            description={
              task.subtasks.length > 0
                ? "La tâche et ses sous-tâches disparaissent du projet. Le journal reste."
                : "La tâche disparaît du projet. Le journal reste."
            }
            confirmLabel="Archiver"
            tone="danger"
            onCancel={() => setConfirming(false)}
            onConfirm={() =>
              run(
                () => archiveTaskAction(task.id),
                () => router.replace(hrefOf(""), { scroll: false }),
              )
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fenêtre « Tâche » (M4, motion.md §2.6 et §2.7). Le serveur porte l'état : `?tache=` l'ouvre, chaque
 * action revalide la page. Les dates des commentaires et du journal arrivent déjà formatées.
 */
export function TaskWindow({
  task,
  closeHref,
  taskHrefPrefix,
  comments,
  history,
  mentionNames,
  viewer,
  team,
}: {
  task: TaskDetail;
  closeHref: string;
  /** Adresse courante, prête à recevoir l'identifiant d'une autre tâche. */
  taskHrefPrefix: string;
  comments: readonly ThreadComment[];
  history: readonly ActivityEntry[];
  /** Noms à colorer dans le fil, y compris ceux qu'on ne peut plus mentionner ici. */
  mentionNames: readonly string[];
  viewer: string;
  team: readonly { name: string }[];
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState(task.comments.length > 0 ? "comments" : "description");
  const [documentId, setDocumentId] = useState("");
  const [parentId, setParentId] = useState("");
  const [unsent, setUnsent] = useState<string | null>(null);
  // Même identifiant tant que l'envoi n'a pas réussi : le renvoyer ne crée pas de doublon.
  const requestId = useRef<string | null>(null);
  const { run, announce, pending } = useCommand();
  const { editPlanning, comment: canComment, editDescription } = task.capabilities;
  const threads = task.comments.filter((comment) => comment.parentId === null);
  const descriptionForm = `${uid}-description`;
  const commentForm = `${uid}-comment`;

  const close = () => {
    setOpen(false);
    router.push(closeHref, { scroll: false });
  };
  const hrefOf = (taskId: string) => (taskId ? `${taskHrefPrefix}${taskId}` : closeHref);

  function saveField(name: string, value: string) {
    const formData = new FormData();
    formData.set("taskId", task.id);
    formData.set(name, value);
    run(() => updateTaskAction(IDLE_ACTION_STATE, formData));
  }

  const footer =
    tab === "history" || (tab === "description" && !editDescription) ? null : tab === "comments" &&
      !canComment ? null : (
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-3 text-sm text-muted">
          {team.length > 0 ? (
            <>
              Équipe
              <AvatarStack people={team} size={28} max={4} />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={close}>Annuler</Button>
          <Button
            type="submit"
            variant="accent"
            form={tab === "comments" ? commentForm : descriptionForm}
            loading={pending}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    );

  return (
    <Modal open={open} onClose={close} width={640} title={task.title} footer={footer}>
      <ModalRow>
        <p className="text-sm text-muted">
          {task.projectLabel} · {task.projectNumber}
          {task.parent ? (
            <>
              {" · sous-tâche de "}
              <Link
                href={hrefOf(task.parent.id)}
                scroll={false}
                className="text-accent hover:underline hover:underline-offset-4"
              >
                {task.parent.title}
              </Link>
            </>
          ) : null}
        </p>
      </ModalRow>
      <ModalRow>
        <dl className="flex flex-col gap-1">
          <FieldRow label="Responsable">
            {editPlanning ? (
              <span className="flex items-center gap-2">
                {task.assigneeName ? <Avatar name={task.assigneeName} size={28} /> : null}
                <Select
                  aria-label="Responsable"
                  value={task.assigneeMemberId ?? ""}
                  disabled={pending}
                  className={QUIET_CONTROL}
                  onChange={(event) => saveField("assigneeMemberId", event.target.value)}
                >
                  <option value="">Personne</option>
                  {task.options.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </Select>
              </span>
            ) : task.assigneeName ? (
              <span className="flex items-center gap-2">
                <Avatar name={task.assigneeName} size={28} />
                {task.assigneeName}
              </span>
            ) : (
              "Personne"
            )}
          </FieldRow>
          <FieldRow label="Échéance">
            {editPlanning ? (
              <Input
                key={task.dueOn ?? ""}
                type="date"
                aria-label="Échéance"
                defaultValue={task.dueOn ?? ""}
                disabled={pending}
                className={`tabular w-44 ${QUIET_CONTROL}`}
                onChange={(event) => {
                  // La saisie au clavier passe par des dates incomplètes : seule une date entière part.
                  if (event.target.value || event.target.validity.valid) {
                    saveField("dueOn", event.target.value);
                  }
                }}
              />
            ) : task.dueOn ? (
              formatDateShort(task.dueOn)
            ) : (
              "—"
            )}
          </FieldRow>
          <FieldRow label="Statut">
            <TaskStatusControl
              taskId={task.id}
              title={task.title}
              status={task.status}
              nextStatuses={task.nextStatuses}
            />
          </FieldRow>
          <FieldRow label="Dépend de">
            <Dependencies task={task} />
          </FieldRow>
        </dl>
      </ModalRow>
      <ModalRow>
        <Tabs
          label="Détail de la tâche"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              id: "description",
              label: "Description",
              content: <DescriptionTab task={task} formId={descriptionForm} hrefOf={hrefOf} />,
            },
            {
              id: "comments",
              label: `Commentaires · ${comments.length}`,
              content: (
                <div className="flex flex-col gap-4 pt-4">
                  <CommentThread
                    comments={comments}
                    mentionNames={mentionNames}
                    empty={<p className="text-sm text-muted">Aucun commentaire pour l’instant.</p>}
                  />
                  {canComment ? (
                    <div className="flex flex-col gap-2">
                      <CommentComposer
                        author={viewer}
                        formId={commentForm}
                        showSubmit={false}
                        members={task.options.mentionable}
                        onSubmit={async ({ body, mentionIds }) => {
                          requestId.current ??= crypto.randomUUID();
                          const done = announce(
                            await addTaskCommentAction({
                              taskId: task.id,
                              body,
                              mentions: mentionIds,
                              documentId: documentId || null,
                              parentId: parentId || null,
                              clientRequestId: requestId.current,
                            }),
                          );
                          if (done) {
                            requestId.current = null;
                            setDocumentId("");
                            setParentId("");
                          }
                          // Le champ se vide dans tous les cas : le texte reste lisible ici.
                          setUnsent(done ? null : body);
                        }}
                      />
                      {unsent ? (
                        <Alert tone="warn">Commentaire non envoyé : « {unsent} »</Alert>
                      ) : null}
                      {threads.length > 0 ? (
                        <label className="ml-11 flex items-center gap-2 text-sm text-muted">
                          <Icon name="messages" size={16} />
                          <span className="sr-only">Répondre à un commentaire</span>
                          <Select
                            value={parentId}
                            className={QUIET_CONTROL}
                            onChange={(event) => setParentId(event.target.value)}
                          >
                            <option value="">Nouveau fil</option>
                            {threads.map((thread) => (
                              <option key={thread.id} value={thread.id}>
                                Répondre à {thread.authorName} : {thread.body.slice(0, 48)}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ) : null}
                      {task.options.documents.length > 0 ? (
                        <label className="ml-11 flex items-center gap-2 text-sm text-muted">
                          <Icon name="paperclip" size={16} />
                          <span className="sr-only">Joindre un document du projet</span>
                          <Select
                            value={documentId}
                            className={QUIET_CONTROL}
                            onChange={(event) => setDocumentId(event.target.value)}
                          >
                            <option value="">Joindre un document du projet…</option>
                            {task.options.documents.map((document) => (
                              <option key={document.id} value={document.id}>
                                {document.title}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              id: "history",
              label: "Historique",
              content: (
                <div className="pt-4">
                  <ActivityList
                    items={history}
                    empty={<p className="text-sm text-muted">Aucun événement pour l’instant.</p>}
                  />
                </div>
              ),
            },
          ]}
        />
      </ModalRow>
    </Modal>
  );
}
