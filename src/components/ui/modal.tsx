"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { cn } from "@/lib/cn";
import { WINDOW_BACKDROP_BLUR } from "@/lib/motion";
import type { IconName } from "./icon";
import { TileHeader } from "./tile";

/**
 * Fenêtre (Figma 141:6795, 141:7330 ; motion.md §2.6) : écran flouté de 6 px sous un voile clair,
 * jamais noir ; 90 → 100 % en 300 ms ; contenu rangée par rangée ; fermeture en 200 ms sans cascade.
 *
 * Bâtie sur `<dialog>` natif : piège du focus, page inerte dessous, Échap et retour du focus sur le
 * déclencheur sont ceux du navigateur.
 *
 * - `icon` : en-tête de tuile (M3). Sans `icon` : grand titre 24/700 (M4).
 * - Envelopper les blocs dans `ModalRow` pour la cascade.
 * - Les `Gauge` et graphiques de la fenêtre rejouent leur remplissage à l'ouverture.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  width = 640,
  footer,
  closeLabel = "Fermer",
  dismissible = true,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Largeur en px : 560 (M3), 640 (M4). Bornée à l'écran. */
  width?: number;
  footer?: ReactNode;
  closeLabel?: string;
  /** `false` : ni Échap ni clic sur le voile (action en cours). */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <ModalInner
          key="modal"
          onClose={onClose}
          title={title}
          description={description}
          icon={icon}
          width={width}
          footer={footer}
          closeLabel={closeLabel}
          dismissible={dismissible}
          className={className}
        >
          {children}
        </ModalInner>
      ) : null}
    </AnimatePresence>
  );
}

function ModalInner({
  onClose,
  title,
  description,
  icon,
  width,
  footer,
  closeLabel,
  dismissible,
  className,
  children,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  width: number;
  footer?: ReactNode;
  closeLabel: string;
  dismissible: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const preset = useMotionPreset();

  // Avant la peinture : un `<dialog>` stylé en `flex` serait visible, fermé, le temps d'une image.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    // Le focus va à la fenêtre, pas au premier bouton : « Fermer » ne s'allume pas à l'ouverture.
    // Une fenêtre avec un champ à remplir le désigne par `data-autofocus`.
    const target = element.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
    target?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="hit-44 shrink-0 rounded-sm text-sm font-medium text-accent hover:underline hover:underline-offset-4"
    >
      {closeLabel}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        // `cancel` remonte l'arbre React : Échap ne ferme que la fenêtre du dessus.
        event.stopPropagation();
        if (dismissible) onClose();
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center bg-transparent p-2 text-text sm:p-6"
    >
      <motion.div
        aria-hidden="true"
        initial={preset.veil.initial}
        animate={preset.veil.animate}
        exit={preset.veil.exit}
        onClick={dismissible ? onClose : undefined}
        style={{
          backdropFilter: `blur(${WINDOW_BACKDROP_BLUR}px)`,
          WebkitBackdropFilter: `blur(${WINDOW_BACKDROP_BLUR}px)`,
        }}
        className="absolute inset-0 bg-(--veil-window)"
      />
      <motion.div
        ref={panel}
        tabIndex={-1}
        initial={preset.window.initial}
        animate={preset.window.animate}
        exit={preset.window.exit}
        style={{ width, maxWidth: "100%" }}
        data-replay
        data-window
        className={cn(
          "relative flex max-h-full flex-col overflow-hidden rounded-lg bg-surface shadow-float outline-none",
          className,
        )}
      >
        <motion.div
          variants={preset.cascade}
          initial="hidden"
          animate="visible"
          className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5 sm:p-6"
        >
          <ModalRow className="flex items-center gap-3">
            {icon ? (
              <TileHeader
                icon={icon}
                title={<span id={titleId}>{title}</span>}
                className="flex-1"
              />
            ) : (
              <h2 id={titleId} className="min-w-0 flex-1 text-window-title text-text">
                {title}
              </h2>
            )}
            {closeButton}
          </ModalRow>
          {description ? (
            <ModalRow>
              <p id={descriptionId} className="text-sm text-muted">
                {description}
              </p>
            </ModalRow>
          ) : null}
          {children}
          {footer ? <ModalRow>{footer}</ModalRow> : null}
        </motion.div>
      </motion.div>
    </dialog>
  );
}

/** Une rangée de fenêtre : arrive en cascade (60 ms d'écart, flou qui se dissipe). */
export function ModalRow({ className, children }: { className?: string; children: ReactNode }) {
  const preset = useMotionPreset();
  return (
    <motion.div variants={preset.row} className={className}>
      {children}
    </motion.div>
  );
}
