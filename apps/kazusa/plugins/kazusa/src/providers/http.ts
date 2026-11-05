import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import {
  PROVIDERS,
  ProviderKeyPayloadSchema,
  ProviderRemovePayloadSchema,
  type ProviderEntry,
  type ProviderKeySource,
  type ProviderSummary,
  type ProvidersResponse,
} from "@kazusa/client";
import {
  createRouteRegistrar,
  readJsonBody,
  resolveAuthToken,
  sendJson,
} from "../http/helpers.ts";
import { authProfileKeys, type ProviderKeys } from "./keys.ts";

export interface ProvidersDeps {
  /** As written: the runtime snapshot holds resolved keys, not references. */
  readonly readConfig: () => OpenClawConfig;
  readonly env: () => NodeJS.ProcessEnv;
  readonly keys: ProviderKeys;
  /** Calls a Gateway method with the Gateway's own token (admin scope). */
  readonly call: (method: string, params: unknown) => Promise<unknown>;
}

/** Providers whose plugin this world allows. No allowlist allows them all. */
export function availableProviders(config: OpenClawConfig): ProviderEntry[] {
  const allow = config.plugins?.allow;
  return PROVIDERS.filter((entry) => !allow || allow.includes(entry.plugin));
}

export function keySource(
  config: OpenClawConfig,
  entry: ProviderEntry,
  env: NodeJS.ProcessEnv,
  keys: ProviderKeys,
): ProviderKeySource {
  // A key written into `openclaw.json` is the user's to change there, and a
  // store reference there hides a profile from model discovery. The ones
  // Kazusa once wrote go before the Gateway starts (`scripts/provider-keys.mjs`).
  if (config.models?.providers?.[entry.id]?.apiKey !== undefined)
    return "config";
  if (keys.has(entry.id)) return "profile";
  return entry.envVars.some((name) => env[name]?.trim()) ? "env" : "none";
}

function summary(
  config: OpenClawConfig,
  entry: ProviderEntry,
  env: NodeJS.ProcessEnv,
  keys: ProviderKeys,
): ProviderSummary {
  return {
    id: entry.id,
    label: entry.label,
    ...(entry.hint ? { hint: entry.hint } : {}),
    ...(entry.keysUrl ? { keysUrl: entry.keysUrl } : {}),
    keyName: entry.keyName,
    key: keySource(config, entry, env, keys),
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `models.authRefresh` and `secrets.*` need `operator.admin`, which a
 * Gateway-authenticated HTTP route doesn't carry; like Usage, ask as the CLI
 * does, with the Gateway's token.
 */
export const adminCall =
  (api: OpenClawPluginApi) =>
  (method: string, params: unknown): Promise<unknown> =>
    callGatewayFromCli(
      method,
      {
        token: resolveAuthToken(api),
        timeout: String(REQUEST_TIMEOUT_MS),
        json: true,
      },
      params,
      { progress: false },
    );

/** Makes the Gateway read a changed profile at once, without a reload. */
export const refreshAuth = (call: ProvidersDeps["call"]): Promise<unknown> =>
  call("models.authRefresh", { operation: "login" });

/**
 * Provider keys live in OpenClaw auth profiles (`keys.ts`). Saving or removing
 * one changes only the shared auth store, then asks the Gateway to read it
 * again, so `openclaw.json` never changes and no plugin reloads. A key the user
 * wrote into `openclaw.json` is reported and left alone.
 */
export function registerProvidersHttp(
  api: OpenClawPluginApi,
  overrides: Partial<ProvidersDeps> = {},
): void {
  const deps: ProvidersDeps = {
    readConfig: () => getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig(),
    env: () => process.env,
    keys: authProfileKeys,
    call: adminCall(api),
    ...overrides,
  };
  const route = createRouteRegistrar(api);

  const find = (id: string): ProviderEntry | undefined =>
    availableProviders(deps.readConfig()).find((entry) => entry.id === id);

  const respond = (
    res: Parameters<Parameters<typeof route>[2]>[1],
    entry: ProviderEntry,
  ) =>
    sendJson(
      res,
      200,
      summary(
        deps.readConfig(),
        entry,
        deps.env(),
        deps.keys,
      ) satisfies ProviderSummary,
    );

  route("providers", "GET", async (_req, res) => {
    const config = deps.readConfig();
    const env = deps.env();
    sendJson(res, 200, {
      providers: availableProviders(config).map((entry) =>
        summary(config, entry, env, deps.keys),
      ),
    } satisfies ProvidersResponse);
  });

  route("providers/key", "POST", async (req, res) => {
    const payload = ProviderKeyPayloadSchema.parse(await readJsonBody(req));
    const entry = find(payload.provider);
    if (!entry) {
      sendJson(res, 404, { error: `Unknown provider: ${payload.provider}.` });
      return;
    }
    if (
      keySource(deps.readConfig(), entry, deps.env(), deps.keys) === "config"
    ) {
      sendJson(res, 409, {
        error: `${entry.label} reads its key from openclaw.json; change it there.`,
      });
      return;
    }
    await deps.keys.save(entry.id, payload.key);
    await refreshAuth(deps.call);
    respond(res, entry);
  });

  route("providers/remove", "POST", async (req, res) => {
    const { provider } = ProviderRemovePayloadSchema.parse(
      await readJsonBody(req),
    );
    const entry = find(provider);
    if (!entry) {
      sendJson(res, 404, { error: `Unknown provider: ${provider}.` });
      return;
    }
    await deps.keys.remove(entry.id, deps.readConfig());
    await refreshAuth(deps.call);
    respond(res, entry);
  });
}
