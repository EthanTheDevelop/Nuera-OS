"use client";

import { useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/states/states";
import { CellIdentity, DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateLong } from "@/lib/format";
import { formatCellDuration, parseCellDuration } from "../time-format";
import { saveTimesheetCellAction } from "../time.actions";
import type { TimesheetRow } from "../time.service";
import { HoursNumber, useTimesheet } from "./timesheet-state";

const DAY_LABELS = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];

function dayHeader(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return DAY_LABELS[weekday === 0 ? 6 : weekday - 1] ?? day;
}

function TimesheetCell({ row, day }: { row: TimesheetRow; day: string }) {
  const { sheet, cell, setCell, track } = useTimesheet();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const cancelled = useRef(false);
  const minutes = cell(row, day);
  const future = day > sheet.today;
  const shown = formatCellDuration(minutes);

  if (!sheet.editable) {
    return <span className="tabular">{shown || "—"}</span>;
  }

  function commit(text: string) {
    const next = parseCellDuration(text);
    setDraft(null);
    if (next === null) {
      toast({ message: "Durée non reconnue : essayez 3, 1h30 ou 45 min.", tone: "danger" });
      return;
    }
    if (next === minutes) return;

    const previous = minutes;
    setCell(row, day, next);
    track(1);
    startSaving(async () => {
      const result = await saveTimesheetCellAction({
        memberId: sheet.member?.id,
        workOn: day,
        minutes: next,
        category: row.category,
        billable: row.billable,
        projectId: row.projectId ?? undefined,
        taskId: row.taskId ?? undefined,
        ticketId: row.ticketId ?? undefined,
        contractId: row.contractId ?? undefined,
      });
      if (result.status === "error") {
        setCell(row, day, previous);
        toast({ message: result.message, tone: "danger" });
      }
      track(-1);
    });
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      disabled={future}
      value={draft ?? shown}
      placeholder="—"
      aria-label={`${row.label}${row.detail ? `, ${row.detail}` : ""}, ${formatDateLong(day)}`}
      aria-busy={saving || undefined}
      title={future ? "Le temps passé ne se saisit pas à l'avance." : undefined}
      onFocus={(event) => {
        cancelled.current = false;
        setDraft(shown);
        event.target.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (cancelled.current) {
          setDraft(null);
          return;
        }
        commit(event.target.value);
      }}
      className={cn(
        "tabular -mx-1.5 h-8 w-[calc(100%+12px)] max-w-[84px] rounded-sm border border-transparent bg-transparent px-1.5 text-cell text-muted outline-none",
        "transition-[border-color,opacity] duration-(--dur-fast) placeholder:text-muted",
        "hover:border-border focus:border-text focus:bg-surface focus:text-text",
        "disabled:cursor-not-allowed disabled:hover:border-transparent",
        "pointer-coarse:h-11",
        saving && "opacity-60",
      )}
    />
  );
}

function RowTotal({ row }: { row: TimesheetRow }) {
  const { rowTotal } = useTimesheet();
  const total = rowTotal(row);
  return total > 0 ? <HoursNumber minutes={total} /> : <span className="tabular">—</span>;
}

/** Feuille de temps (Figma 100:5349) : PROJET, un jour par colonne, TOTAL. */
export function TimesheetTable() {
  const { sheet } = useTimesheet();

  const columns: DataTableColumn<TimesheetRow>[] = [
    {
      key: "project",
      header: "PROJET",
      primary: true,
      cell: (row) => <CellIdentity title={row.label} subtitle={row.detail} />,
    },
    ...sheet.days.map((day): DataTableColumn<TimesheetRow> => ({
      key: day,
      header: dayHeader(day),
      // Largeur de colonne, espacement compris : 70 + 16 de la maquette.
      width: 86,
      cell: (row) => <TimesheetCell row={row} day={day} />,
    })),
    { key: "total", header: "TOTAL", width: 96, cell: (row) => <RowTotal row={row} /> },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sheet.rows}
      rowKey={(row) => row.key}
      caption={`Feuille de temps, ${sheet.week.label.toLocaleLowerCase("fr-FR")}`}
      empty={
        <EmptyState
          compact
          icon="clock"
          title="Aucun temps sur cette semaine"
          description={
            sheet.editable
              ? "Aucun travail ouvert ne vous est attribué : « Saisir du temps » reste possible."
              : "Rien n'a été saisi pour ce membre."
          }
        />
      }
    />
  );
}
