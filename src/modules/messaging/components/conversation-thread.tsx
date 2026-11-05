"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { ConnectionRequired } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { CommentBody, type MentionCandidate } from "@/components/ui/comment-thread";
import { CompactButton } from "@/components/ui/compact-button";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { DURATION_MS, transition } from "@/lib/motion";
import { documentDownloadHref } from "@/modules/documents/document.format";
import {
  applySuggestionAction,
  dismissSuggestionAction,
  loadOlderMessagesAction,
  markReadAction,
  requestSuggestionAction,
  sendMessageAction,
  type ActionResult,
} from "../message.actions";
import { formatFileSize, type ThreadMessage } from "../messaging.format";
import type { SuggestionMode } from "../messaging.schema";
import type { SuggestionPanelState } from "../suggestion.service";
import { MessageComposer, type ComposerSubmission } from "./message-composer";
import { SuggestionCard } from "./suggestion-card";

function newRequestId(): string | undefined {
  return globalThis.crypto?.randomUUID?.();
}

/** Ce qui identifie un envoi : modifié, c'est un nouveau message et non une nouvelle tentative. */
function submissionKey(submission: ComposerSubmission): string {
  const { file } = submission;
  return JSON.stringify([
    submission.body,
    submission.internal,
    submission.mentions,
    file ? [file.name, file.size, file.lastModified] : null,
  ]);
}

const LOST_CONNECTION = "La connexion a été perdue. Votre texte est conservé : réessayez.";

function MessageBubble({
  message,
  mentionNames,
}: {
  message: ThreadMessage;
  mentionNames: readonly string[];
}) {
  const inbound = message.direction === "inbound";
  const internal = message.direction === "internal";
  return (
    <div
      className={cn(
        "flex max-w-[92%] flex-col gap-1.5 rounded-[20px] px-4 py-3 text-sm leading-[1.4]",
        inbound && "self-start border border-border bg-surface text-text",
        message.direction === "outbound" && "self-end bg-accent text-on-accent",
        internal && "self-end border border-warn/40 bg-warn-pale text-text",
      )}
    >
      {internal ? (
        <span className="font-mono text-amount-compact text-warn">Note interne</span>
      ) : null}
      {message.body ? (
        <p className="break-words whitespace-pre-wrap">
          <CommentBody body={message.body} mentionNames={mentionNames} />
        </p>
      ) : null}
      {message.attachment ? (
        <a
          href={documentDownloadHref(message.attachment.documentId)}
          className={cn(
            "flex max-w-full items-center gap-2 rounded-sm py-1 text-xs underline-offset-4 hover:underline",
            message.direction === "outbound" ? "text-on-accent" : "text-text",
          )}
        >
          <Icon name="paperclip" size={14} className="shrink-0" />
          <span className="min-w-0 truncate">
            {message.attachment.filename ?? message.attachment.title}
            {message.attachment.sizeBytes !== null
              ? ` · ${formatFileSize(message.attachment.sizeBytes)}`
              : ""}
          </span>
        </a>
      ) : null}
      <span
        className={cn(
          "font-mono text-[11px] leading-none",
          message.direction === "outbound" ? "text-on-accent/80" : "text-muted",
        )}
      >
        {message.signature}
      </span>
    </div>
  );
}

/**
 * Fil, proposition et saisie d'une conversation (Figma 63:569). À monter avec `key` sur la
 * conversation : le fil change par fondu de 200 ms, le panneau de droite ne bouge pas.
 */
export function ConversationThread({
  conversation,
  messages,
  hasOlder,
  suggestionPanel,
  mentionCandidates,
  canSend,
  panel,
  headerAside,
}: {
  conversation: {
    id: string;
    companyId: string;
    projectId: string | null;
    title: string;
    subtitle: string;
    initials: string;
    badge: string | null;
    recipient: string;
    unread: number;
    archived: boolean;
  };
  messages: readonly ThreadMessage[];
  hasOlder: boolean;
  suggestionPanel: SuggestionPanelState;
  mentionCandidates: readonly MentionCandidate[];
  canSend: boolean;
  /** Panneau client : à droite sur grand écran, en fenêtre « Détails » en dessous. */
  panel: ReactNode;
  /** Actions de l'en-tête (« Voir la fiche »). */
  headerAside?: ReactNode;
}) {
  const preset = useMotionPreset();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [older, setOlder] = useState<ThreadMessage[]>([]);
  const [moreOlder, setMoreOlder] = useState(hasOlder);
  const [loadingOlder, startLoadingOlder] = useTransition();
  const [suggestionPending, setSuggestionPending] = useState<
    SuggestionMode | "use" | "dismiss" | null
  >(null);
  // Une proposition déjà là à l'ouverture s'affiche ; celle qui arrive ensuite, demandée ou préparée
  // par l'automatisation, s'écrit (note 02), que le fil soit relu avant ou après la réponse d'action.
  const [firstSuggestionId] = useState(suggestionPanel.current?.id ?? null);
  // Seuls les messages arrivés depuis entrent en glissant. Ceux du premier rendu restent hors de
  // Motion : le préréglage dépend d'un média que le serveur ignore, l'hydratation divergerait.
  const [messagesAtOpening] = useState(() => new Set(messages.map((message) => message.id)));
  // Tentative en cours : un nouvel essai réutilise son identifiant et le fichier déjà déposé.
  const attempt = useRef<{ key: string; requestId?: string; documentId?: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const mentionNames = mentionCandidates.map((member) => member.name);
  const known = new Set(messages.map((message) => message.id));
  const all = [...older.filter((message) => !known.has(message.id)), ...messages];
  const lastId = all[all.length - 1]?.id;
  const current = suggestionPanel.current;

  // Un nouveau message amène le fil en bas ; charger l'historique ne le déplace pas.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lastId, current?.id]);

  // Lu seulement s'il est réellement à l'écran : sur téléphone, le fil peut être masqué.
  const unread = conversation.unread;
  useEffect(() => {
    if (!canSend || unread === 0 || conversation.archived) return;
    if (document.visibilityState !== "visible" || !root.current?.offsetParent) return;
    // Sans effet visible si l'appel échoue : le compteur reste, la prochaine relecture réessaie.
    markReadAction(conversation.id).catch(() => undefined);
  }, [canSend, conversation.archived, conversation.id, unread, lastId]);

  async function uploadAttachment(file: File, internal: boolean): Promise<string> {
    const params = new URLSearchParams({
      title: file.name.length >= 2 ? file.name : `Fichier ${file.name}`,
      kind: "other",
      visibility: internal ? "internal" : "client",
      companyId: conversation.companyId,
      filename: file.name,
    });
    if (conversation.projectId) params.set("projectId", conversation.projectId);
    const response = await fetch(`/api/documents/upload?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const payload = (await response.json().catch(() => null)) as {
      document?: { id: string };
      error?: { message?: string } | string;
      message?: string;
    } | null;
    if (!response.ok || !payload?.document) {
      const detail =
        payload?.message ??
        (typeof payload?.error === "object" ? payload.error?.message : undefined);
      throw new Error(detail ?? "Le fichier n'a pas pu être déposé.");
    }
    return payload.document.id;
  }

  async function send(submission: ComposerSubmission): Promise<boolean> {
    const key = submissionKey(submission);
    if (attempt.current?.key !== key) attempt.current = { key, requestId: newRequestId() };
    const ongoing = attempt.current;

    if (submission.file && !ongoing.documentId) {
      try {
        ongoing.documentId = await uploadAttachment(submission.file, submission.internal);
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : "Le fichier n'a pas pu être déposé.",
          tone: "danger",
        });
        return false;
      }
    }
    try {
      const result = await sendMessageAction({
        conversationId: conversation.id,
        body: submission.body,
        direction: submission.internal ? "internal" : "outbound",
        mentions: submission.mentions,
        documentId: ongoing.documentId,
        clientRequestId: ongoing.requestId,
      });
      if (!result.ok) {
        toast({ message: result.message, tone: "danger" });
        return false;
      }
    } catch {
      // Réponse perdue : le message a pu être enregistré, le même identifiant évite un doublon.
      toast({ message: LOST_CONNECTION, tone: "danger" });
      return false;
    }
    attempt.current = null;
    return true;
  }

  /** Action d'une proposition : le bouton se libère aussi si la réponse n'arrive jamais. */
  async function runSuggestion<T extends object>(
    pending: SuggestionMode | "use" | "dismiss",
    action: () => Promise<ActionResult<T>>,
  ) {
    setSuggestionPending(pending);
    try {
      const result = await action();
      if (!result.ok) toast({ message: result.message, tone: "danger" });
      return result;
    } catch {
      toast({ message: LOST_CONNECTION, tone: "danger" });
      return null;
    } finally {
      setSuggestionPending(null);
    }
  }

  async function requestSuggestion(mode: SuggestionMode) {
    if (suggestionPending) return;
    await runSuggestion(mode, () => requestSuggestionAction(conversation.id, mode));
  }

  async function fillFromSuggestion() {
    if (!current) return;
    const result = await runSuggestion("use", () => applySuggestionAction(current.id));
    if (!result?.ok) return;
    setDraft(result.body);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  async function dismissSuggestion() {
    if (!current) return;
    await runSuggestion("dismiss", () => dismissSuggestionAction(current.id));
  }

  function loadOlder() {
    const first = all[0];
    if (!first) return;
    const element = scroller.current;
    const previousHeight = element?.scrollHeight ?? 0;
    startLoadingOlder(async () => {
      const result = await loadOlderMessagesAction(conversation.id, { at: first.at, id: first.id });
      if (!result.ok) {
        toast({ message: result.message, tone: "danger" });
        return;
      }
      setOlder((currentOlder) => [...result.items, ...currentOlder]);
      setMoreOlder(result.hasMore);
      requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    });
  }

  const canSuggest =
    canSend &&
    suggestionPanel.enabled &&
    suggestionPanel.configured &&
    suggestionPanel.hasInbound &&
    !conversation.archived;
  const showConnection =
    canSend &&
    suggestionPanel.enabled &&
    !suggestionPanel.configured &&
    suggestionPanel.hasInbound &&
    !conversation.archived;
  const showSuggestionCard = canSend && suggestionPanel.enabled && current !== null;

  return (
    <motion.div
      ref={root}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition(preset.reduced ? DURATION_MS.reduced : DURATION_MS.exit)}
      className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-4 lg:min-h-[103px] lg:px-7">
        <Link
          href="/messages"
          aria-label="Retour aux conversations"
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted lg:hidden"
        >
          <Icon name="chevron" size={18} className="rotate-180" />
        </Link>
        <Avatar initials={conversation.initials} size={36} />
        <div className="min-w-[120px] flex-1">
          <h2 className="truncate text-base leading-[1.25] font-semibold text-ink">
            {conversation.title}
          </h2>
          <p className="truncate text-row-secondary text-muted">{conversation.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {conversation.badge ? (
            <span title={conversation.badge} className="max-w-[180px]">
              <Badge tone="accent" className="block max-w-full truncate">
                {conversation.badge}
              </Badge>
            </span>
          ) : null}
          <CompactButton
            variant="secondary"
            className="xl:hidden"
            onClick={() => setDetailsOpen(true)}
          >
            Détails
          </CompactButton>
          {headerAside}
        </div>
      </header>

      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 lg:px-7 lg:pt-12"
      >
        {moreOlder ? (
          <div className="flex justify-center">
            <CompactButton variant="quiet" loading={loadingOlder} onClick={loadOlder}>
              Messages précédents
            </CompactButton>
          </div>
        ) : null}

        {all.length === 0 ? (
          <p className="m-auto max-w-xs text-center text-sm text-muted">
            Aucun message pour l&apos;instant. Le premier s&apos;écrit ci-dessous.
          </p>
        ) : null}

        {all.map((message) =>
          messagesAtOpening.has(message.id) ? (
            <div key={message.id} className="flex flex-col">
              <MessageBubble message={message} mentionNames={mentionNames} />
            </div>
          ) : (
            <motion.div
              key={message.id}
              initial={preset.message.initial}
              animate={preset.message.animate}
              className="flex flex-col"
            >
              <MessageBubble message={message} mentionNames={mentionNames} />
            </motion.div>
          ),
        )}

        {showSuggestionCard && current ? (
          <SuggestionCard
            key={current.id}
            suggestion={current}
            animate={current.id !== firstSuggestionId}
            pending={suggestionPending}
            configured={suggestionPanel.configured}
            onUse={() => void fillFromSuggestion()}
            onRegenerate={(mode) => void requestSuggestion(mode)}
            onDismiss={() => void dismissSuggestion()}
          />
        ) : null}

        {!current && suggestionPending === "initial" ? (
          <p
            role="status"
            className="flex items-center gap-2 self-start rounded-[20px] border-[1.5px] border-dashed border-chatgpt bg-chatgpt-pale px-4 py-3 text-sm text-chatgpt"
          >
            <Spinner />
            ChatGPT prépare une proposition…
          </p>
        ) : null}

        {showConnection && !current ? (
          <div className="rounded-[20px] border-[1.5px] border-dashed border-border">
            <ConnectionRequired
              compact
              service="ChatGPT"
              missing="La clé d'API OpenAI ou le modèle n'est pas renseigné : aucune réponse ne peut être proposée."
            />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 px-4 pt-2 pb-4 lg:px-7 lg:pb-5">
        {conversation.archived ? (
          <p className="rounded-lg bg-surface-raised px-4 py-3 text-sm text-muted">
            Conversation archivée : plus rien ne s&apos;y écrit.
          </p>
        ) : canSend ? (
          <div className="flex flex-col gap-2">
            {canSuggest && !current && suggestionPending === null ? (
              <div>
                <CompactButton
                  variant="secondary"
                  icon="sparkle"
                  onClick={() => void requestSuggestion("initial")}
                >
                  Proposer une réponse
                </CompactButton>
              </div>
            ) : null}
            <MessageComposer
              value={draft}
              onValueChange={setDraft}
              recipient={conversation.recipient}
              members={mentionCandidates}
              canSuggest={canSuggest}
              onSuggest={() =>
                void requestSuggestion(current?.status === "ready" ? "rephrase" : "initial")
              }
              onSubmit={send}
              textareaRef={textarea}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-surface-raised px-4 py-3 text-sm text-muted">
            Lecture seule : votre rôle ne permet pas de répondre.
          </p>
        )}
      </div>

      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Détails" width={420}>
        {panel}
      </Modal>
    </motion.div>
  );
}

export function NoSelection() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-xs text-sm text-muted">
        Choisissez une conversation pour lire les messages et y répondre.
      </p>
    </div>
  );
}
