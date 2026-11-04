import "server-only";
import { getEnv } from "@/server/config/env";
import { CoolifyClient, type CoolifyGateway } from "./coolify.client";

export type {
  CoolifyApplication,
  CoolifyBackupConfig,
  CoolifyBackupExecution,
  CoolifyDeployment,
  CoolifyGateway,
  CoolifyResource,
} from "./coolify.client";
export { CoolifyClient } from "./coolify.client";

/** Passerelle configurée par l'environnement. Sans URL ni jeton : `isConfigured` vaut `false`. */
export function getCoolifyGateway(): CoolifyGateway {
  const { COOLIFY_API_URL, COOLIFY_API_TOKEN } = getEnv();
  return new CoolifyClient(
    COOLIFY_API_URL && COOLIFY_API_TOKEN
      ? { baseUrl: COOLIFY_API_URL, token: COOLIFY_API_TOKEN }
      : null,
  );
}
