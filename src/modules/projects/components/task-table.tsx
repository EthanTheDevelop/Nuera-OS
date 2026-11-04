import Link from "next/link";
import { EmptyState } from "@/components/states/states";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { firstNameOf } from "../project.rules";
import type { TaskListRow } from "../task.service";
import { TaskStatusControl } from "./task-controls";

/**
 * Tâches de l'écran 17, paginées côté serveur. Le lien de ligne ne remonte pas en haut de page : la
 * fenêtre s'ouvre au-dessus de ce qu'on regardait (`DataTable.rowHref` ne le permet pas).
 */
export function TaskTable({
  tasks,
  total,
  page,
  pageSize,
  path,
  searchParams,
  hrefOf,
  today,
  filtered,
}: {
  tasks: readonly TaskListRow[];
  total: number;
  page: number;
  pageSize: number;
  path: string;
  searchParams: Record<string, string | undefined>;
  hrefOf: (taskId: string) => string;
  today: string;
  filtered: boolean;
}) {
  const columns: DataTableColumn<TaskListRow>[] = [
    {
      key: "task",
      header: "Tâche",
      primary: true,
      cell: (task) => (
        <Link
          href={hrefOf(task.id)}
          scroll={false}
          data-row-link
          className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
        >
          <span className="block truncate text-row-primary text-ink">{task.title}</span>
          {task.subtasks ? (
            <span className="block truncate text-row-secondary text-muted">
              {task.subtasks.done} / {task.subtasks.total} sous-tâche
              {task.subtasks.total > 1 ? "s" : ""}
            </span>
          ) : null}
        </Link>
      ),
    },
    {
      key: "assignee",
      header: "Responsable",
      width: 126,
      cell: (task) =>
        task.assigneeName ? (
          <span className="flex min-w-0 items-center gap-2 text-text">
            <Avatar name={task.assigneeName} size={22} />
            <span className="truncate">{firstNameOf(task.assigneeName)}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "due",
      header: "Échéance",
      width: 116,
      cell: (task) => {
        const late = task.dueOn !== null && task.dueOn < today && task.status !== "done";
        return (
          <span className={cn(late && "text-danger")}>
            {task.dueOn ? formatDateShort(task.dueOn) : "—"}
          </span>
        );
      },
    },
    {
      key: "dependencies",
      header: "Dépend de",
      width: 136,
      hideWhenCollapsed: true,
      cell: (task) => {
        const [first] = task.dependsOn;
        if (!first) return "—";
        return (
          <span
            className="block truncate"
            title={task.dependsOn.map((dependency) => dependency.title).join(", ")}
          >
            {first.title}
            {task.dependsOn.length > 1 ? ` +${task.dependsOn.length - 1}` : ""}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Statut",
      width: 150,
      cell: (task) => (
        <span className="relative z-10">
          <TaskStatusControl
            taskId={task.id}
            title={task.title}
            status={task.status}
            nextStatuses={task.nextStatuses}
          />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Tâches du projet"
      columns={columns}
      rows={tasks}
      rowKey={(task) => task.id}
      query={{ pathname: path, searchParams }}
      pagination={total > pageSize ? { page, pageSize, total } : undefined}
      className="[&_tbody_tr:hover]:bg-surface-raised/60"
      empty={
        <EmptyState
          compact
          icon="check"
          title={filtered ? "Aucune tâche ne correspond" : "Aucune tâche pour l’instant"}
          description={
            filtered
              ? "Essayez un autre terme ou un autre statut."
              : "Les tâches du projet apparaissent ici dès la première ajoutée."
          }
        />
      }
    />
  );
}
