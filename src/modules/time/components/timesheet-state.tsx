"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { RollingNumber } from "@/components/motion/rolling-number";
import type { Timesheet, TimesheetRow } from "../time.service";

/**
 * État partagé de la feuille de temps : le total de la ligne et celui de la semaine roulent dès la
 * sortie d'une cellule (note Mouvement de l'écran 18), avant la réponse du serveur. La vérité revient
 * avec la page revalidée, qui efface les valeurs optimistes.
 */
interface TimesheetState {
  sheet: Timesheet;
  cell: (row: TimesheetRow, day: string) => number;
  setCell: (row: TimesheetRow, day: string, minutes: number) => void;
  /** Annonce une sauvegarde : une revalidation ne doit pas écraser une cellule en cours. */
  track: (delta: 1 | -1) => void;
  rowTotal: (row: TimesheetRow) => number;
  weekTotal: number;
}

const TimesheetContext = createContext<TimesheetState | null>(null);

export function useTimesheet(): TimesheetState {
  const state = useContext(TimesheetContext);
  if (!state) throw new Error("useTimesheet exige un TimesheetProvider parent.");
  return state;
}

const cellKey = (row: TimesheetRow, day: string) => `${row.key}@${day}`;

export function TimesheetProvider({
  sheet,
  otherMinutes,
  children,
}: {
  sheet: Timesheet;
  /** Temps de la semaine hors de cette feuille : le reste de l'équipe. */
  otherMinutes: number;
  children: ReactNode;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(0);
  const [lastSheet, setLastSheet] = useState(sheet);

  if (sheet !== lastSheet && pending === 0) {
    setLastSheet(sheet);
    setOverrides({});
  }

  const setCell = useCallback((row: TimesheetRow, day: string, minutes: number) => {
    setOverrides((current) => ({ ...current, [cellKey(row, day)]: minutes }));
  }, []);

  const track = useCallback((delta: 1 | -1) => {
    setPending((current) => current + delta);
  }, []);

  const value = useMemo<TimesheetState>(() => {
    const cell = (row: TimesheetRow, day: string) =>
      overrides[cellKey(row, day)] ?? row.cells[day] ?? 0;
    const rowTotal = (row: TimesheetRow) => {
      let total = 0;
      for (const [day, minutes] of Object.entries(row.cells)) {
        total += overrides[cellKey(row, day)] ?? minutes;
      }
      for (const day of sheet.days) {
        if (row.cells[day] === undefined) total += overrides[cellKey(row, day)] ?? 0;
      }
      return total;
    };
    return {
      sheet,
      cell,
      setCell,
      track,
      rowTotal,
      weekTotal: otherMinutes + sheet.rows.reduce((sum, row) => sum + rowTotal(row), 0),
    };
  }, [overrides, otherMinutes, setCell, sheet, track]);

  return <TimesheetContext.Provider value={value}>{children}</TimesheetContext.Provider>;
}

/** Heures avec au plus deux décimales : `7,5 h`. Le total de la semaine roule à chaque saisie. */
export function HoursNumber({
  minutes,
  countUp = false,
  className,
}: {
  minutes: number;
  countUp?: boolean;
  className?: string;
}) {
  return (
    <RollingNumber
      value={minutes / 60}
      suffix=" h"
      format={{ maximumFractionDigits: 2 }}
      countUp={countUp}
      className={className}
    />
  );
}

export function WeekTotalValue() {
  const { weekTotal } = useTimesheet();
  return <HoursNumber minutes={weekTotal} countUp />;
}
