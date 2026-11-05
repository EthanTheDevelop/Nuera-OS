"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { cn } from "@/lib/cn";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { Icon } from "./icon";

export interface MentionCandidate {
  id: string;
  name: string;
  /** Initiales, si `name` n'est qu'un prénom. */
  initials?: string;
  /** `design et front-end`, affiché dans la liste. */
  detail?: string;
}

export interface ThreadComment {
  id: string;
  author: string;
  /** Initiales, si `author` n'est qu'un prénom. */
  authorInitials?: string;
  /** Date formatée (`hier 17:40`, `à l'instant`). */
  date: string;
  body: string;
  /** Réponse : en retrait de 48 px, comme M4. */
  isReply?: boolean;
  attachment?: { name: string; detail?: string; href?: string };
}

export interface CommentSubmission {
  body: string;
  /** Identifiants des personnes mentionnées (`comments.mentions`). */
  mentionIds: string[];
}

/** Coupe un texte autour des mentions connues, pour les colorer. */
function splitMentions(
  text: string,
  names: readonly string[],
): { text: string; mention: boolean }[] {
  if (names.length === 0) return [{ text, mention: false }];
  const escaped = [...names]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part, index) => ({ text: part, mention: index % 2 === (text.startsWith("@") ? 0 : 1) }));
}

/** Corps de commentaire : les mentions passent en couleur d'accent (M4). */
export function CommentBody({
  body,
  mentionNames,
  sameMetrics = false,
}: {
  body: string;
  mentionNames: readonly string[];
  /** Couleur seule : le calque miroir de la zone de texte doit garder ses largeurs de caractères. */
  sameMetrics?: boolean;
}) {
  return (
    <>
      {splitMentions(body, mentionNames).map((part, index) =>
        part.mention ? (
          <span key={index} className={cn("text-accent", !sameMetrics && "font-medium")}>
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Fil de commentaires (M4, motion.md §2.7). Les noms mentionnés se colorent ; un nouveau commentaire
 * entre en bas du fil (fondu + 8 px, 250 ms). Toujours un `body` en texte, jamais de HTML.
 */
export function CommentThread({
  comments,
  mentionNames = [],
  empty,
  className,
}: {
  comments: readonly ThreadComment[];
  mentionNames?: readonly string[];
  empty?: ReactNode;
  className?: string;
}) {
  const preset = useMotionPreset();
  if (comments.length === 0) return <>{empty}</>;
  return (
    <ul className={cn("flex flex-col gap-4", className)}>
      <AnimatePresence initial={false}>
        {comments.map((comment) => (
          <motion.li
            key={comment.id}
            initial={preset.message.initial}
            animate={preset.message.animate}
            className={cn("flex items-start gap-3", comment.isReply && "pl-6 sm:pl-12")}
          >
            <Avatar name={comment.author} initials={comment.authorInitials} size={32} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <p className="text-sm text-muted">
                <span className="font-medium text-text">{comment.author}</span> · {comment.date}
              </p>
              <p className="text-base break-words whitespace-pre-wrap text-text">
                <CommentBody body={comment.body} mentionNames={mentionNames} />
              </p>
              {comment.attachment ? <Attachment {...comment.attachment} /> : null}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Attachment({ name, detail, href }: { name: string; detail?: string; href?: string }) {
  const content = (
    <>
      <Icon name="paperclip" size={16} />
      <span className="min-w-0 truncate">
        {name}
        {detail ? ` · ${detail}` : ""}
      </span>
    </>
  );
  const classes =
    "flex max-w-full items-center gap-2 rounded-sm py-1.5 pr-3 pl-2.5 text-xs text-text";
  return href ? (
    <a href={href} className={cn(classes, "hover:bg-surface-raised")}>
      {content}
    </a>
  ) : (
    <div className={classes}>{content}</div>
  );
}

/** Mention en cours de saisie : `@Eth` juste avant le curseur. */
function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\p{L}\p{M}'’-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/**
 * Champ de commentaire avec liste de mentions (M4, Figma 141:7382).
 *
 * Saisir `@` ouvre la liste, filtrée au fil de la frappe. Flèches pour choisir, Entrée ou Tab pour
 * insérer, Échap pour fermer ; la mention insérée passe en couleur. Pas de bibliothèque d'édition :
 * une zone de texte transparente au-dessus d'un calque miroir qui colore les mentions.
 *
 * Deux façons d'envoyer :
 * - `action` : Server Action, champs `body` et `mentions` (identifiants séparés par des virgules) ;
 * - `onSubmit` : appel direct. Le champ se vide à la réussite ; un rejet garde la saisie, à l'appelant
 *   d'annoncer l'erreur.
 */
export function CommentComposer({
  author,
  authorInitials,
  formId,
  showSubmit = true,
  members,
  placeholder = "Ajouter un commentaire…",
  submitLabel = "Enregistrer",
  action,
  onSubmit,
  disabled = false,
  className,
}: {
  /** Auteur courant, pour l'avatar. */
  author: string;
  authorInitials?: string;
  /** Identifiant du formulaire : pour un bouton d'envoi externe (`<Button form={id}>`, comme M4). */
  formId?: string;
  showSubmit?: boolean;
  /** Personnes mentionnables : données du module Équipe, jamais figées. */
  members: readonly MentionCandidate[];
  placeholder?: string;
  submitLabel?: string;
  action?: (formData: FormData) => void | Promise<void>;
  onSubmit?: (submission: CommentSubmission) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const listId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [pending, setPending] = useState(false);

  const names = useMemo(() => members.map((member) => member.name), [members]);
  const matches = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLocaleLowerCase("fr-FR");
    return members.filter((member) => member.name.toLocaleLowerCase("fr-FR").startsWith(query));
  }, [members, mention]);
  const listOpen = matches.length > 0;

  function refreshMention(value: string, caret: number) {
    setMention(activeMention(value, caret));
    setHighlight(0);
  }

  function insert(member: MentionCandidate) {
    if (!mention || !textarea.current) return;
    const caret = textarea.current.selectionStart;
    const inserted = `@${member.name} `;
    const next = text.slice(0, mention.start) + inserted + text.slice(caret);
    const nextCaret = mention.start + inserted.length;
    setText(next);
    setPicked((current) =>
      current.some((item) => item.id === member.id) ? current : [...current, member],
    );
    setMention(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!listOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const candidate = matches[highlight];
      if (candidate) {
        event.preventDefault();
        insert(candidate);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMention(null);
    }
  }

  // Une mention effacée du texte ne compte plus.
  const mentionIds = picked
    .filter((member) => text.includes(`@${member.name}`))
    .map((member) => member.id);
  const empty = text.trim() === "";

  function reset() {
    setText("");
    setPicked([]);
    setMention(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (empty || pending) {
      event.preventDefault();
      return;
    }
    if (!onSubmit) return; // Server Action : le navigateur et React s'en chargent.
    event.preventDefault();
    setPending(true);
    try {
      await onSubmit({ body: text.trim(), mentionIds });
      reset();
    } catch {
      // L'appelant a annoncé l'échec : le champ garde sa saisie, rien ne reste non capté.
    } finally {
      setPending(false);
    }
  }

  const activeOptionId = listOpen ? `${listId}-${matches[highlight]?.id}` : undefined;

  return (
    <form
      id={formId}
      action={
        action
          ? async (formData) => {
              try {
                await action(formData);
                reset();
              } catch {
                // Même règle qu'avec `onSubmit` : un échec garde la saisie.
              }
            }
          : undefined
      }
      onSubmit={submit}
      className={cn("flex items-start gap-3", className)}
    >
      <Avatar name={author} initials={authorInitials} size={32} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <input type="hidden" name="mentions" value={mentionIds.join(",")} />
        {/* Grille empilée : le miroir donne la hauteur, la zone de texte le recouvre exactement. */}
        <div className="grid rounded-md border border-border bg-surface transition-[border-color,box-shadow] duration-(--dur-fast) focus-within:border-text focus-within:shadow-[inset_0_0_0_0.5px_var(--text)]">
          <div
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 min-h-12 p-3 text-base break-words whitespace-pre-wrap text-text"
          >
            {mention ? (
              <>
                <CommentBody body={text.slice(0, mention.start)} mentionNames={names} sameMetrics />
                <span className="text-accent">
                  {text.slice(mention.start, mention.start + mention.query.length + 1)}
                </span>
                <CommentBody
                  body={text.slice(mention.start + mention.query.length + 1)}
                  mentionNames={names}
                  sameMetrics
                />
              </>
            ) : (
              <CommentBody body={text} mentionNames={names} sameMetrics />
            )}
            {/* Un saut final garde une ligne vide visible, comme la zone de texte. */}
            {"​"}
          </div>
          <textarea
            ref={textarea}
            id={inputId}
            name="body"
            rows={1}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              refreshMention(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) => refreshMention(text, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onBlur={() => setMention(null)}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            className="col-start-1 row-start-1 min-h-12 resize-none overflow-hidden bg-transparent p-3 text-base break-words text-transparent caret-text outline-none placeholder:text-muted placeholder:transition-opacity placeholder:duration-(--dur-fast) focus:placeholder:opacity-0"
          />
        </div>
        {listOpen ? (
          // Dans le flux, comme M4 : la liste pousse ce qui suit plutôt que de le recouvrir.
          <div className="anim-pop w-[min(300px,100%)] rounded-md bg-surface p-1 shadow-float">
            <ul
              id={listId}
              role="listbox"
              aria-label="Mentionner un associé"
              className="flex flex-col gap-1"
            >
              {matches.map((member, index) => (
                <li
                  key={member.id}
                  id={`${listId}-${member.id}`}
                  role="option"
                  aria-selected={index === highlight}
                  // `mousedown` : le clic ne doit pas retirer le focus avant l'insertion.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insert(member);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex min-h-10 cursor-pointer items-center gap-2 rounded-sm p-2",
                    index === highlight && "bg-accent-pale",
                  )}
                >
                  <Avatar name={member.name} initials={member.initials} size={24} />
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
        {showSubmit ? (
          <div className="mt-1 flex justify-end">
            <Button type="submit" variant="accent" loading={pending} disabled={empty || disabled}>
              {submitLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </form>
  );
}
