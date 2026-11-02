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
  ProviderKeyPayloadSchema,
  ProviderRemovePayloadSchema,
  type ProviderKeySource,
  type ProviderSummary,
  type ProvidersResponse,
} from "@kazusa/client";
import { z } from "zod";
import { TYPESAFE_KEY_PATH } from "../decisions/jev.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  resolveAuthToken,
  sendJson,
} from "../http/helpers.ts";
import { PROVIDERS, type ProviderEntry } from "./catalog.ts";

const StoreRefSchema = z.object({
  source: z.literal("store"),
  provider: z.string(),
  id: z.string(),
});
type StoreRef = z.infer<typeof StoreRefSchema>;

const StoreListSchema = z.object({
  entries: z.array(z.object({ name: z.string() })),
});

export interface ProvidersDeps {
  /** As written: the runtime snapshot holds resolved keys, not references. */
  readonly readConfig: () => OpenClawConfig;
  readonly env: () => NodeJS.ProcessEnv;
  /** Calls a Gateway method with the Gateway's own token (admin scope). */
  readonly call: (method: string, params: unknown) => Promise<unknown>;
}

/** Providers whose plugin this world allows. No allowlist allows them all. */
export function availableProviders(config: OpenClawConfig): ProviderEntry[] {
  const allow = config.plugins?.allow;
  return PROVIDERS.filter((entry) => !allow || allow.includes(entry.plugin));
}

/** The key reference as written, wherever this entry keeps it. */
function keyRef(config: OpenClawConfig, entry: ProviderEntry): unknown {
  if (entry.keyIn === "provider")
    return config.models?.providers?.[entry.id]?.apiKey;
  let node: unknown = config.plugins?.entries?.kazusa?.config;
  for (const key of TYPESAFE_KEY_PATH.split(".")) {
    node = z.record(z.string(), z.unknown()).safeParse(node).data?.[key];
  }
  return node;
}

const storeRef = (
  config: OpenClawConfig,
  entry: ProviderEntry,
): StoreRef | undefined => StoreRefSchema.safeParse(keyRef(config, entry)).data;

export function keySource(
  config: OpenClawConfig,
  entry: ProviderEntry,
  env: NodeJS.ProcessEnv,
  stored: ReadonlySet<string>,
): ProviderKeySource {
  const apiKey = keyRef(config, entry);
  if (apiKey !== undefined) {
    const ref = storeRef(config, entry);
    if (!ref) return "config";
    return stored.has(ref.id) ? "store" : "none";
  }
  return entry.envVars.some((name) => env[name]?.trim()) ? "env" : "none";
}

function summary(
  config: OpenClawConfig,
  entry: ProviderEntry,
  env: NodeJS.ProcessEnv,
  stored: ReadonlySet<string>,
): ProviderSummary {
  return {
    id: entry.id,
    label: entry.label,
    ...(entry.hint ? { hint: entry.hint } : {}),
    ...(entry.keysUrl ? { keysUrl: entry.keysUrl } : {}),
    keyName: storeRef(config, entry)?.id ?? entry.keyName,
    key: keySource(config, entry, env, stored),
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Provider keys live in OpenClaw's secret store. Every provider's reference to
 * its entry is written into `openclaw.json` once, when the world is made
 * (`worlds/base.json`), because writing one later reloads every plugin. So
 * saving or removing a key only changes the store, which OpenClaw re-resolves
 * at once for a referenced name. A reference the user changed by hand (an
 * environment variable, a file) is reported and left alone.
 */
export function registerProvidersHttp(
  api: OpenClawPluginApi,
  overrides: Partial<ProvidersDeps> = {},
): void {
  const deps: ProvidersDeps = {
    readConfig: () => getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig(),
    env: () => process.env,
    // `secrets.*` need `operator.admin`, which a Gateway-authenticated HTTP
    // route doesn't carry; like Usage, ask as the CLI does, with the token.
    call: (method, params) =>
      callGatewayFromCli(
        method,
        {
          token: resolveAuthToken(api),
          timeout: String(REQUEST_TIMEOUT_MS),
          json: true,
        },
        params,
        { progress: false },
      ),
    ...overrides,
  };
  const route = createRouteRegistrar(api);

  const stored = async (): Promise<Set<string>> =>
    new Set(
      StoreListSchema.parse(
        await deps.call("secrets.store.list", {}),
      ).entries.map((entry) => entry.name),
    );

  const find = (id: string): ProviderEntry | undefined =>
    availableProviders(deps.readConfig()).find((entry) => entry.id === id);

  const respond = async (
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
        await stored(),
      ) satisfies ProviderSummary,
    );

  /** The store entry this provider reads, or why there isn't one to change. */
  const target = (entry: ProviderEntry): StoreRef | string =>
    storeRef(deps.readConfig(), entry) ??
    `${entry.label} reads its key from somewhere else set in openclaw.json; change it there.`;

  route("providers", "GET", async (_req, res) => {
    const config = deps.readConfig();
    const env = deps.env();
    const names = await stored();
    sendJson(res, 200, {
      providers: availableProviders(config).map((entry) =>
        summary(config, entry, env, names),
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
    const ref = target(entry);
    if (typeof ref === "string") {
      sendJson(res, 409, { error: ref });
      return;
    }
    await deps.call("secrets.store.set", {
      name: ref.id,
      value: payload.key,
      kind: "secret",
    });
    await respond(res, entry);
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
    const ref = target(entry);
    if (typeof ref === "string") {
      sendJson(res, 409, { error: ref });
      return;
    }
    await deps.call("secrets.store.delete", { name: ref.id });
    await respond(res, entry);
  });
}
