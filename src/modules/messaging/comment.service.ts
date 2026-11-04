import type { ServiceContext } from "@/server/context";

/**
 * Commentaires et mentions sur une tâche, un projet, un ticket ou un livrable (écran M4).
 * Contrat partagé : implémentation à la charge du lot Messages. Le contrôle d'accès à l'objet
 * commenté reste à l'appelant, qui vérifie ses droits avant d'appeler ce service.
 */
export type CommentEntityType = "task" | "project" | "ticket" | "deliverable";

export interface CommentView {
  id: string;
  parentId: string | null;
  authorUserId: string;
  authorName: string;
  body: string;
  mentions: string[];
  documentId: string | null;
  createdAt: Date;
}

export interface AddCommentInput {
  entityType: CommentEntityType;
  entityId: string;
  companyId: string;
  body: string;
  mentions?: string[];
  parentId?: string;
  documentId?: string;
  /** Lien vers l'objet commenté, repris dans la notification des personnes mentionnées. */
  href: string;
}

export async function addComment(
  _ctx: ServiceContext,
  _input: AddCommentInput,
): Promise<CommentView> {
  throw new Error("addComment : à implémenter par le lot Messages.");
}

export async function listComments(
  _ctx: ServiceContext,
  _target: { entityType: CommentEntityType; entityId: string },
): Promise<CommentView[]> {
  throw new Error("listComments : à implémenter par le lot Messages.");
}
