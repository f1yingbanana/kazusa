import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

/** Read the host's current snapshot, including across plugin loader boundaries. */
export function currentConfig(api: OpenClawPluginApi): OpenClawConfig {
  // The host returns DeepReadonly<OpenClawConfig>, but its SDK resolvers still
  // accept the mutable spelling. Consumers only read this native snapshot.
  return api.runtime.config.current() as OpenClawConfig;
}
