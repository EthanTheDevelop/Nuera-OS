import type { ActionState } from "@/lib/action-state";
import type { DuplicateInfo } from "./crm.shared";

/**
 * État des formulaires du CRM : `ActionState`, plus la fiche existante en cas de doublon (l'écran
 * propose alors de la restaurer ou de fusionner, jamais de recréer) et l'identifiant créé.
 */
export type CrmActionState = ActionState & {
  duplicate?: DuplicateInfo;
  id?: string;
};

export const IDLE_CRM_STATE: CrmActionState = { status: "idle" };
