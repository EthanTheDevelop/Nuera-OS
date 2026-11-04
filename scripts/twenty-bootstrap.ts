/**
 * Prépare une instance Twenty pour Nuera OS, de façon idempotente.
 *
 *   npm run twenty:bootstrap
 *   npm run twenty:bootstrap -- --webhook-url=https://nuera.exemple.fr/api/webhooks/twenty
 *
 * 1. Instance LOCALE (localhost / 127.0.0.1) sans clé valide : crée le compte dev@nuera.local et
 *    l'espace de travail, active l'espace, crée une clé d'API, écrit TWENTY_API_URL, TWENTY_API_KEY
 *    et TWENTY_DEV_ADMIN_PASSWORD dans `.env` (ignoré par Git). Aucun secret n'est affiché.
 * 2. Instance locale : autorise host.docker.internal comme destination de webhook (protection SSRF).
 * 3. Toute instance (TWENTY_API_URL + TWENTY_API_KEY) : applique les étapes Nuera aux opportunités.
 * 4. Avec --webhook-url : crée ou met à jour le webhook et écrit TWENTY_WEBHOOK_SECRET dans `.env`.
 *
 * Exception assumée à `getEnv()` : le script doit pouvoir tourner avec les seules variables Twenty
 * (par exemple contre la production), sans DATABASE_URL ni BETTER_AUTH_SECRET.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { TwentyApiError, TwentyClient } from "@/integrations/twenty/twenty.client";
import { planStageOptions, type TwentySelectOption } from "@/integrations/twenty/twenty.data-model";

const ENV_FILE = resolve(process.cwd(), ".env");
const DEFAULT_LOCAL_URL = "http://localhost:3100";
const ADMIN_EMAIL = "dev@nuera.local";
const WORKSPACE_NAME = "Nuera Studio (dev)";
const API_KEY_NAME = "nuera-os";
/** Comme l'option « jamais » de l'interface Twenty : la clé locale n'a pas vocation à expirer. */
const API_KEY_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const LOCAL_WEBHOOK_HOST = "host.docker.internal";
const WEBHOOK_OPERATIONS = [
  "company.*",
  "person.*",
  "opportunity.*",
  "note.*",
  "task.*",
  "noteTarget.*",
  "taskTarget.*",
];

type Json = Record<string, unknown>;

class BootstrapError extends Error {}

function upsertEnvFile(values: Record<string, string>): void {
  const content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      if (lines.at(-1) === "") lines.pop();
      lines.push(`${key}=${value}`, "");
    }
  }
  writeFileSync(ENV_FILE, lines.join(eol), "utf8");
}

async function graphql<T>(
  baseUrl: string,
  path: "/metadata" | "/admin-panel",
  query: string,
  variables: Json,
  token?: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    // L'activation d'un espace de travail crée ses tables : elle prend plusieurs secondes.
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) {
    const reason = body.errors?.map((error) => error.message).join(" ; ") ?? "réponse vide";
    throw new BootstrapError(`Échec GraphQL ${path} (${response.status}) : ${reason}`);
  }
  return body.data;
}

function isLocal(baseUrl: string): boolean {
  const { hostname } = new URL(baseUrl);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function isKeyValid(baseUrl: string, key: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/rest/companies?limit=1&depth=0&fields=id`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  return response.ok;
}

// --- Compte, espace de travail et clé (instance locale uniquement) -------------------------------

type AvailableWorkspace = { id: string; loginToken: string | null };
type AuthResult = {
  availableWorkspaces: {
    availableWorkspacesForSignIn: AvailableWorkspace[];
    availableWorkspacesForSignUp: AvailableWorkspace[];
  };
  tokens: { accessOrWorkspaceAgnosticToken: { token: string } };
};

const AUTH_FIELDS = `
  availableWorkspaces {
    availableWorkspacesForSignIn { id loginToken }
    availableWorkspacesForSignUp { id loginToken }
  }
  tokens { accessOrWorkspaceAgnosticToken { token } }
`;

async function signInAdmin(baseUrl: string, password: string): Promise<AuthResult> {
  const { signIn } = await graphql<{ signIn: AuthResult }>(
    baseUrl,
    "/metadata",
    `mutation($email: String!, $password: String!) {
      signIn(email: $email, password: $password) { ${AUTH_FIELDS} }
    }`,
    { email: ADMIN_EMAIL, password },
  );
  return signIn;
}

async function authenticateAdmin(baseUrl: string): Promise<AuthResult> {
  const { checkUserExists } = await graphql<{ checkUserExists: { exists: boolean } }>(
    baseUrl,
    "/metadata",
    `
      query ($email: String!) {
        checkUserExists(email: $email) {
          exists
        }
      }
    `,
    { email: ADMIN_EMAIL },
  );

  if (!checkUserExists.exists) {
    const password = randomBytes(24).toString("base64url");
    // Écrit AVANT l'inscription : une coupure ne doit pas laisser un compte au mot de passe inconnu.
    upsertEnvFile({ TWENTY_DEV_ADMIN_PASSWORD: password });
    process.env.TWENTY_DEV_ADMIN_PASSWORD = password;
    const { signUp } = await graphql<{ signUp: AuthResult }>(
      baseUrl,
      "/metadata",
      `mutation($email: String!, $password: String!) {
        signUp(email: $email, password: $password) { ${AUTH_FIELDS} }
      }`,
      { email: ADMIN_EMAIL, password },
    );
    console.log(`✔ Compte administrateur créé : ${ADMIN_EMAIL}`);
    return signUp;
  }

  const password = process.env.TWENTY_DEV_ADMIN_PASSWORD;
  if (!password) {
    throw new BootstrapError(
      `Le compte ${ADMIN_EMAIL} existe déjà mais TWENTY_DEV_ADMIN_PASSWORD est absent de .env : ` +
        "renseignez-le, ou recréez l'instance locale.",
    );
  }
  console.log(`✔ Compte administrateur existant : ${ADMIN_EMAIL}`);
  return signInAdmin(baseUrl, password);
}

async function getWorkspaceAccessToken(baseUrl: string, auth: AuthResult): Promise<string> {
  let loginToken = auth.availableWorkspaces.availableWorkspacesForSignIn[0]?.loginToken ?? null;

  if (!loginToken) {
    const { signUpInNewWorkspace } = await graphql<{
      signUpInNewWorkspace: { loginToken: { token: string } };
    }>(
      baseUrl,
      "/metadata",
      `
        mutation ($input: SignUpInNewWorkspaceInput) {
          signUpInNewWorkspace(input: $input) {
            loginToken {
              token
            }
            workspace {
              id
            }
          }
        }
      `,
      { input: { displayName: WORKSPACE_NAME } },
      auth.tokens.accessOrWorkspaceAgnosticToken.token,
    );
    loginToken = signUpInNewWorkspace.loginToken.token;
    console.log("✔ Espace de travail créé");
  }

  const { getAuthTokensFromLoginToken } = await graphql<{
    getAuthTokensFromLoginToken: { tokens: { accessOrWorkspaceAgnosticToken: { token: string } } };
  }>(
    baseUrl,
    "/metadata",
    `
      mutation ($loginToken: String!, $origin: String!) {
        getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
          tokens {
            accessOrWorkspaceAgnosticToken {
              token
            }
          }
        }
      }
    `,
    { loginToken, origin: baseUrl },
  );
  return getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
}

async function activateWorkspace(baseUrl: string, accessToken: string): Promise<void> {
  const { activateWorkspace: workspace } = await graphql<{
    activateWorkspace: { activationStatus: string };
  }>(
    baseUrl,
    "/metadata",
    `
      mutation ($data: ActivateWorkspaceInput!) {
        activateWorkspace(data: $data) {
          id
          activationStatus
        }
      }
    `,
    { data: { displayName: WORKSPACE_NAME } },
    accessToken,
  );
  console.log(`✔ Espace de travail actif (${workspace.activationStatus})`);
}

async function createApiKey(baseUrl: string, accessToken: string): Promise<string> {
  const { apiKeys, getApiKeyRoles } = await graphql<{
    apiKeys: { id: string; name: string; revokedAt: string | null }[];
    getApiKeyRoles: { id: string; label: string }[];
  }>(
    baseUrl,
    "/metadata",
    `
      query {
        apiKeys {
          id
          name
          revokedAt
        }
        getApiKeyRoles {
          id
          label
        }
      }
    `,
    {},
    accessToken,
  );

  const expiresAt = new Date(Date.now() + API_KEY_LIFETIME_MS).toISOString();
  let apiKeyId = apiKeys.find((key) => key.name === API_KEY_NAME && !key.revokedAt)?.id;

  if (!apiKeyId) {
    const adminRole = getApiKeyRoles.find((role) => role.label === "Admin");
    if (!adminRole) throw new BootstrapError("Rôle « Admin » introuvable pour la clé d'API.");
    const { createApiKey: created } = await graphql<{ createApiKey: { id: string } }>(
      baseUrl,
      "/metadata",
      `
        mutation ($input: CreateApiKeyInput!) {
          createApiKey(input: $input) {
            id
          }
        }
      `,
      { input: { name: API_KEY_NAME, expiresAt, roleId: adminRole.id } },
      accessToken,
    );
    apiKeyId = created.id;
    console.log(`✔ Clé d'API « ${API_KEY_NAME} » créée`);
  }

  const { generateApiKeyToken } = await graphql<{ generateApiKeyToken: { token: string } }>(
    baseUrl,
    "/metadata",
    `
      mutation ($apiKeyId: UUID!, $expiresAt: String!) {
        generateApiKeyToken(apiKeyId: $apiKeyId, expiresAt: $expiresAt) {
          token
        }
      }
    `,
    { apiKeyId, expiresAt },
    accessToken,
  );
  return generateApiKeyToken.token;
}

async function ensureCredentials(baseUrl: string): Promise<string> {
  const configuredKey = process.env.TWENTY_API_KEY;
  if (configuredKey && (await isKeyValid(baseUrl, configuredKey))) {
    console.log(`✔ Clé d'API valide pour ${baseUrl}`);
    return configuredKey;
  }
  if (!isLocal(baseUrl)) {
    throw new BootstrapError(
      `Clé d'API absente ou refusée par ${baseUrl}. Hors instance locale, le script ne crée aucun ` +
        "compte : créez une clé (Paramètres → API & Webhooks) puis renseignez TWENTY_API_KEY.",
    );
  }

  const auth = await authenticateAdmin(baseUrl);
  const accessToken = await getWorkspaceAccessToken(baseUrl, auth);
  await activateWorkspace(baseUrl, accessToken);
  const apiKey = await createApiKey(baseUrl, accessToken);
  upsertEnvFile({ TWENTY_API_URL: baseUrl, TWENTY_API_KEY: apiKey });
  console.log("✔ TWENTY_API_URL et TWENTY_API_KEY écrits dans .env");
  return apiKey;
}

/**
 * Twenty refuse par défaut les webhooks vers une adresse privée (protection SSRF) : sans cela,
 * aucune livraison n'atteint un serveur Nuera OS tournant sur le poste de développement.
 * Réglage en base (compte administrateur requis), jamais appliqué hors instance locale.
 */
async function allowLocalWebhooks(baseUrl: string): Promise<void> {
  const password = process.env.TWENTY_DEV_ADMIN_PASSWORD;
  if (!password) {
    console.log("• Destination locale des webhooks non réglée : mot de passe local inconnu.");
    return;
  }
  const auth = await signInAdmin(baseUrl, password);
  const token = await getWorkspaceAccessToken(baseUrl, auth);
  const key = "OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS";
  const { getDatabaseConfigVariable: current } = await graphql<{
    getDatabaseConfigVariable: { value: unknown; source: string };
  }>(
    baseUrl,
    "/admin-panel",
    `
      query ($key: String!) {
        getDatabaseConfigVariable(key: $key) {
          value
          source
        }
      }
    `,
    { key },
    token,
  );
  if (Array.isArray(current.value) && current.value.includes(LOCAL_WEBHOOK_HOST)) {
    console.log(`✔ Webhooks locaux autorisés vers ${LOCAL_WEBHOOK_HOST}`);
    return;
  }
  const mutation = current.source === "DATABASE" ? "update" : "create";
  await graphql(
    baseUrl,
    "/admin-panel",
    `mutation($key: String!, $value: JSON!) {
      ${mutation}DatabaseConfigVariable(key: $key, value: $value)
    }`,
    { key, value: [LOCAL_WEBHOOK_HOST] },
    token,
  );
  console.log(`✔ Webhooks locaux autorisés vers ${LOCAL_WEBHOOK_HOST} (effectif sous 15 s)`);
}

// --- Modèle de données ---------------------------------------------------------------------------

type MetadataField = { id: string; name: string; options?: TwentySelectOption[] | null };
type MetadataObject = { id: string; nameSingular: string; fields: MetadataField[] };

/** Twenty retire l'enveloppe `data.objects` de l'API Metadata le 15/11/2026 : accepter les deux. */
function unwrapList<T>(body: unknown, key: string): T[] {
  const root = body as { data?: unknown } | T[];
  if (Array.isArray(root)) return root;
  const data = root.data;
  if (Array.isArray(data)) return data as T[];
  const nested = (data as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(nested)) return nested as T[];
  throw new BootstrapError(`Réponse inattendue de l'API Metadata (${key}).`);
}

async function countOpportunitiesInStages(client: TwentyClient, values: string[]): Promise<number> {
  const body = (await client.request({
    method: "GET",
    path: "/rest/opportunities",
    query: {
      limit: 1,
      depth: 0,
      fields: "id",
      filter: `stage[in]:[${values.map((value) => `"${value}"`).join(",")}]`,
    },
  })) as { totalCount?: number };
  return body.totalCount ?? 0;
}

async function applyStageOptions(client: TwentyClient): Promise<void> {
  const objects = unwrapList<MetadataObject>(
    await client.request({ method: "GET", path: "/rest/metadata/objects", query: { limit: 200 } }),
    "objects",
  );
  const stage = objects
    .find((object) => object.nameSingular === "opportunity")
    ?.fields.find((field) => field.name === "stage");
  if (!stage) throw new BootstrapError("Champ « stage » introuvable sur les opportunités.");

  const plan = planStageOptions(stage.options ?? []);
  if (!plan.options) {
    console.log("✔ Étapes d'opportunité déjà conformes");
    return;
  }
  if (plan.orphanValues.length > 0) {
    const used = await countOpportunitiesInStages(client, plan.orphanValues);
    if (used > 0) {
      throw new BootstrapError(
        `${used} opportunité(s) utilisent des étapes sans équivalent Nuera ` +
          `(${plan.orphanValues.join(", ")}) : déplacez-les d'abord, rien n'a été modifié.`,
      );
    }
  }
  await client.request({
    method: "PATCH",
    path: `/rest/metadata/fields/${stage.id}`,
    body: { options: plan.options },
  });
  console.log("✔ Étapes d'opportunité appliquées");
}

// --- Webhook -------------------------------------------------------------------------------------

type Webhook = { id: string; targetUrl: string; operations: string[]; secret: string };

function unwrapRecord<T>(body: unknown): T {
  const root = body as { data?: T } & T;
  return root.data ?? root;
}

async function ensureWebhook(baseUrl: string, apiKey: string, client: TwentyClient, url: string) {
  const targetUrl = new URL(url).toString();
  const webhooks = unwrapList<Webhook>(
    await client.request({ method: "GET", path: "/rest/metadata/webhooks" }),
    "webhooks",
  );
  const existing = webhooks.find((webhook) => webhook.targetUrl === targetUrl);
  const secret =
    process.env.TWENTY_WEBHOOK_SECRET || existing?.secret || randomBytes(32).toString("hex");

  if (existing) {
    await client.request({
      method: "PATCH",
      path: `/rest/metadata/webhooks/${existing.id}`,
      body: { operations: WEBHOOK_OPERATIONS, secret },
    });
    console.log(`✔ Webhook déjà présent, mis à jour : ${targetUrl}`);
  } else {
    // Twenty exige un rôle : il détermine les enregistrements que le webhook a le droit de recevoir.
    const { getApiKeyRoles } = await graphql<{ getApiKeyRoles: { id: string; label: string }[] }>(
      baseUrl,
      "/metadata",
      `
        query {
          getApiKeyRoles {
            id
            label
          }
        }
      `,
      {},
      apiKey,
    );
    const roleId = getApiKeyRoles.find((role) => role.label === "Admin")?.id;
    if (!roleId) throw new BootstrapError("Rôle « Admin » introuvable pour le webhook.");
    const created = unwrapRecord<Webhook>(
      await client.request({
        method: "POST",
        path: "/rest/metadata/webhooks",
        body: {
          targetUrl,
          operations: WEBHOOK_OPERATIONS,
          description: "Nuera OS : projection locale",
          secret,
          roleId,
        },
      }),
    );
    console.log(`✔ Webhook créé : ${created.targetUrl}`);
  }
  upsertEnvFile({ TWENTY_WEBHOOK_SECRET: secret });
  console.log("✔ TWENTY_WEBHOOK_SECRET écrit dans .env");
}

// --- Programme -----------------------------------------------------------------------------------

const { values: args } = parseArgs({ options: { "webhook-url": { type: "string" } } });

try {
  const baseUrl = (process.env.TWENTY_API_URL || DEFAULT_LOCAL_URL).replace(/\/+$/, "");
  const apiKey = await ensureCredentials(baseUrl);
  const client = new TwentyClient({ baseUrl, apiKey, timeoutMs: 120_000 });

  if (isLocal(baseUrl)) await allowLocalWebhooks(baseUrl);
  await applyStageOptions(client);
  if (args["webhook-url"]) await ensureWebhook(baseUrl, apiKey, client, args["webhook-url"]);
} catch (error) {
  const detail =
    error instanceof TwentyApiError
      ? `${error.message} (HTTP ${error.status}) ${error.messages.join(" ; ")}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`✖ ${detail}`);
  process.exitCode = 1;
}
