import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
} from "openclaw/plugin-sdk/runtime-config-snapshot";
import { getPreparedPluginSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { DECISION_PROVIDER_ID, TYPESAFE_KEY_PATH } from "../decisions/jev.ts";
import { PROVIDERS } from "@kazusa/client";
import { adminCall, refreshAuth } from "./http.ts";
import { authProfileKeys, type ProviderKeys } from "./keys.ts";

const StoreRefSchema = z.object({
  source: z.literal("store"),
  provider: z.string(),
  id: z.string(),
});

const StoreListSchema = z.object({
  entries: z.array(z.object({ name: z.string() })),
});

const ResolvedSchema = z.object({
  assignments: z
    .array(z.object({ pathSegments: z.array(z.string()), value: z.unknown() }))
    .default([]),
});

export interface MigrateDeps {
  /** As written, with references rather than resolved keys. */
  readonly readConfig: () => OpenClawConfig;
  readonly keys: ProviderKeys;
  readonly call: (method: string, params: unknown) => Promise<unknown>;
  /**
   * TypeSafe's key behind Kazusa's own reference, which `secrets.resolve` can't
   * name.
   */
  readonly typesafeKey: () => string | undefined;
}

/**
 * Keys used to live in OpenClaw's secret store, behind references in
 * `openclaw.json`. This copies each one still there into an auth profile and
 * changes nothing else: deleting the entry while its reference stands would
 * leave that provider unavailable. Before the next Gateway start,
 * `scripts/provider-keys.mjs` drops the references and then the entries.
 * Returns the providers it copied. deprecated: only worlds made by 0.1.3 and
 * 0.2.0 have store references; remove once none are left.
 */
export async function copyStoreKeysToProfiles(
  deps: MigrateDeps,
): Promise<string[]> {
  const config = deps.readConfig();
  const stored = new Set(
    StoreListSchema.parse(
      await deps.call("secrets.store.list", {}),
    ).entries.map((entry) => entry.name),
  );
  const behindStore = (ref: unknown) => {
    const parsed = StoreRefSchema.safeParse(ref);
    return parsed.success && stored.has(parsed.data.id);
  };
  const paths = PROVIDERS.filter(
    (entry) =>
      !deps.keys.has(entry.id) &&
      behindStore(config.models?.providers?.[entry.id]?.apiKey),
  ).map((entry) => `models.providers.${entry.id}.apiKey`);
  const copied: string[] = [];
  if (paths.length) {
    const { assignments } = ResolvedSchema.parse(
      await deps.call("secrets.resolve", {
        commandName: "kazusa-provider-keys",
        targetIds: ["models.providers.*.apiKey"],
        allowedPaths: paths,
      }),
    );
    for (const { pathSegments, value } of assignments) {
      const provider = pathSegments[2];
      if (!provider || typeof value !== "string" || !value.trim()) continue;
      await deps.keys.save(provider, value.trim());
      copied.push(provider);
    }
  }
  let node: unknown = config.plugins?.entries?.kazusa?.config;
  for (const key of TYPESAFE_KEY_PATH.split("."))
    node = z.record(z.string(), z.unknown()).safeParse(node).data?.[key];
  const typesafe = behindStore(node) ? deps.typesafeKey()?.trim() : undefined;
  if (typesafe && !deps.keys.has("typesafe")) {
    await deps.keys.save("typesafe", typesafe);
    copied.push("typesafe");
  }
  if (copied.length) await refreshAuth(deps.call);
  return copied;
}

/**
 * Runs that copy once the Gateway is up. deprecated: see
 * `copyStoreKeysToProfiles`.
 */
export function registerProviderKeyMigration(api: OpenClawPluginApi): void {
  const deps: MigrateDeps = {
    readConfig: () => getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig(),
    keys: authProfileKeys,
    call: adminCall(api),
    typesafeKey: () =>
      getPreparedPluginSecretInput(DECISION_PROVIDER_ID, TYPESAFE_KEY_PATH)
        .value,
  };
  // It calls the Gateway, which answers only once startup is done.
  api.on("gateway_start", () => {
    inBackground(
      api,
      async () => {
        const copied = await copyStoreKeysToProfiles(deps);
        if (copied.length)
          api.logger.info(
            `Moved ${copied.join(", ")} keys from the secret store into auth profiles; the next start drops the old references.`,
          );
      },
      (error) =>
        api.logger.warn(
          `Couldn't move provider keys into auth profiles: ${String(error)}`,
        ),
    );
  });
}
