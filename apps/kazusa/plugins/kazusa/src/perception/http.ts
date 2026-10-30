import {
  BrainAbortPayloadSchema,
  type BrainAbortResponse,
} from "@kazusa/client";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import {
  abortAndDrainAgentHarnessRun,
  resolveActiveEmbeddedRunSessionId,
} from "openclaw/plugin-sdk/agent-harness-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";

/** Stop the character's current native run, leaving its queue and history alone. */
export function registerBrainHttp(api: OpenClawPluginApi): void {
  const route = createRouteRegistrar(api, { auth: "gateway" });
  route("brain/abort", "POST", async (req, res) => {
    const { agentId } = BrainAbortPayloadSchema.parse(await readJsonBody(req));
    if (!listAgentIds(currentConfig(api)).includes(agentId)) {
      sendJson(res, 404, { error: `Unknown character: ${agentId}.` });
      return;
    }
    const sessionKey = `agent:${agentId}:brain`;
    const sessionId = resolveActiveEmbeddedRunSessionId(sessionKey);
    const result = sessionId
      ? await abortAndDrainAgentHarnessRun({
          sessionId,
          sessionKey,
          settleMs: 2000,
          reason: "operator",
        })
      : { aborted: false, drained: true };
    sendJson(res, 200, {
      aborted: result.aborted,
      drained: result.drained,
    } satisfies BrainAbortResponse);
  });
}
