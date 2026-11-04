"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import type { PhaseStatus, ProjectStatus, ReviewDecision, TaskStatus } from "@/lib/domain-enums";
import { getDocusealGateway } from "@/integrations/docuseal";
import { convertChangeRequestToQuote } from "./change-request.conversion";
import {
  acceptChangeRequest,
  addHandoverItem,
  changePhaseStatus,
  createChangeRequest,
  createDeliverable,
  createPhase,
  createRequirement,
  markRequirementReceived,
  raiseBlocker,
  recordDeliverableReview,
  refuseChangeRequest,
  reopenRequirement,
  resolveBlocker,
  startDeliverableVersion,
  submitDeliverable,
  toggleHandoverItem,
  updateBlocker,
  updateChangeRequest,
  updateDeliverable,
  updatePhase,
  updateRequirement,
} from "./production.service";
import {
  addProjectMember,
  archiveProject,
  changeProjectStatus,
  createProject,
  goLiveProject,
  removeProjectMember,
  restoreProject,
  updateProject,
} from "./project.service";
import {
  addTaskComment,
  addTaskDependency,
  archiveTask,
  changeTaskStatus,
  createTask,
  removeTaskDependency,
  updateTask,
} from "./task.service";

/** Adaptateurs : session, service, revalidation. Toute règle reste dans les services. */

function refresh(): void {
  revalidatePath("/projets", "layout");
}

async function form(
  action: string,
  formData: FormData,
  run: (ctx: ServiceContext, values: Record<string, string>) => Promise<string>,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const message = await run(ctx, values);
    refresh();
    return { status: "success", message };
  } catch (error) {
    return toActionErrorState(error, { action, values });
  }
}

async function command(
  action: string,
  run: (ctx: ServiceContext) => Promise<string>,
): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    const message = await run(ctx);
    refresh();
    return { status: "success", message };
  } catch (error) {
    return toActionErrorState(error, { action });
  }
}

// --- Projets -----------------------------------------------------------------------------------

export async function createProjectAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let projectId: string | undefined;
  const state = await form("projects.create", formData, async (ctx, values) => {
    const project = await createProject(ctx, values as never);
    projectId = project.id;
    return "Projet créé.";
  });
  if (state.status === "success" && projectId) redirect(`/projets/${projectId}`);
  return state;
}

export async function updateProjectAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("projects.update", formData, async (ctx, values) => {
    await updateProject(ctx, values as never);
    return "Projet modifié.";
  });
}

export async function changeProjectStatusAction(
  projectId: string,
  status: ProjectStatus,
): Promise<ActionState> {
  return command("projects.status", async (ctx) => {
    await changeProjectStatus(ctx, { projectId, status });
    return "Statut du projet modifié.";
  });
}

export async function goLiveProjectAction(
  projectId: string,
  siteId: string | null,
): Promise<ActionState> {
  return command("projects.go_live", async (ctx) => {
    await goLiveProject(ctx, { projectId, siteId });
    return "Projet livré.";
  });
}

export async function archiveProjectAction(projectId: string): Promise<ActionState> {
  return command("projects.archive", async (ctx) => {
    await archiveProject(ctx, projectId);
    return "Projet archivé.";
  });
}

export async function restoreProjectAction(projectId: string): Promise<ActionState> {
  return command("projects.restore", async (ctx) => {
    await restoreProject(ctx, projectId);
    return "Projet restauré.";
  });
}

export async function addProjectMemberAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("projects.member_add", formData, async (ctx, values) => {
    await addProjectMember(ctx, values as never);
    return "Intervenant ajouté.";
  });
}

export async function removeProjectMemberAction(
  projectId: string,
  memberId: string,
): Promise<ActionState> {
  return command("projects.member_remove", async (ctx) => {
    await removeProjectMember(ctx, { projectId, memberId });
    return "Intervenant retiré.";
  });
}

// --- Jalons ------------------------------------------------------------------------------------

export async function createPhaseAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("phases.create", formData, async (ctx, values) => {
    await createPhase(ctx, values as never);
    return "Jalon ajouté.";
  });
}

export async function updatePhaseAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("phases.update", formData, async (ctx, values) => {
    await updatePhase(ctx, values as never);
    return "Jalon modifié.";
  });
}

export async function changePhaseStatusAction(
  phaseId: string,
  status: PhaseStatus,
): Promise<ActionState> {
  return command("phases.status", async (ctx) => {
    await changePhaseStatus(ctx, { phaseId, status });
    return "Jalon mis à jour.";
  });
}

// --- Tâches ------------------------------------------------------------------------------------

export async function createTaskAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("tasks.create", formData, async (ctx, values) => {
    await createTask(ctx, values as never);
    return "Tâche ajoutée.";
  });
}

export async function updateTaskAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("tasks.update", formData, async (ctx, values) => {
    await updateTask(ctx, values as never);
    return "Tâche modifiée.";
  });
}

export async function changeTaskStatusAction(
  taskId: string,
  status: TaskStatus,
): Promise<ActionState> {
  return command("tasks.status", async (ctx) => {
    await changeTaskStatus(ctx, { taskId, status });
    return "Statut de la tâche modifié.";
  });
}

export async function archiveTaskAction(taskId: string): Promise<ActionState> {
  return command("tasks.archive", async (ctx) => {
    await archiveTask(ctx, taskId);
    return "Tâche archivée.";
  });
}

export async function addTaskDependencyAction(
  taskId: string,
  dependsOnTaskId: string,
): Promise<ActionState> {
  return command("tasks.dependency_add", async (ctx) => {
    await addTaskDependency(ctx, { taskId, dependsOnTaskId });
    return "Dépendance ajoutée.";
  });
}

export async function removeTaskDependencyAction(
  taskId: string,
  dependsOnTaskId: string,
): Promise<ActionState> {
  return command("tasks.dependency_remove", async (ctx) => {
    await removeTaskDependency(ctx, { taskId, dependsOnTaskId });
    return "Dépendance retirée.";
  });
}

export async function addTaskCommentAction(input: {
  taskId: string;
  body: string;
  mentions: string[];
  documentId: string | null;
  parentId?: string | null;
  clientRequestId?: string | null;
}): Promise<ActionState> {
  return command("tasks.comment", async (ctx) => {
    await addTaskComment(ctx, input);
    return "Commentaire ajouté.";
  });
}

// --- Livrables ---------------------------------------------------------------------------------

export async function createDeliverableAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("deliverables.create", formData, async (ctx, values) => {
    await createDeliverable(ctx, values);
    return "Livrable ajouté.";
  });
}

export async function updateDeliverableAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("deliverables.update", formData, async (ctx, values) => {
    await updateDeliverable(ctx, values);
    return "Livrable modifié.";
  });
}

export async function submitDeliverableAction(deliverableId: string): Promise<ActionState> {
  return command("deliverables.submit", async (ctx) => {
    await submitDeliverable(ctx, { deliverableId });
    return "Livrable soumis à validation.";
  });
}

export async function startDeliverableVersionAction(deliverableId: string): Promise<ActionState> {
  return command("deliverables.version", async (ctx) => {
    await startDeliverableVersion(ctx, { deliverableId });
    return "Nouvelle version en brouillon.";
  });
}

export async function reviewDeliverableAction(
  deliverableId: string,
  decision: ReviewDecision,
  comment: string,
): Promise<ActionState> {
  return command("deliverables.review", async (ctx) => {
    const { outOfScopeChangeRequest } = await recordDeliverableReview(ctx, {
      deliverableId,
      decision,
      comment,
    });
    if (outOfScopeChangeRequest) {
      return "Retours enregistrés. Tours inclus dépassés : une demande de changement est ouverte.";
    }
    return decision === "validated" ? "Livrable validé." : "Retours enregistrés.";
  });
}

// --- Contenus attendus -------------------------------------------------------------------------

export async function createRequirementAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("requirements.create", formData, async (ctx, values) => {
    await createRequirement(ctx, values as never);
    return "Contenu attendu ajouté.";
  });
}

export async function updateRequirementAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("requirements.update", formData, async (ctx, values) => {
    await updateRequirement(ctx, values as never);
    return "Contenu attendu modifié.";
  });
}

export async function markRequirementReceivedAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("requirements.received", formData, async (ctx, values) => {
    await markRequirementReceived(ctx, values as never);
    return "Contenu marqué comme reçu.";
  });
}

export async function reopenRequirementAction(requirementId: string): Promise<ActionState> {
  return command("requirements.reopen", async (ctx) => {
    await reopenRequirement(ctx, { requirementId });
    return "Contenu de nouveau attendu.";
  });
}

// --- Blocages ----------------------------------------------------------------------------------

export async function raiseBlockerAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("blockers.raise", formData, async (ctx, values) => {
    await raiseBlocker(ctx, values as never);
    return "Blocage signalé.";
  });
}

export async function updateBlockerAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("blockers.update", formData, async (ctx, values) => {
    await updateBlocker(ctx, values as never);
    return "Blocage modifié.";
  });
}

export async function resolveBlockerAction(blockerId: string): Promise<ActionState> {
  return command("blockers.resolve", async (ctx) => {
    await resolveBlocker(ctx, { blockerId });
    return "Blocage levé.";
  });
}

// --- Demandes de changement --------------------------------------------------------------------

export async function createChangeRequestAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("change_requests.create", formData, async (ctx, values) => {
    await createChangeRequest(ctx, values as never);
    return "Demande de changement créée.";
  });
}

export async function updateChangeRequestAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("change_requests.update", formData, async (ctx, values) => {
    await updateChangeRequest(ctx, values);
    return "Demande de changement modifiée.";
  });
}

export async function acceptChangeRequestAction(changeRequestId: string): Promise<ActionState> {
  return command("change_requests.accept", async (ctx) => {
    await acceptChangeRequest(ctx, { changeRequestId });
    return "Travaux acceptés : une tâche est ajoutée au projet.";
  });
}

export async function refuseChangeRequestAction(changeRequestId: string): Promise<ActionState> {
  return command("change_requests.refuse", async (ctx) => {
    await refuseChangeRequest(ctx, { changeRequestId });
    return "Demande de changement refusée.";
  });
}

/** Le devis créé s'ouvre dans son éditeur : il reste à le compléter avant l'envoi. */
export async function convertChangeRequestAction(changeRequestId: string): Promise<ActionState> {
  let quoteId: string | undefined;
  const state = await command("change_requests.convert", async (ctx) => {
    ({ quoteId } = await convertChangeRequestToQuote(
      ctx,
      { changeRequestId },
      { docuseal: getDocusealGateway() },
    ));
    revalidatePath("/devis", "layout");
    return "Devis créé.";
  });
  if (state.status === "success" && quoteId) redirect(`/devis/${quoteId}/modifier`);
  return state;
}

// --- Passation ---------------------------------------------------------------------------------

export async function addHandoverItemAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return form("handover.add", formData, async (ctx, values) => {
    await addHandoverItem(ctx, values as never);
    return "Point de passation ajouté.";
  });
}

export async function toggleHandoverItemAction(
  itemId: string,
  done: boolean,
): Promise<ActionState> {
  return command("handover.toggle", async (ctx) => {
    await toggleHandoverItem(ctx, { itemId, done });
    return done ? "Point de passation validé." : "Point de passation rouvert.";
  });
}
