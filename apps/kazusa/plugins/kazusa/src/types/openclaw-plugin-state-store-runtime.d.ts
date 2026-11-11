/**
 * OpenClaw exports this public runtime module, but v2026.10.5 omits its
 * declaration file. Tests use it to open real keyed stores. Remove this when
 * the SDK ships the corresponding types.
 */
declare module "openclaw/plugin-sdk/plugin-state-store-runtime" {
  import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

  type OpenKeyedStore = OpenClawPluginApi["runtime"]["state"]["openKeyedStore"];

  /** What `api.runtime.state.openKeyedStore` opens, for any plugin id. */
  export function createPluginStateKeyedStore(
    pluginId: string,
    options: Parameters<OpenKeyedStore>[0],
  ): ReturnType<OpenKeyedStore>;
}
