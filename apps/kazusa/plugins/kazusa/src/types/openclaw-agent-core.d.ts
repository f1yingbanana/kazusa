/** OpenClaw 2026.10.5 exports this public runtime but omits its declarations. */
declare module "openclaw/plugin-sdk/agent-core" {
  import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

  type Engine = Awaited<
    ReturnType<Parameters<OpenClawPluginApi["registerContextEngine"]>[1]>
  >;

  export function estimateTokens(
    message: Parameters<Engine["assemble"]>[0]["messages"][number],
  ): number;
}
