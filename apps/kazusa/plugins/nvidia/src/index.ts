import { readFileSync } from "node:fs";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { buildProvider, buildStaticProvider, projectModels } from "./models.ts";

/**
 * NVIDIA with every chat model its API lists. OpenClaw's own NVIDIA plugin
 * offers only models it already knows or NVIDIA features, so most of what an
 * NVIDIA key can run never showed. Only one plugin may own a provider, so
 * Kazusa turns OpenClaw's off (`apps/kazusa/base.json`,
 * `scripts/plugin-startup.mjs`). The provider id stays `nvidia`: keys and model
 * picks carry over.
 */
export default defineSingleProviderPluginEntry({
  id: "kazusa-nvidia",
  name: "NVIDIA Provider",
  description: "NVIDIA's chat models, every one its API lists.",
  // Its API-key sign-in, variable and endpoint come from the manifest.
  manifest: JSON.parse(
    readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
  ),
  provider: {
    // Not the plugin's id, which OpenClaw's own NVIDIA plugin holds.
    id: "nvidia",
    label: "NVIDIA",
    docsPath: "/providers/nvidia",
    // Ids keep their publisher: `nvidia/z-ai/glm-5.3-flash`.
    preserveLiteralProviderPrefix: true,
    catalog: {
      discoveryMode: "strict",
      buildProvider,
      buildStaticProvider,
      liveModelDiscovery: { projectRows: projectModels },
    },
  },
});
