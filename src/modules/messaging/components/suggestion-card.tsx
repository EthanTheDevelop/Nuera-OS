"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactButton } from "@/components/ui/compact-button";
import { Icon } from "@/components/ui/icon";
import { STAGGER_MS } from "@/lib/motion";
import type { SuggestionMode } from "../messaging.schema";
import type { SuggestionView } from "../suggestion.service";

/**
 * Texte qui s'écrit mot à mot (note 02). Sous `prefers-reduced-motion`, le texte complet arrive en
 * fondu. Les lecteurs d'écran n'entendent que le texte final : le découpage leur est masqué.
 */
function WordReveal({
  text,
  animate,
  onDone,
}: {
  text: string;
  animate: boolean;
  onDone: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const reveal = animate && !reduced;
  const [count, setCount] = useState(reveal ? 0 : words.length);
  const finished = !reveal || count >= words.length;

  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => {
      setCount((current) => Math.min(current + 1, words.length));
    }, STAGGER_MS.menu);
    return () => window.clearInterval(timer);
  }, [finished, words.length]);

  // Séparé du minuteur : prévenir le parent pendant un `setCount` provoque une erreur React.
  useEffect(() => {
    if (finished) onDone();
    // `onDone` change à chaque rendu du parent : seule la fin de l'écriture compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="whitespace-pre-wrap">
        {words.slice(0, count).join("")}
      </span>
    </>
  );
}

/**
 * Suggestion (Figma 63:591) : fond `chatgpt-pale`, pointillés, rayon 20. Rien ne s'envoie d'ici :
 * « Utiliser la réponse » remplit le champ (A10). Les actions restent inactives pendant l'écriture.
 */
export function SuggestionCard({
  suggestion,
  animate,
  pending,
  configured,
  onUse,
  onRegenerate,
  onDismiss,
}: {
  suggestion: SuggestionView;
  /** Proposition qui vient d'arriver : elle s'écrit. À l'affichage d'une page, elle est déjà là. */
  animate: boolean;
  pending: SuggestionMode | "use" | "dismiss" | null;
  configured: boolean;
  onUse: () => void;
  onRegenerate: (mode: SuggestionMode) => void;
  onDismiss: () => void;
}) {
  const preset = useMotionPreset();
  const [written, setWritten] = useState(!animate);
  const busy = pending !== null || !written;

  const frame =
    "flex flex-col gap-3 rounded-[20px] border-[1.5px] border-dashed border-chatgpt bg-chatgpt-pale p-4";

  if (suggestion.status === "failed") {
    return (
      <motion.div
        role="alert"
        initial={preset.swapIn.initial}
        animate={preset.swapIn.animate}
        className={frame}
      >
        <p className="flex items-center gap-2 text-sm font-medium text-chatgpt">
          <Icon name="sparkle" size={16} />
          La proposition n&apos;a pas pu être préparée
        </p>
        <p className="text-sm text-text">{suggestion.error}</p>
        <div className="flex flex-wrap gap-2">
          {configured ? (
            <CompactButton
              variant="secondary"
              loading={pending === "initial"}
              disabled={busy}
              onClick={() => onRegenerate("initial")}
            >
              Réessayer
            </CompactButton>
          ) : null}
          <CompactButton
            variant="quiet"
            loading={pending === "dismiss"}
            disabled={busy}
            onClick={onDismiss}
          >
            Écarter
          </CompactButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={preset.swapIn.initial}
      animate={preset.swapIn.animate}
      aria-busy={!written}
      className={frame}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-chatgpt">
        <Icon name="sparkle" size={16} />
        Réponse proposée par ChatGPT
      </p>
      <div className="flex flex-wrap gap-1.5">
        {suggestion.tone ? (
          <Badge className="bg-surface text-text">
            Ton : {suggestion.tone.toLocaleLowerCase("fr-FR")}
          </Badge>
        ) : null}
        <Badge className="bg-surface text-text">Clé d&apos;API de l&apos;agence</Badge>
      </div>
      <p className="text-sm leading-[1.45] text-text">
        <WordReveal
          key={suggestion.id}
          text={suggestion.body ?? ""}
          animate={animate}
          onDone={() => setWritten(true)}
        />
      </p>
      {suggestion.contextSummary ? (
        <p className="flex items-center gap-1.5 text-[11px] leading-[1.3] text-muted">
          <Icon name="link" size={12} className="shrink-0" />
          Contexte lu : {suggestion.contextSummary}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="accent" loading={pending === "use"} disabled={busy} onClick={onUse}>
          Utiliser la réponse
        </Button>
        {configured ? (
          <>
            <Button
              loading={pending === "rephrase"}
              disabled={busy}
              onClick={() => onRegenerate("rephrase")}
            >
              Reformuler
            </Button>
            <Button
              loading={pending === "shorter"}
              disabled={busy}
              onClick={() => onRegenerate("shorter")}
            >
              Plus court
            </Button>
          </>
        ) : null}
      </div>
      {configured ? null : (
        <p className="text-xs text-muted">
          Pour reformuler,{" "}
          <Link
            href="/reglages/connexions"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            une connexion à OpenAI est requise
          </Link>
          .
        </p>
      )}
    </motion.div>
  );
}
