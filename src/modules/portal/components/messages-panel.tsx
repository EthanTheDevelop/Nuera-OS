"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CompactButton } from "@/components/ui/compact-button";
import { Alert } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { allowedTypeFor, FILE_INPUT_ACCEPT } from "@/integrations/storage/file-types";
import { documentDownloadHref, formatFileSize } from "@/modules/documents/document.format";
import { useFileUpload, type UploadFailure } from "@/modules/documents/components/use-file-upload";
import type { PortalMessage } from "@/modules/messaging/message.service";
import {
  loadOlderMessagesAction,
  markMessagesReadAction,
  sendMessageAction,
} from "../portal.actions";

const REFRESH_MS = 30_000;

const DAY_KEY = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "numeric",
  month: "long",
});

function dayLabel(at: Date, now: Date): string {
  if (DAY_KEY.format(at) === DAY_KEY.format(now)) return "Aujourd'hui";
  const label = DAY_LABEL.format(at);
  return label.charAt(0).toLocaleUpperCase("fr-FR") + label.slice(1);
}

/**
 * Seul un message qui arrive entre en mouvement. Le fil présent au chargement s'affiche posé : en
 * mouvement réduit, le préréglage du client diffère de celui du serveur et son décalage restait figé.
 */
function Bubble({ message, enter }: { message: PortalMessage; enter: boolean }) {
  const preset = useMotionPreset();
  const own = message.own;
  return (
    <motion.li
      layout="position"
      initial={enter ? preset.message.initial : false}
      animate={preset.message.animate}
      className={cn("flex items-start gap-2.5", own ? "justify-end" : "justify-start")}
    >
      {own ? null : <Avatar name={message.authorName} size={36} className="shrink-0" />}
      <div
        className={cn(
          "flex max-w-[min(494px,85%)] flex-col gap-2 rounded-lg px-4 py-3 text-sm leading-[1.3]",
          own ? "bg-accent text-on-accent" : "border border-border bg-surface text-ink",
        )}
      >
        {message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null}
        {message.attachment ? (
          <a
            href={documentDownloadHref(message.attachment.documentId)}
            className={cn(
              "flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline",
              own ? "text-on-accent" : "text-ink",
            )}
          >
            <Icon name="devis" size={16} className={own ? undefined : "text-accent"} />
            <span className="min-w-0 truncate">
              {message.attachment.filename ?? message.attachment.title}
              {message.attachment.sizeBytes
                ? ` · ${formatFileSize(message.attachment.sizeBytes)}`
                : ""}
            </span>
          </a>
        ) : null}
        <p className={cn("text-xs", own ? "text-on-accent/80" : "text-muted")}>
          {own ? "Vous" : message.authorName.split(" ")[0]} · {formatTime(message.at)}
        </p>
      </div>
    </motion.li>
  );
}

/**
 * Écran C4 : fil et saisie. Entrée envoie, Maj + Entrée va à la ligne. Le fil se relit toutes les
 * 30 secondes tant que l'onglet est visible. Répéter un envoi ne crée pas de doublon :
 * `clientRequestId` reste le même jusqu'à la réussite.
 */
export function MessagesPanel({
  messages,
  hasMore,
  unread,
  interlocutors,
  interlocutorNames,
  draft,
  projectId,
}: {
  messages: readonly PortalMessage[];
  hasMore: boolean;
  unread: number;
  interlocutors: readonly { fullName: string }[];
  interlocutorNames: string;
  draft?: string;
  projectId: string | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const [body, setBody] = useState(draft ?? "");
  const [loadedIds] = useState(() => new Set(messages.map((message) => message.id)));
  const [older, setOlder] = useState<PortalMessage[]>([]);
  const [canLoadOlder, setCanLoadOlder] = useState(hasMore);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const requestId = useRef<string>(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const endOfThread = useRef<HTMLLIElement>(null);
  const { progress, uploading, uploadDocument } = useFileUpload();

  const thread = useMemo(() => [...older, ...messages], [older, messages]);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    // Le compteur se relira au prochain passage : un échec ici ne gêne pas la lecture.
    if (unread > 0) markMessagesReadAction().catch(() => undefined);
  }, [unread]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    endOfThread.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = useCallback(
    async (text: string, documentId?: string) => {
      setSending(true);
      setError(null);
      try {
        const result = await sendMessageAction({
          body: text,
          documentId,
          clientRequestId: requestId.current,
        });
        if (result.status === "error") {
          setError(result.message);
          return false;
        }
      } catch {
        // Le texte reste dans la saisie ; le même identifiant évite un doublon au nouvel essai.
        setError("Le message n'a pas pu partir. Vérifiez votre connexion et réessayez.");
        return false;
      } finally {
        setSending(false);
      }
      requestId.current = crypto.randomUUID();
      router.refresh();
      return true;
    },
    [router],
  );

  async function submit() {
    const text = body.trim();
    if (!text || sending) return;
    if (await send(text)) {
      setBody("");
      textarea.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function attach(file: File) {
    setError(null);
    if (!allowedTypeFor(file.name)) {
      setError("Ce type de fichier n'est pas accepté.");
      return;
    }
    try {
      const uploaded = await uploadDocument(file, {
        title: file.name,
        ...(projectId ? { projectId } : {}),
      });
      if (await send(body.trim(), uploaded.id)) setBody("");
    } catch (failure) {
      setError((failure as UploadFailure).message);
    }
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void attach(file);
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void attach(file);
  }

  async function loadOlder() {
    const first = thread[0];
    if (!first) return;
    try {
      const result = await loadOlderMessagesAction({ at: first.at, id: first.id });
      setOlder((current) => [...result.messages, ...current]);
      setCanLoadOlder(result.hasMore);
    } catch {
      setError("Les messages précédents n'ont pas pu s'afficher. Réessayez.");
    }
  }

  const rows: { day?: string; message: PortalMessage }[] = [];
  let lastDay = "";
  for (const message of thread) {
    const key = DAY_KEY.format(message.at);
    rows.push({ day: key !== lastDay ? dayLabel(message.at, now) : undefined, message });
    lastDay = key;
  }

  return (
    <section className="flex min-h-[640px] min-w-0 flex-col rounded-xl border border-border bg-surface p-4 sm:p-7 lg:h-[952px]">
      <header className="flex items-center gap-3 border-b border-border pb-4">
        <AvatarStack people={interlocutors.map((person) => ({ name: person.fullName }))} />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-ink">{interlocutorNames}</h1>
          <p className="text-sm text-muted">Réponse en général dans la journée ouvrée</p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4">
        {canLoadOlder ? (
          <div className="flex justify-center pb-3">
            <CompactButton variant="quiet" onClick={() => void loadOlder()}>
              Afficher les messages précédents
            </CompactButton>
          </div>
        ) : null}
        {thread.length === 0 ? (
          <p className="m-auto max-w-[400px] text-center text-sm text-muted">
            Aucun message pour l&apos;instant. Écrivez-nous ici : la réponse arrive dans ce fil.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map(({ day, message }) => (
              <Fragment key={message.id}>
                {day ? (
                  <li className="flex justify-center">
                    <Badge tone="neutral">{day}</Badge>
                  </li>
                ) : null}
                <Bubble message={message} enter={!loadedIds.has(message.id)} />
              </Fragment>
            ))}
            <li ref={endOfThread} aria-hidden="true" />
          </ul>
        )}
      </div>

      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex items-end gap-2 rounded-md border bg-surface p-2 transition-colors duration-(--dur-fast)",
          dragging ? "border-accent" : "border-border",
        )}
      >
        <button
          type="button"
          aria-label="Joindre un fichier"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="hit-44 flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"
        >
          <Icon name="paperclip" size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={FILE_INPUT_ACCEPT}
          onChange={onFileChosen}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <label htmlFor={inputId} className="sr-only">
          Votre message
        </label>
        <textarea
          id={inputId}
          ref={textarea}
          rows={1}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Écrire à ${interlocutorNames}…`}
          className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted"
        />
        <button
          type="button"
          aria-label="Proposer un rendez-vous"
          onClick={() => {
            setBody(
              (text) => text || "Bonjour, je souhaiterais fixer un rendez-vous. Je vous propose : ",
            );
            textarea.current?.focus();
          }}
          className="hit-44 flex size-9 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink"
        >
          <Icon name="calendar" size={18} />
        </button>
        <button
          type="submit"
          aria-label="Envoyer"
          disabled={sending || uploading || !body.trim()}
          className="hit-44 flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent disabled:opacity-50"
        >
          <Icon name="send" size={18} />
        </button>
      </form>
      <div className="mt-2 flex flex-wrap justify-between gap-x-5 gap-y-1 text-xs text-muted">
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Icon name="paperclip" size={14} />
            {progress !== null
              ? `Envoi du fichier… ${progress} %`
              : "Joindre un fichier, ou le glisser ici"}
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="calendar" size={14} />
            Proposer un rendez-vous
          </span>
        </span>
        <span className="max-sm:hidden">
          Entrée pour envoyer · Maj + Entrée pour aller à la ligne
        </span>
      </div>
    </section>
  );
}
