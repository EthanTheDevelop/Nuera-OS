"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { getServiceContext } from "@/server/auth/session";
import { logger } from "@/server/logger";
import type { LinkOption } from "./document.types";
import {
  archiveKnowledgeArticle,
  createKnowledgeArticle,
  listKnowledgeLinkOptions,
  restoreKnowledgeArticle,
  restoreKnowledgeArticleVersion,
  updateKnowledgeArticle,
} from "./knowledge.service";

function revalidateArticle(id?: string) {
  revalidatePath("/documents");
  revalidatePath("/documents/connaissances");
  if (id) revalidatePath(`/documents/connaissances/${id}`);
}

export async function loadArticleLinkOptionsAction(): Promise<{
  sites: LinkOption[];
  projects: LinkOption[];
} | null> {
  try {
    return await listKnowledgeLinkOptions(await getServiceContext());
  } catch (error) {
    logger.info("knowledge.link_options_refused", { error });
    return null;
  }
}

/** Crée l'article, ou le modifie si le formulaire porte son identifiant. */
export async function saveArticleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const article = values.id
      ? await updateKnowledgeArticle(ctx, values as never)
      : await createKnowledgeArticle(ctx, values as never);
    revalidateArticle(article.id);
    return { status: "success", message: values.id ? "Article modifié." : "Article créé." };
  } catch (error) {
    return toActionErrorState(error, { action: "knowledge.save", values });
  }
}

export async function restoreArticleVersionAction(
  id: string,
  version: number,
): Promise<ActionState> {
  try {
    await restoreKnowledgeArticleVersion(await getServiceContext(), { id, version });
    revalidateArticle(id);
    return { status: "success", message: `Contenu de la version ${version} repris.` };
  } catch (error) {
    return toActionErrorState(error, { action: "knowledge.restore_version" });
  }
}

export async function archiveArticleAction(id: string): Promise<ActionState> {
  try {
    await archiveKnowledgeArticle(await getServiceContext(), id);
    revalidateArticle(id);
    return { status: "success", message: "Article archivé." };
  } catch (error) {
    return toActionErrorState(error, { action: "knowledge.archive" });
  }
}

export async function restoreArticleAction(id: string): Promise<ActionState> {
  try {
    await restoreKnowledgeArticle(await getServiceContext(), id);
    revalidateArticle(id);
    return { status: "success", message: "Article restauré." };
  } catch (error) {
    return toActionErrorState(error, { action: "knowledge.restore" });
  }
}
