"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Button } from "@/components/ui/button";
import type { MentionCandidate } from "@/components/ui/comment-thread";
import { Alert } from "@/components/ui/feedback";
import { Field, Select } from "@/components/ui/form";
import {
  KanbanBoard,
  type KanbanColumnDef,
  type KanbanItem,
  type KanbanMove,
} from "@/components/ui/kanban";
import { Modal, ModalRow } from "@/components/ui/modal";
import type { ActionState } from "@/lib/action-state";
import { DURATION_MS, EASE } from "@/lib/motion";
import { type TicketStatus } from "@/lib/domain-enums";
import { transitionTicketAction, type CompanyTargetOptions } from "../ticket.actions";
import { CreateTicketForm } from "./ticket-form";
import type { TicketWindowData } from "./ticket-view";
import { CloseForm, TicketWindow, type TicketWindowPermissions } from "./ticket-window";

interface Member {
  id: string;
  fullName: string;
}

interface WorkspaceContextValue {
  openTicket: (href: string) => void;
  requestClose: (ticket: { id: string; label: string }) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Composant à placer dans SupportWorkspace.");
  return context;
}

type PendingDialog =
  | {
      kind: "close";
      ticketId: string;
      label: string;
      resolve: (state: ActionState) => void;
    }
  | {
      kind: "assign";
      ticketId: string;
      label: string;
      resolve: (state: ActionState) => void;
    };

/** Annule un dépôt sans message : la carte reprend sa place. */
const CANCELLED: ActionState = { status: "error", message: "" };

/**
 * Le plan de travail de l'écran 11 : la fenêtre de détail, les dialogues de clôture et d'attribution
 * partagés par le tableau et par la liste. Le serveur porte l'état réel : `?demande=` ouvre la
 * fenêtre, chaque action revalide la page.
 */
export function SupportWorkspace({
  window: windowData,
  closeHref,
  permissions,
  members,
  mentionCandidates,
  targets,
  viewer,
  children,
}: {
  window: TicketWindowData | null;
  closeHref: string;
  permissions: TicketWindowPermissions;
  members: readonly Member[];
  mentionCandidates: readonly MentionCandidate[];
  targets: CompanyTargetOptions | null;
  viewer: { name: string };
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const [opening, setOpening] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PendingDialog | null>(null);

  if (opening && windowData) setOpening(false);
  if (dismissedId && !windowData) setDismissedId(null);

  const windowOpen = opening || (windowData !== null && windowData.id !== dismissedId);

  const value: WorkspaceContextValue = {
    openTicket(href) {
      setDismissedId(null);
      setOpening(true);
      startNavigation(() => router.push(href, { scroll: false }));
    },
    requestClose({ id, label }) {
      setDialog({ kind: "close", ticketId: id, label, resolve: () => undefined });
    },
  };

  function settleDialog(state: ActionState) {
    dialog?.resolve(state);
    setDialog(null);
  }

  return (
    <WorkspaceContext.Provider value={value}>
      <BoardBridge.Provider value={setDialog}>{children}</BoardBridge.Provider>
      <TicketWindow
        data={windowData}
        open={windowOpen}
        onClose={() => {
          setOpening(false);
          if (windowData) setDismissedId(windowData.id);
          startNavigation(() => router.push(closeHref, { scroll: false }));
        }}
        permissions={permissions}
        members={members}
        mentionCandidates={mentionCandidates}
        targets={targets}
        viewer={viewer}
      />
      <Modal
        open={dialog?.kind === "close"}
        onClose={() => settleDialog(CANCELLED)}
        width={480}
        title="Clôturer la demande"
        description={dialog?.label}
      >
        {dialog?.kind === "close" ? (
          <ModalRow>
            <CloseForm
              ticketId={dialog.ticketId}
              onCancel={() => settleDialog(CANCELLED)}
              onDone={() => settleDialog({ status: "success", message: "Demande clôturée." })}
            />
          </ModalRow>
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === "assign"}
        onClose={() => settleDialog(CANCELLED)}
        width={480}
        title="Attribuer avant de prendre en charge"
        description={dialog?.label}
      >
        {dialog?.kind === "assign" ? (
          <ModalRow>
            <AssignForm
              ticketId={dialog.ticketId}
              members={members}
              onCancel={() => settleDialog(CANCELLED)}
              onDone={settleDialog}
            />
          </ModalRow>
        ) : null}
      </Modal>
    </WorkspaceContext.Provider>
  );
}

const BoardBridge = createContext<((dialog: PendingDialog) => void) | null>(null);

function AssignForm({
  ticketId,
  members,
  onCancel,
  onDone,
}: {
  ticketId: string;
  members: readonly Member[];
  onCancel: () => void;
  onDone: (state: ActionState) => void;
}) {
  const [assigneeMemberId, setAssigneeMemberId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!assigneeMemberId || pending) return;
        startTransition(async () => {
          const result = await transitionTicketAction({
            ticketId,
            toStatus: "in_progress",
            assigneeMemberId,
          });
          if (result.status === "error") setError(result.message);
          else onDone(result);
        });
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id="move-assignee" label="Responsable">
        <Select
          id="move-assignee"
          value={assigneeMemberId}
          onChange={(event) => setAssigneeMemberId(event.target.value)}
          data-autofocus
        >
          <option value="">Choisir un membre</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" variant="accent" loading={pending} disabled={!assigneeMemberId}>
          Prendre en charge
        </Button>
      </div>
    </form>
  );
}

/**
 * Le tableau : glisser-déposer réel, à travers la machine à états du serveur. Une clôture demande
 * sa note de vérification, une prise en charge sans responsable demande d'en choisir un.
 */
export function SupportBoard({
  columns,
  items,
  statuses,
  unassigned,
}: {
  columns: readonly KanbanColumnDef[];
  items: readonly KanbanItem[];
  /** État réel de chaque carte, au moment du rendu serveur. */
  statuses: Readonly<Record<string, TicketStatus>>;
  unassigned: readonly string[];
}) {
  const openDialog = useContext(BoardBridge);

  function onMove({ itemId, toColumnId }: KanbanMove): void | Promise<ActionState> {
    const from = statuses[itemId];
    const to = toColumnId as TicketStatus;
    if (from === to) return; // L'ordre dans une colonne ne se conserve pas.
    const label = items.find((item) => item.id === itemId)?.label ?? "";
    if (from === "resolved" && to === "closed" && openDialog) {
      return new Promise((resolve) => {
        openDialog({ kind: "close", ticketId: itemId, label, resolve });
      });
    }
    const takesCharge = (from === "qualified" || from === "resolved") && to === "in_progress";
    if (takesCharge && unassigned.includes(itemId) && openDialog) {
      return new Promise((resolve) => {
        openDialog({ kind: "assign", ticketId: itemId, label, resolve });
      });
    }
    return transitionTicketAction({ ticketId: itemId, toStatus: to });
  }

  return (
    <KanbanBoard
      label="Demandes par état"
      columns={columns}
      items={items}
      onMove={onMove}
      className="lg:min-h-[calc(100dvh-198px)] lg:items-stretch [&>section]:bg-surface"
    />
  );
}

/** Lien d'une carte : la fenêtre s'ouvre tout de suite, sans attendre la réponse du serveur. */
export function TicketCardLink({ href, children }: { href: string; children: ReactNode }) {
  const { openTicket } = useWorkspace();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    openTicket(href);
  }
  return (
    <a
      href={href}
      draggable={false}
      onClick={onClick}
      className="after:absolute after:inset-0 after:rounded-md"
    >
      {children}
    </a>
  );
}

/** Bouton « Clôturer » de la colonne Résolue, au-dessus du lien de la carte. */
export function CloseTicketButton({ id, label }: { id: string; label: string }) {
  const { requestClose } = useWorkspace();
  return (
    <Button
      className="relative z-10 self-start text-row-secondary [&_.nu-btn-face]:px-3 [&_.nu-btn-face]:py-1.5"
      onClick={() => requestClose({ id, label })}
    >
      Clôturer
    </Button>
  );
}

/** « Appliqué » de la note 11 : une coche se dessine, puis la date apparaît en fondu. */
export function ClosedStamp({ date, justClosed }: { date: string; justClosed: boolean }) {
  const preset = useMotionPreset();
  const animate = justClosed && !preset.reduced;
  return (
    <p className="flex items-center gap-1.5 text-row-secondary text-muted">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-success"
      >
        <motion.path
          d="M5 13l4 4L19 7"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={animate ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: DURATION_MS.base / 1000, ease: EASE.out }}
        />
      </svg>
      <motion.span
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{
          duration: DURATION_MS.exit / 1000,
          delay: animate ? DURATION_MS.base / 1000 : 0,
        }}
      >
        Clôturée le {date}
      </motion.span>
    </p>
  );
}

/** « + Nouvelle demande » : fenêtre de création, puis ouverture de la fiche créée. */
export function NewTicketButton({
  companies,
  members,
  hrefPrefix,
}: {
  companies: readonly { id: string; name: string }[];
  members: readonly Member[];
  /** Adresse courante, prête à recevoir `demande=`. */
  hrefPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const { openTicket } = useWorkspace();
  return (
    <>
      <Button variant="accent" icon="plus" onClick={() => setOpen(true)}>
        Nouvelle demande
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} width={640} title="Nouvelle demande">
        <CreateTicketForm
          companies={companies}
          members={members}
          onCancel={() => setOpen(false)}
          onCreated={(ticketId) => {
            setOpen(false);
            openTicket(`${hrefPrefix}demande=${ticketId}`);
          }}
        />
      </Modal>
    </>
  );
}
