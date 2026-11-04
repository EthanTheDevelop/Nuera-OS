"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { getServiceContext } from "@/server/auth/session";
import { formDataToObject, toActionErrorState } from "@/server/actions";
import { recordManualBackup } from "./backup.service";
import { refreshSiteDeployments, triggerDeployment } from "./deployment.service";
import { checkDomainTls, createDomain, deleteDomain, updateDomain } from "./domain.service";
import {
  changeSiteStatus,
  createSite,
  getCompanyLinkOptions,
  saveEnvironment,
  updateSite,
  type CompanyLinkOptions,
} from "./site.service";
import { syncSitesNow } from "./sync.service";

/** Adaptateurs : session → service → revalidation. Aucune règle métier ici. */

const LIST_PATH = "/sites";
const DOMAINS_PATH = "/sites/domaines";

function refresh(siteId?: string | null): void {
  revalidatePath(LIST_PATH);
  revalidatePath(DOMAINS_PATH);
  if (siteId) revalidatePath(`${LIST_PATH}/${siteId}`);
}

export async function createSiteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  let id: string;
  try {
    const ctx = await getServiceContext();
    ({ id } = await createSite(ctx, values));
    refresh();
  } catch (error) {
    return toActionErrorState(error, { action: "sites.create", values });
  }
  redirect(`${LIST_PATH}/${id}`);
}

export async function updateSiteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const site = await updateSite(ctx, values);
    refresh(site.id);
    return { status: "success", message: "Site enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.update", values });
  }
}

export async function changeSiteStatusAction(id: string, status: string): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await changeSiteStatus(ctx, { id, status });
    refresh(id);
    return { status: "success", message: "Statut du site modifié." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.change_status" });
  }
}

export async function saveEnvironmentAction(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    await saveEnvironment(ctx, values);
    refresh(values.siteId);
    return { status: "success", message: "Environnement enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.save_environment", values });
  }
}

export async function triggerDeploymentAction(
  siteId: string,
  environmentId: string,
  confirmation: string,
): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await triggerDeployment(ctx, { environmentId, confirmation });
    refresh(siteId);
    return { status: "success", message: "Déploiement demandé à Coolify." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.trigger_deployment" });
  }
}

/** Suivi d'un déploiement en cours. N'échoue jamais bruyamment : l'écran garde l'état connu. */
export async function refreshDeploymentsAction(
  siteId: string,
): Promise<{ active: boolean; changed: boolean }> {
  try {
    const ctx = await getServiceContext();
    const result = await refreshSiteDeployments(ctx, siteId);
    if (result.changed) refresh(siteId);
    return result;
  } catch (error) {
    toActionErrorState(error, { action: "sites.refresh_deployments" });
    return { active: false, changed: false };
  }
}

export async function createDomainAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const domain = await createDomain(ctx, values);
    refresh(domain.siteId);
    return { status: "success", message: "Domaine ajouté." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.create_domain", values });
  }
}

export async function updateDomainAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    const domain = await updateDomain(ctx, values);
    refresh(domain.siteId);
    return { status: "success", message: "Domaine enregistré." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.update_domain", values });
  }
}

export async function deleteDomainAction(id: string, siteId: string | null): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    await deleteDomain(ctx, { id });
    refresh(siteId);
    return { status: "success", message: "Domaine retiré." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.delete_domain" });
  }
}

export async function checkDomainTlsAction(id: string): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    const { domain, message } = await checkDomainTls(ctx, { id });
    refresh(domain.siteId);
    if (message) return { status: "error", message };
    return { status: "success", message: `Certificat de ${domain.name} contrôlé.` };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.check_tls" });
  }
}

export async function recordBackupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  try {
    const ctx = await getServiceContext();
    await recordManualBackup(ctx, values);
    refresh(values.siteId);
    return { status: "success", message: "Sauvegarde enregistrée." };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.record_backup", values });
  }
}

export async function syncNowAction(service: "coolify" | "uptime_kuma"): Promise<ActionState> {
  try {
    const ctx = await getServiceContext();
    const { items, failures } = await syncSitesNow(ctx, { service });
    revalidatePath(LIST_PATH, "layout");
    if (failures > 0) {
      return {
        status: "error",
        message: `Synchronisation partielle : ${items} élément${items > 1 ? "s" : ""} relu${items > 1 ? "s" : ""}, ${failures} en échec.`,
      };
    }
    return {
      status: "success",
      message: `Synchronisation terminée : ${items} élément${items > 1 ? "s" : ""} relu${items > 1 ? "s" : ""}.`,
    };
  } catch (error) {
    return toActionErrorState(error, { action: "sites.sync" });
  }
}

/** Projets et contrats d'un client, pour le formulaire. Rien si le client est illisible. */
export async function loadCompanyLinksAction(companyId: string): Promise<CompanyLinkOptions> {
  try {
    const ctx = await getServiceContext();
    return await getCompanyLinkOptions(ctx, companyId);
  } catch (error) {
    toActionErrorState(error, { action: "sites.load_company_links" });
    return { projects: [], contracts: [], sites: [] };
  }
}
