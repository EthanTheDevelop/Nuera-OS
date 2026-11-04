"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useMotionPreset } from "@/components/motion/motion-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-card";
import { Tile } from "@/components/ui/tile";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { DURATION_MS } from "@/lib/motion";
import type { ProjectSimulation } from "../capacity";
import { parseChargeDuration } from "../time-format";
import { simulateProjectAction } from "../time.actions";

const FIELD_ID = "simulateur-projet";

const INPUT = cn(
  "h-8 w-[170px] max-w-full rounded-sm border border-transparent bg-transparent px-1.5 text-right text-sm text-text outline-none",
  "transition-[border-color] duration-(--dur-fast) placeholder:text-muted",
  "hover:border-border focus:border-text focus:bg-surface aria-invalid:border-danger pointer-coarse:h-11",
);

/** La date change par fondu croisé, jamais d'un coup (note Mouvement de l'écran 18). */
function SwapValue({ value, children }: { value: string; children: React.ReactNode }) {
  const preset = useMotionPreset();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={value}
        className="inline-block"
        initial={preset.swapIn.initial}
        animate={preset.swapIn.animate}
        exit={preset.leave}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Carte « Simuler un nouveau projet » (Figma 100:5480) : aucun enregistrement, la charge réelle seule. */
export function ProjectSimulator() {
  const [name, setName] = useState("");
  const [charge, setCharge] = useState("");
  const [simulation, setSimulation] = useState<ProjectSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSimulating] = useTransition();
  const timer = useRef<number | undefined>(undefined);

  const minutes = parseChargeDuration(charge);
  const invalid = charge.trim() !== "" && minutes === null;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function onChargeChange(next: string) {
    setCharge(next);
    window.clearTimeout(timer.current);
    const parsed = parseChargeDuration(next);
    if (parsed === null || parsed <= 0) {
      setSimulation(null);
      setError(null);
      return;
    }
    timer.current = window.setTimeout(() => {
      startSimulating(async () => {
        const result = await simulateProjectAction(parsed);
        if (result.status === "success") {
          setSimulation(result.simulation);
          setError(null);
        } else {
          setSimulation(null);
          setError(result.message);
        }
      });
    }, DURATION_MS.base);
  }

  const noRoom = simulation && !simulation.goLiveOn;

  return (
    <Tile
      icon="rocket"
      title="Simuler un nouveau projet"
      className="scroll-mt-6 gap-3 rounded-lg p-6"
    >
      <dl className="flex flex-col gap-2" aria-busy={pending || undefined}>
        <InfoRow
          label={<label htmlFor={FIELD_ID}>Projet</label>}
          value={
            <input
              id={FIELD_ID}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nom du projet"
              autoComplete="off"
              className={INPUT}
            />
          }
        />
        <InfoRow
          label={<label htmlFor={`${FIELD_ID}-charge`}>Charge estimée</label>}
          value={
            <input
              id={`${FIELD_ID}-charge`}
              value={charge}
              onChange={(event) => onChargeChange(event.target.value)}
              placeholder="15 j"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${FIELD_ID}-erreur` : undefined}
              className={INPUT}
            />
          }
        />
        <InfoRow
          label="Début possible"
          value={
            <SwapValue value={simulation?.startOn ?? "vide"}>
              {simulation?.startOn ? formatDateShort(simulation.startOn) : "—"}
            </SwapValue>
          }
        />
        <InfoRow
          label="Mise en ligne réaliste"
          value={
            <SwapValue value={simulation?.goLiveOn ?? "vide"}>
              {simulation?.goLiveOn ? (
                <Badge tone="success">{formatDateShort(simulation.goLiveOn)}</Badge>
              ) : (
                "—"
              )}
            </SwapValue>
          }
        />
      </dl>

      {invalid ? (
        <p id={`${FIELD_ID}-erreur`} className="text-xs text-danger">
          Saisissez une charge, par exemple 15 j ou 35 h.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {noRoom ? (
        <p role="status" className="text-xs text-warn">
          {simulation.capacityMinutesPerWeek > 0
            ? "Pas assez de place dans les deux prochaines années : réduisez la charge ou libérez de la capacité."
            : "Aucune capacité renseignée : indiquez la capacité des membres dans Équipe."}
        </p>
      ) : null}
      {simulation?.peak ? (
        <p
          className={cn("text-xs", simulation.peak.loadPercent >= 90 ? "text-warn" : "text-muted")}
        >
          Semaine la plus chargée avec ce projet : {simulation.peak.label} ·{" "}
          {simulation.peak.loadPercent} %.
        </p>
      ) : null}
      <p className="text-xs leading-[1.3] text-muted">
        À annoncer au prospect : la date tient compte des projets déjà signés.
      </p>
    </Tile>
  );
}

/** « Simuler un projet » : amène à la carte et y place le curseur. */
export function SimulateButton() {
  return (
    <Button
      variant="accent"
      onClick={() => {
        const field = document.getElementById(FIELD_ID);
        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      }}
    >
      Simuler un projet
    </Button>
  );
}
