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
import { listCatalog, providerInCatalog } from "../models/http.ts";
import { authProfileKeys, type ProviderKeys } from "./keys.ts";

export interface ProvidersDeps {
  /** As written: the runtime snapshot holds resolved keys, not references. */
  readonly readConfig: () => OpenClawConfig;
  readonly env: () => NodeJS.ProcessEnv;
  readonly keys: ProviderKeys;
  /** Calls a Gateway method with the Gateway's own token (admin scope). */
  readonly call: (method: string, params: unknown) => Promise<unknown>;
  /** The model catalog, asked of every provider again (`models.list`). */
  readonly catalog: () => Promise<unknown>;
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
  // store reference there hides a profile from model discovery.
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
    ...(entry.keysUrl ? { keysUrl: entry.keysUrl } : {}),
    keyName: entry.keyName,
    key: keySource(config, entry, env, keys),
    ...(entry.local ? { local: true } : {}),
  };
}

const REQUEST_TIMEOUT_MS = 3_000;

/**
 * What connecting a local provider without a key saves. Not the plugin's own
 * "no key" marker (`ollama-local`): saved as a profile, that leaves its models
 * unavailable (live, 2026-11-23).
 */
export const LOCAL_KEY = "local";

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
export const refreshAuth = async (
  call: ProvidersDeps["call"],
  log?: (message: string) => void,
): Promise<unknown> => {
  try {
    return await call("models.authRefresh", { operation: "login" });
  } catch (error) {
    log?.(
      `Provider key saved, but Gateway auth refresh did not complete: ${String(error)}`,
    );
    return undefined;
  }
};

/**
 * Why a provider can't be used with the key it now has, from a fresh catalog;
 * undefined when it can.
 */
export function keyProblem(
  entry: ProviderEntry,
  catalog: unknown,
): string | undefined {
  const { status, models } = providerInCatalog(catalog, entry.id);
  if (status === "auth-rejected") return `${entry.label} rejected this key.`;
  if (status === "unavailable")
    return entry.local
      ? `Couldn't reach ${entry.label} on this computer. Is it running?`
      : `Couldn't reach ${entry.label}. Try again later.`;
  if (models === 0)
    return entry.local
      ? `${entry.label} has no models yet. Download one in ${entry.label} first.`
      : `${entry.label} offers no models for this key.`;
  return undefined;
}

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
    catalog: () => listCatalog({ refresh: true }),
    ...overrides,
  };
  const route = createRouteRegistrar(api);
  // `models.list` is dispatched as the caller, so the Gateway must authenticate.
  const gatewayRoute = createRouteRegistrar(api, { auth: "gateway" });
  const warn = (msg: string) => api.logger?.warn?.(msg) ?? console.warn(msg);

  /**
   * Key writes run one at a time, so a failed save putting the old key back
   * can't undo a save or removal that came in meanwhile.
   */
  let writes: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const run = writes.then(work, work);
    writes = run.catch(() => undefined);
    return run;
  };

  /**
   * Saves `key` and keeps it only if the provider then serves models with it:
   * otherwise puts back the key it had before (or none) and says why. A check
   * that can't run counts as a failed one. TypeSafe serves only Jev, which no
   * catalog lists, so Kazusa's own providers go unchecked.
   */
  const saveChecked = async (
    entry: ProviderEntry,
    key: string,
  ): Promise<string | undefined> => {
    const before = deps.keys.read(entry.id);
    await deps.keys.save(entry.id, key);
    await refreshAuth(deps.call, warn);
    if (entry.plugin === "kazusa") return undefined;
    let problem: string | undefined;
    try {
      problem = keyProblem(entry, await deps.catalog());
    } catch (error) {
      problem = `Couldn't check ${entry.label}'s models: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (!problem) return undefined;
    if (before === undefined) {
      await deps.keys.remove(entry.id, deps.readConfig());
      await refreshAuth(deps.call, warn);
    } else {
      await deps.keys.save(entry.id, before);
      await refreshAuth(deps.call, warn);
      // The catalog holds the failure; ask again for the old key's models.
      await deps.catalog().catch(() => undefined);
    }
    return problem;
  };

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

  gatewayRoute("providers/key", "POST", async (req, res) => {
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
    const key = payload.key || (entry.local ? LOCAL_KEY : undefined);
    if (!key) {
      sendJson(res, 400, { error: `Paste a ${entry.label} key.` });
      return;
    }
    const problem = await oneAtATime(() => saveChecked(entry, key));
    if (problem) {
      sendJson(res, 422, { error: problem });
      return;
    }
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
    await oneAtATime(async () => {
      await deps.keys.remove(entry.id, deps.readConfig());
      await refreshAuth(deps.call, warn);
    });
    respond(res, entry);
  });
}
