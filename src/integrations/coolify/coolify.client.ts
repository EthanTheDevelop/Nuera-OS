import "server-only";
import { z } from "@/lib/zod";
import { IntegrationError, ServiceUnavailableError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Adaptateur de l'API officielle de Coolify (`/api/v1`, jeton Bearer), lue dans son `openapi.json`
 * et ses contrôleurs. Écarts entre la spécification et le code, relevés dans les sources :
 * - `GET /deployments/applications/{uuid}` répond `{ count, deployments }` et non un tableau ;
 * - les sauvegardes n'existent que par base de données, jamais par application.
 *
 * Le journal ne contient jamais le jeton. Seules les lectures sont rejouées : un déploiement
 * refusé au réseau ne doit pas partir deux fois.
 */
const SERVICE = "coolify";
const NOT_CONFIGURED =
  "Connexion requise : l'URL ou le jeton d'API de Coolify n'est pas renseigné.";

export interface CoolifyConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  fetch?: typeof fetch;
}

const applicationSchema = z.object({
  uuid: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  fqdn: z.string().nullish(),
  git_repository: z.string().nullish(),
  git_branch: z.string().nullish(),
  environment_id: z.number().nullish(),
});
export type CoolifyApplication = z.infer<typeof applicationSchema>;

const deploymentSchema = z.object({
  deployment_uuid: z.string(),
  status: z.string().nullish(),
  commit: z.string().nullish(),
  commit_message: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  is_webhook: z.boolean().nullish(),
  is_api: z.boolean().nullish(),
});
export type CoolifyDeployment = z.infer<typeof deploymentSchema>;

const deploymentListSchema = z.union([
  z.array(deploymentSchema),
  z.object({ deployments: z.array(deploymentSchema) }).transform((body) => body.deployments),
]);

const deployResponseSchema = z.object({
  deployments: z.array(
    z.object({
      message: z.string().nullish(),
      resource_uuid: z.string().nullish(),
      deployment_uuid: z.string().nullish(),
    }),
  ),
});

const resourceSchema = z.object({
  uuid: z.string(),
  type: z.string().nullish(),
  status: z.string().nullish(),
  environment_id: z.number().nullish(),
});
export type CoolifyResource = z.infer<typeof resourceSchema>;

const backupConfigSchema = z.object({
  uuid: z.string(),
  enabled: z.boolean().nullish(),
  save_s3: z.boolean().nullish(),
});
export type CoolifyBackupConfig = z.infer<typeof backupConfigSchema>;

const backupExecutionSchema = z.object({
  uuid: z.string(),
  status: z.string().nullish(),
  size: z.coerce.number().nullish(),
  created_at: z.string().nullish(),
  finished_at: z.string().nullish(),
  s3_uploaded: z.boolean().nullish(),
});
export type CoolifyBackupExecution = z.infer<typeof backupExecutionSchema>;

const backupExecutionListSchema = z.union([
  z.array(backupExecutionSchema),
  z.object({ executions: z.array(backupExecutionSchema) }).transform((body) => body.executions),
]);

/** Port utilisé par les services : les tests branchent le vrai client sur un serveur HTTP local. */
export interface CoolifyGateway {
  readonly isConfigured: boolean;
  /** Console web, sans chemin. `null` si non configuré. */
  readonly consoleUrl: string | null;
  /** Lien vers la page du projet dans la console, si l'URL et le projet sont connus. */
  projectUrl(projectUuid: string | null | undefined): string | null;
  listApplications(): Promise<CoolifyApplication[]>;
  getApplication(uuid: string): Promise<CoolifyApplication | null>;
  listApplicationDeployments(
    uuid: string,
    options?: { take?: number },
  ): Promise<CoolifyDeployment[]>;
  getDeployment(uuid: string): Promise<CoolifyDeployment | null>;
  deployApplication(uuid: string): Promise<{ deploymentUuid: string; message: string | null }>;
  /** Applications, services et bases d'un coup, chacun avec son `environment_id`. */
  listResources(): Promise<CoolifyResource[]>;
  listDatabaseBackups(databaseUuid: string): Promise<CoolifyBackupConfig[]>;
  listBackupExecutions(databaseUuid: string, backupUuid: string): Promise<CoolifyBackupExecution[]>;
}

export class CoolifyClient implements CoolifyGateway {
  readonly isConfigured: boolean;
  readonly consoleUrl: string | null;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  /** `null` : non configuré, chaque appel lève « connexion requise ». */
  constructor(config: CoolifyConfig | null) {
    this.isConfigured = config !== null;
    this.consoleUrl = config ? config.baseUrl.replace(/\/+$/, "") : null;
    this.token = config?.token ?? "";
    this.timeoutMs = config?.timeoutMs ?? 10_000;
    this.maxRetries = config?.maxRetries ?? 2;
    this.baseDelayMs = config?.baseDelayMs ?? 300;
    this.fetchImpl = config?.fetch ?? fetch;
  }

  projectUrl(projectUuid: string | null | undefined): string | null {
    if (!this.consoleUrl || !projectUuid) return null;
    return `${this.consoleUrl}/project/${encodeURIComponent(projectUuid)}`;
  }

  async listApplications(): Promise<CoolifyApplication[]> {
    return this.read("/applications", z.array(applicationSchema));
  }

  async getApplication(uuid: string): Promise<CoolifyApplication | null> {
    return this.readOrNull(`/applications/${encodeURIComponent(uuid)}`, applicationSchema);
  }

  async listApplicationDeployments(
    uuid: string,
    { take = 10 }: { take?: number } = {},
  ): Promise<CoolifyDeployment[]> {
    const path = `/deployments/applications/${encodeURIComponent(uuid)}?skip=0&take=${take}`;
    return (await this.readOrNull(path, deploymentListSchema)) ?? [];
  }

  async getDeployment(uuid: string): Promise<CoolifyDeployment | null> {
    return this.readOrNull(`/deployments/${encodeURIComponent(uuid)}`, deploymentSchema);
  }

  async deployApplication(
    uuid: string,
  ): Promise<{ deploymentUuid: string; message: string | null }> {
    const params = new URLSearchParams({ uuid, force: "false" });
    const { body, status } = await this.send("POST", `/deploy?${params.toString()}`, 0);
    if (status === 404) {
      throw new IntegrationError(SERVICE, "Coolify ne connaît pas cette application.", { status });
    }
    const parsed = deployResponseSchema.safeParse(body);
    const deployment = parsed.success
      ? parsed.data.deployments.find((entry) => entry.deployment_uuid)
      : undefined;
    if (!deployment?.deployment_uuid) {
      throw new IntegrationError(SERVICE, "Coolify n'a pas mis ce déploiement en file.");
    }
    return { deploymentUuid: deployment.deployment_uuid, message: deployment.message ?? null };
  }

  async listResources(): Promise<CoolifyResource[]> {
    return this.read("/resources", z.array(resourceSchema));
  }

  async listDatabaseBackups(databaseUuid: string): Promise<CoolifyBackupConfig[]> {
    const path = `/databases/${encodeURIComponent(databaseUuid)}/backups`;
    return (await this.readOrNull(path, z.array(backupConfigSchema))) ?? [];
  }

  async listBackupExecutions(
    databaseUuid: string,
    backupUuid: string,
  ): Promise<CoolifyBackupExecution[]> {
    const path = `/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}/executions`;
    return (await this.readOrNull(path, backupExecutionListSchema)) ?? [];
  }

  private async read<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    const { body, status } = await this.send("GET", path, this.maxRetries);
    if (status === 404) {
      throw new IntegrationError(SERVICE, "Ressource introuvable dans Coolify.", { status });
    }
    return this.parse(path, schema, body);
  }

  private async readOrNull<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
  ): Promise<z.output<TSchema> | null> {
    const { body, status } = await this.send("GET", path, this.maxRetries);
    if (status === 404) return null;
    return this.parse(path, schema, body);
  }

  private parse<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    body: unknown,
  ): z.output<TSchema> {
    const result = schema.safeParse(body);
    if (!result.success) {
      logger.warn("coolify.unexpected_response", { path: path.split("?")[0] });
      throw new IntegrationError(SERVICE, "Réponse illisible de Coolify.");
    }
    return result.data;
  }

  /** Lève pour tout échec, sauf 404, laissé à l'appelant. */
  private async send(
    method: "GET" | "POST",
    path: string,
    retries: number,
  ): Promise<{ status: number; body: unknown }> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableError(SERVICE, "not_configured", NOT_CONFIGURED);
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      let raw: string;
      try {
        response = await this.fetchImpl(`${this.consoleUrl}/api/v1${path}`, {
          method,
          headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        raw = await response.text();
      } catch (cause) {
        if (attempt < retries) {
          await this.wait(attempt);
          continue;
        }
        throw new ServiceUnavailableError(SERVICE, "unreachable", "Coolify ne répond pas.", {
          cause,
        });
      }

      const { status } = response;
      if (response.ok || status === 404) return { status, body: parseJson(raw) };

      if (status === 401 || status === 403) {
        throw new ServiceUnavailableError(
          SERVICE,
          "unauthorized",
          "Connexion requise : Coolify refuse le jeton d'API configuré.",
          { status },
        );
      }
      if (status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        throw new ServiceUnavailableError(
          SERVICE,
          "rate_limited",
          "La file de déploiement de Coolify est pleine. Réessayez dans une minute.",
          {
            status,
            retryAfterMs:
              Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          },
        );
      }
      if (status >= 500 && attempt < retries) {
        await this.wait(attempt);
        continue;
      }
      if (status >= 500) {
        throw new ServiceUnavailableError(SERVICE, "unreachable", "Coolify ne répond pas.", {
          status,
        });
      }
      throw new IntegrationError(SERVICE, "Coolify a refusé cette opération.", { status });
    }
  }

  private wait(attempt: number): Promise<void> {
    const delay = this.baseDelayMs * 2 ** attempt;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function parseJson(raw: string): unknown {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
