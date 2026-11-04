import type { CSSProperties, ReactNode } from "react";
import { GrowBar } from "@/components/motion/grow-bar";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";

export type StepState = "done" | "current" | "todo";

export interface TimelineStep {
  id: string;
  title: ReactNode;
  /** `15 oct. · fait`, `En cours · maquettes`. */
  detail?: ReactNode;
  state: StepState;
}

const STATE_LABEL: Record<StepState, string> = {
  done: "fait",
  current: "en cours",
  todo: "à venir",
};

/**
 * Frise d'étapes.
 * - `agency` (Figma 66:843, 100:4962) : cases, fait `success-pale`, en cours `--accent-pale`,
 *   à venir sans fond. Se remplit de gauche à droite à l'arrivée.
 * - `client` (Figma 155:6980) : rail, repères et marqueur « Nous en sommes là », remplissage 600 ms,
 *   léger halo sur l'étape en cours. Empilée verticalement sur un écran étroit.
 * Compatible serveur.
 */
export function StepTimeline({
  steps,
  variant = "agency",
  label,
  currentMarker = "Nous en sommes là",
  currentProgress = 0.45,
  className,
}: {
  steps: readonly TimelineStep[];
  variant?: "agency" | "client";
  /** Nom accessible de la liste. */
  label: string;
  /** Client : texte du marqueur posé sur le rail. */
  currentMarker?: string;
  /** Client : avancement dans l'étape en cours, de 0 à 1. */
  currentProgress?: number;
  className?: string;
}) {
  return variant === "agency" ? (
    <AgencyTimeline steps={steps} label={label} className={className} />
  ) : (
    <ClientTimeline
      steps={steps}
      label={label}
      currentMarker={currentMarker}
      currentProgress={currentProgress}
      className={className}
    />
  );
}

function AgencyTimeline({
  steps,
  label,
  className,
}: {
  steps: readonly TimelineStep[];
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("@container", className)}>
      <ol aria-label={label} className="grid gap-2 @2xl:auto-cols-fr @2xl:grid-flow-col">
        {steps.map((step, index) => (
          <li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative overflow-hidden rounded-md px-4 py-3"
          >
            {step.state !== "todo" ? (
              <span
                aria-hidden="true"
                style={{ "--i": index } as CSSProperties}
                className={cn(
                  "anim-grow-x absolute inset-0 origin-left",
                  step.state === "done" ? "bg-success-pale" : "bg-accent-pale",
                )}
              />
            ) : null}
            <div className="relative">
              <p className="text-row-primary text-ink">{step.title}</p>
              <p className="mt-2 text-row-secondary text-muted">
                {step.detail}
                <span className="sr-only"> ({STATE_LABEL[step.state]})</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Marker({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="flex size-7 items-center justify-center rounded-full bg-success text-paper">
        <Icon name="check" size={16} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="relative flex size-7 items-center justify-center">
        <span
          aria-hidden="true"
          className="anim-halo absolute -inset-1 rounded-full bg-en-cours/20"
        />
        <span className="relative size-7 rounded-full border-[6px] border-en-cours bg-surface" />
      </span>
    );
  }
  return <span className="block size-7 rounded-full border-2 border-border bg-surface" />;
}

function ClientTimeline({
  steps,
  label,
  currentMarker,
  currentProgress,
  className,
}: {
  steps: readonly TimelineStep[];
  label: string;
  currentMarker: string;
  currentProgress: number;
  className?: string;
}) {
  const last = Math.max(1, steps.length - 1);
  const currentIndex = steps.findIndex((step) => step.state === "current");
  const doneCount = steps.filter((step) => step.state === "done").length;
  const doneRatio = (currentIndex >= 0 ? currentIndex : Math.max(0, doneCount - 1)) / last;
  const progress = Math.max(0, Math.min(1, currentProgress));
  const currentRatio = currentIndex >= 0 ? (currentIndex + progress) / last : doneRatio;

  return (
    <div className={cn("@container", className)}>
      <div className="relative @3xl:h-28">
        {/* Grand format : rail horizontal avec repères, comme C3. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 hidden h-full @3xl:block">
          <div className="absolute inset-x-3.5 top-[43px] h-0.5 bg-border" />
          {currentIndex >= 0 ? (
            <div className="absolute inset-x-3.5 top-[43px] h-0.5">
              <GrowBar value={currentRatio} className="h-full bg-en-cours" />
            </div>
          ) : null}
          <div className="absolute inset-x-3.5 top-[43px] h-0.5">
            <GrowBar value={doneRatio} className="h-full bg-success" />
          </div>
          {currentIndex >= 0 ? (
            <div
              style={{ left: `calc(14px + (100% - 28px) * ${currentRatio})` }}
              className="anim-data absolute top-px -translate-x-1/2"
            >
              <span className="block rounded-full bg-text px-2.5 py-1 text-xs leading-[1.25] font-medium whitespace-nowrap text-bg">
                {currentMarker}
              </span>
              <span className="absolute top-[37px] left-1/2 h-3 w-0.5 -translate-x-1/2 bg-en-cours" />
            </div>
          ) : null}
        </div>
        <ol aria-label={label} className="flex flex-col gap-4">
          {steps.map((step, index) => {
            const position =
              index === 0
                ? "@3xl:left-0 @3xl:items-start @3xl:text-left"
                : index === steps.length - 1
                  ? "@3xl:right-0 @3xl:items-end @3xl:text-right"
                  : "@3xl:left-[calc(14px+(100%-28px)*var(--pos))] @3xl:-translate-x-1/2 @3xl:items-center @3xl:text-center";
            return (
              <li
                key={step.id}
                aria-current={step.state === "current" ? "step" : undefined}
                style={{ "--pos": index / last } as CSSProperties}
                className={cn(
                  "flex items-start gap-3 @3xl:absolute @3xl:top-[30px] @3xl:flex-col @3xl:gap-3",
                  position,
                )}
              >
                <Marker state={step.state} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-base leading-[1.25]",
                      step.state === "todo" ? "font-medium text-muted" : "font-semibold text-text",
                    )}
                  >
                    {step.title}
                  </p>
                  {step.detail ? (
                    <p
                      className={cn(
                        "mt-0.5 text-sm",
                        step.state === "done" && "text-success",
                        step.state === "current" && "text-warn",
                        step.state === "todo" && "text-muted",
                      )}
                    >
                      {step.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
