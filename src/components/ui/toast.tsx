"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icon";

type ToastTone = "success" | "danger" | "info";

interface ToastInput {
  message: string;
  tone?: ToastTone;
  /** Durée d'affichage en millisecondes. Une erreur reste plus longtemps. */
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastInput, "durationMs">> {
  id: number;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const ICONS: Record<ToastTone, IconName> = { success: "check", danger: "alert", info: "bell" };
const TONES: Record<ToastTone, string> = {
  success: "text-success",
  danger: "text-danger",
  info: "text-accent",
};

const DEFAULT_DURATION_MS = 5000;
const ERROR_DURATION_MS = 9000;

/** Pose la zone des notifications éphémères. Présent une fois, dans le layout racine. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const viewport = useRef<HTMLDivElement>(null);
  const preset = useMotionPreset();

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ message, tone = "success", durationMs }: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      const duration = durationMs ?? (tone === "danger" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  // Couche haute native : la notification reste au-dessus d'une fenêtre ouverte après elle.
  useEffect(() => {
    const element = viewport.current;
    if (!element || toasts.length === 0) return;
    if (element.matches(":popover-open")) element.hidePopover();
    element.showPopover();
  }, [toasts.length]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        ref={viewport}
        popover="manual"
        role="region"
        aria-label="Notifications"
        className="fixed inset-auto right-4 bottom-4 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              role={toast.tone === "danger" ? "alert" : "status"}
              initial={preset.message.initial}
              animate={preset.message.animate}
              exit={preset.leave}
              className="flex items-start gap-3 rounded-md bg-surface p-4 shadow-float"
            >
              <Icon name={ICONS[toast.tone]} size={18} className={cn("mt-px", TONES[toast.tone])} />
              <p className="min-w-0 flex-1 text-sm text-text">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Fermer la notification"
                className="hit-44 -m-1 rounded-sm p-1 text-muted hover:text-text"
              >
                <Icon name="close" size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast({ message: "Devis envoyé." })`. */
export function useToast(): (toast: ToastInput) => void {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast exige un ToastProvider parent.");
  return context;
}

/** Affiche le résultat d'une Server Action en notification, une fois par résultat. */
export function useActionToast(state: ActionState): void {
  const toast = useToast();
  const last = useRef<ActionState>(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.status === "success") toast({ message: state.message, tone: "success" });
    if (state.status === "error") toast({ message: state.message, tone: "danger" });
  }, [state, toast]);
}
