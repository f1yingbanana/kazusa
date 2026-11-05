import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  removeProviderAuthProfilesWithLock,
  upsertAuthProfileWithLock,
} from "openclaw/plugin-sdk/provider-auth";

/** The auth profile Kazusa keeps a pasted key in, as OpenClaw names one. */
export const profileIdFor = (provider: string): string => `${provider}:manual`;

/**
 * Provider keys as OpenClaw auth profiles in the shared store
 * (`.state/state/openclaw.sqlite`), which every agent reads. A profile is the
 * one place a key reaches both model calls and live model discovery: a secret
 * store reference reaches discovery only as a placeholder. These writes never
 * touch `openclaw.json`, unlike `models.authSetApiKey` and `paste-api-key`, so
 * nothing reloads; `models.authRefresh` makes the Gateway read them.
 */
export interface ProviderKeys {
  readonly has: (provider: string) => boolean;
  readonly save: (provider: string, key: string) => Promise<void>;
  readonly remove: (provider: string, config: OpenClawConfig) => Promise<void>;
}

const has = (provider: string): boolean =>
  listProfilesForProvider(ensureAuthProfileStore(), provider).includes(
    profileIdFor(provider),
  );

export const authProfileKeys: ProviderKeys = {
  has,
  save: async (provider, key) => {
    const saved = await upsertAuthProfileWithLock({
      profileId: profileIdFor(provider),
      credential: { type: "api_key", provider, key },
    });
    if (!saved) throw new Error("The key store is busy. Try again.");
  },
  remove: async (provider, config) => {
    if (!has(provider)) return;
    // Only Kazusa's own profile: a sign-in made through OpenClaw stays.
    const removed = await removeProviderAuthProfilesWithLock({
      cfg: config,
      provider,
      profileIds: [profileIdFor(provider)],
    });
    if (!removed) throw new Error("The key store is busy. Try again.");
  },
};

/**
 * Whether a key for `provider` is there: Kazusa's profile, or anywhere OpenClaw
 * looks. OpenClaw's own check misses a profile for a provider from a plugin
 * outside its bundle (OpenRP's, live 2026-11-04), so ask both.
 */
export const providerKeyConfigured = (
  api: OpenClawPluginApi,
  provider: string,
): boolean =>
  authProfileKeys.has(provider) ||
  api.runtime.modelAuth.isProviderApiKeyConfigured({
    provider,
    cfg: currentConfig(api),
  });
