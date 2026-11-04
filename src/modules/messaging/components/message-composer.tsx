"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Spinner } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { CommentBody, type MentionCandidate } from "@/components/ui/comment-thread";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export interface ComposerSubmission {
  body: string;
  mentions: string[];
  internal: boolean;
  file: File | null;
}

const subscribeToNothing = () => () => undefined;

/** Mac : ⌘J, comme la maquette. Ailleurs : Ctrl J, la touche réellement attendue. */
function useSuggestShortcut(): string {
  return useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘J" : "Ctrl J"),
    () => "⌘J",
  );
}

/** Mention en cours de saisie : `@Eth` juste avant le curseur. */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([\p{L}\p{M}'’-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/**
 * Saisie de l'écran 02 (Figma 63:620) : trombone, champ, envoi rond. `CommentComposer` du kit n'a ni
 * valeur pilotée (« Utiliser la réponse » remplit le champ), ni pièce jointe, ni emplacement pour le
 * trombone : même technique ici (zone de texte au-dessus d'un calque qui colore les mentions).
 *
 * Entrée envoie, Maj + Entrée va à la ligne, ⌘J ou Ctrl + J demande une proposition.
 * Le texte n'est effacé qu'après un envoi réussi : `onSubmit` renvoie `true`.
 */
export function MessageComposer({
  value,
  onValueChange,
  recipient,
  members,
  canSuggest,
  onSuggest,
  onSubmit,
  textareaRef,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** `Claire`, pour l'aide de saisie. */
  recipient: string;
  members: readonly MentionCandidate[];
  canSuggest: boolean;
  onSuggest: () => void;
  onSubmit: (submission: ComposerSubmission) => Promise<boolean>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const listId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);

  const names = useMemo(() => members.map((member) => member.name), [members]);
  const matches = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLocaleLowerCase("fr-FR");
    return members.filter((member) => member.name.toLocaleLowerCase("fr-FR").startsWith(query));
  }, [members, mention]);
  const listOpen = matches.length > 0;
  const empty = value.trim() === "" && !file;

  function insertMention(member: MentionCandidate) {
    const textarea = textareaRef.current;
    if (!mention || !textarea) return;
    const caret = textarea.selectionStart;
    const inserted = `@${member.name} `;
    const nextCaret = mention.start + inserted.length;
    onValueChange(value.slice(0, mention.start) + inserted + value.slice(caret));
    setPicked((current) =>
      current.some((item) => item.id === member.id) ? current : [...current, member],
    );
    setMention(null);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function submit() {
    if (empty || pending) return;
    setPending(true);
    try {
      const done = await onSubmit({
        body: value.trim(),
        // Une mention effacée du texte ne compte plus.
        mentions: picked.filter((item) => value.includes(`@${item.name}`)).map((item) => item.id),
        internal,
        file,
      });
      if (done) {
        onValueChange("");
        setPicked([]);
        setFile(null);
        setMention(null);
        if (fileInput.current) fileInput.current.value = "";
      }
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
      event.preventDefault();
      if (canSuggest) onSuggest();
      return;
    }
    if (listOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = matches[highlight];
        if (candidate) {
          event.preventDefault();
          insertMention(candidate);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onValueChange(event.target.value);
    setMention(activeMention(event.target.value, event.target.selectionStart));
    setHighlight(0);
  }

  const shortcut = useSuggestShortcut();
  const hint = canSuggest ? ` (${shortcut} : demander une réponse à ChatGPT)` : "";
  const placeholder = internal
    ? "Note interne, invisible du client…"
    : `Écrire à ${recipient}…${hint}`;

  return (
    <div className="relative flex flex-col gap-2">
      {listOpen ? (
        <div className="anim-pop absolute bottom-full left-0 mb-2 w-[min(300px,100%)] rounded-md bg-surface p-1 shadow-float">
          <ul
            id={listId}
            role="listbox"
            aria-label="Mentionner une personne de l'équipe"
            className="flex flex-col gap-1"
          >
            {matches.map((member, index) => (
              <li
                key={member.id}
                id={`${listId}-${member.id}`}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(member);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2 rounded-sm p-2",
                  index === highlight && "bg-accent-pale",
                )}
              >
                <Avatar name={member.name} size={24} />
                <span className="text-sm font-medium text-text">{member.name}</span>
                {member.detail ? (
                  <span className="min-w-0 truncate text-xs text-muted">{member.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="px-2 py-1 text-xs text-muted">Entrée pour choisir · Échap pour fermer</p>
        </div>
      ) : null}

      {file ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted">
          <Icon name="paperclip" size={14} />
          <span className="min-w-0 truncate text-text">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
            className="hit-44 font-medium text-accent hover:underline hover:underline-offset-4"
          >
            Retirer
          </button>
        </p>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border border-border bg-surface p-2 transition-[border-color,box-shadow] duration-(--dur-fast) focus-within:border-text focus-within:shadow-[inset_0_0_0_0.5px_var(--text)]",
          internal && "bg-warn-pale",
        )}
      >
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={pending}
          aria-label="Joindre un fichier"
          title="Joindre un fichier"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-(--dur-fast) hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11"
        >
          <Icon name="paperclip" size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => setInternal((current) => !current)}
          aria-pressed={internal}
          aria-label="Note interne, invisible du client"
          title="Note interne, invisible du client"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-(--dur-fast) pointer-coarse:size-11",
            internal
              ? "bg-warn text-on-accent"
              : "text-muted hover:bg-surface-raised hover:text-text",
          )}
        >
          <Icon name="edit" size={18} />
        </button>

        <div className="grid min-w-0 flex-1">
          <div
            ref={overlay}
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 max-h-40 min-h-9 overflow-hidden px-1 py-2 text-sm break-words whitespace-pre-wrap text-text"
          >
            <CommentBody body={value} mentionNames={names} />
            {"​"}
          </div>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            // Pendant l'envoi : ce qui serait saisi serait effacé avec le texte parti.
            readOnly={pending}
            onChange={onChange}
            onSelect={(event) =>
              setMention(activeMention(value, event.currentTarget.selectionStart))
            }
            onKeyDown={onKeyDown}
            onBlur={() => setMention(null)}
            // Le calque coloré suit le défilement : au-delà de sa hauteur, le texte resterait figé.
            onScroll={(event) => {
              if (overlay.current) overlay.current.scrollTop = event.currentTarget.scrollTop;
            }}
            placeholder={placeholder}
            aria-label={internal ? "Note interne" : `Message à ${recipient}`}
            aria-expanded={listOpen}
            aria-controls={listOpen ? listId : undefined}
            aria-activedescendant={
              listOpen && matches[highlight] ? `${listId}-${matches[highlight].id}` : undefined
            }
            aria-autocomplete="list"
            role="combobox"
            className="col-start-1 row-start-1 max-h-40 min-h-9 resize-none overflow-y-auto bg-transparent px-1 py-2 text-sm break-words text-transparent caret-text outline-none placeholder:truncate placeholder:text-muted"
          />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={empty || pending}
          aria-label={internal ? "Enregistrer la note" : "Envoyer le message"}
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent transition-[filter,opacity] duration-(--dur-fast) hover:brightness-95 active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11"
        >
          {pending ? <Spinner /> : <Icon name="send" size={18} />}
        </button>
      </div>
    </div>
  );
}
