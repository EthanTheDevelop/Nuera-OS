import { initialsOf } from "@/components/ui/avatar";
import type { ProjectStatus } from "@/lib/domain-enums";
import { formatDateShort, formatNumber, MINUTES_PER_DAY } from "@/lib/format";
import { formatCentsHT } from "@/lib/money";
import type { ProjectProgress } from "../project.rules";
import type { ProjectDetail, ProjectsOverview } from "../project.service";

/** Textes calculés des écrans 08 et 17. Sans état : utilisable côté serveur comme côté client. */

const days = (minutes: number) => formatNumber(minutes / MINUTES_PER_DAY, 1);

/** Numéro de page lu dans l'adresse : tout ce qui n'est pas un entier positif vaut 1. */
export function pageNumber(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

/** `5 / 12 j`, ou `3 / 5 tâches` faute d'estimation. */
export function progressLabel(progress: ProjectProgress): string {
  if (progress.unit === "tasks") {
    return `${progress.done} / ${progress.total} tâche${progress.total > 1 ? "s" : ""}`;
  }
  return `${days(progress.done)} / ${days(progress.total)} j`;
}

/** `EN · NZ`, deux personnes au plus : la colonne ÉQUIPE fait 80 px. */
export function teamInitials(names: readonly string[]): string {
  if (names.length === 0) return "—";
  if (names.length > 2) return `${initialsOf(names[0] ?? "")} +${names.length - 1}`;
  return names.map(initialsOf).join(" · ");
}

/** Sous-titre de 08 : `4 projets · 1 en retard · charge 14 / 18 journées`. */
export function projectsSubtitle(overview: ProjectsOverview, assignedOnly: boolean): string {
  const count = `${overview.open} projet${overview.open > 1 ? "s" : ""}`;
  const parts = [assignedOnly ? `${count} en cours pour vous` : `${count} en cours`];
  if (overview.late > 0) parts.push(`${overview.late} en retard`);
  const week = overview.load?.weeks[0];
  if (week && week.capacityMinutes > 0) {
    parts.push(`charge ${days(week.plannedMinutes)} / ${days(week.capacityMinutes)} journées`);
  }
  return parts.join(" · ");
}

/** Sous-titre de 17 : `Projet P-2026-007 · 7 800 € HT · Ethan et Nezar · mise en ligne prévue le 18 nov.` */
export function projectSubtitle(project: ProjectDetail): string {
  const names = project.team.map((member) => member.fullName.split(" ")[0] ?? member.fullName);
  const team =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}` : names[0];
  const parts = [`Projet ${project.number}`];
  if (project.budgetCents !== null) parts.push(formatCentsHT(project.budgetCents));
  if (team) parts.push(team);
  if (project.deliveredOn) parts.push(`mis en ligne le ${formatDateShort(project.deliveredOn)}`);
  else if (project.dueOn) parts.push(`mise en ligne prévue le ${formatDateShort(project.dueOn)}`);
  return parts.join(" · ");
}

/** Libellé de l'action qui mène à un statut. */
export const TRANSITION_LABELS: Record<ProjectStatus, string> = {
  preparation: "Repasser en préparation",
  active: "Passer en cours",
  blocked: "Marquer comme bloqué",
  in_validation: "Passer en validation",
  delivered: "Mettre en ligne",
  closed: "Clôturer le projet",
};
