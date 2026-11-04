import { and, asc, eq, gte, sql } from "drizzle-orm";
import { appointments, clientRequirements, projects } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export interface SuggestionProjectContext {
  name: string;
  stepLabel: string | null;
  dueOn: string | null;
  requirements: { label: string; received: boolean }[];
  nextAppointment: { title: string; at: Date } | null;
}

/**
 * Contexte minimal transmis au modèle : ni montant, ni nom d'associé, ni coordonnées.
 * Lecture directe et sans acteur : la préparation automatique d'une proposition n'a pas de
 * `ServiceContext` à présenter au service des projets. L'écran, lui, passe par `getProjectDetail`.
 */
export async function getSuggestionProjectContext(
  db: Database,
  projectId: string,
): Promise<SuggestionProjectContext | null> {
  const [project] = await db
    .select({
      name: projects.name,
      stepLabel: projects.clientStepLabel,
      dueOn: projects.dueOn,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return null;

  const [requirements, next] = await Promise.all([
    db
      .select({ label: clientRequirements.label, status: clientRequirements.status })
      .from(clientRequirements)
      .where(eq(clientRequirements.projectId, projectId))
      .orderBy(sql`${clientRequirements.dueOn} asc nulls last`, asc(clientRequirements.label)),
    db
      .select({ title: appointments.title, at: appointments.startsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.projectId, projectId),
          eq(appointments.status, "planned"),
          gte(appointments.startsAt, new Date()),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(1),
  ]);

  return {
    ...project,
    requirements: requirements.map((item) => ({
      label: item.label,
      received: item.status === "received",
    })),
    nextAppointment: next[0] ?? null,
  };
}
