import { takeContinuation } from "./continue.ts";
import {
  BrainAbortPayloadSchema,
  hasPermission,
  type BrainAbortResponse,
  type BrainTraceResponse,
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
import { readBrainTurns, withFailure, type RunFailure } from "./brain-trace.ts";

const DEFAULT_TRACE_TURNS = 20;
const MAX_TRACE_TURNS = 100;

/** Stop the character's current native run, leaving its queue and history alone. */
export function registerBrainHttp(api: OpenClawPluginApi): void {
  const route = createRouteRegistrar(api, { auth: "gateway" });
  route("brain/abort", "POST", async (req, res) => {
    const { agentId } = BrainAbortPayloadSchema.parse(await readJsonBody(req));
    if (!listAgentIds(currentConfig(api)).includes(agentId)) {
      sendJson(res, 404, { error: `Unknown character: ${agentId}.` });
      return;
    }
    // Stopping a run stops a long job too.
    takeContinuation(agentId);
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

/** The brain transcript as turns: thinking, tool calls, tokens and model. */
export function registerBrainTraceHttp(
  api: OpenClawPluginApi,
  failureOf: (agentId: string) => Promise<RunFailure | undefined>,
): void {
  createRouteRegistrar(api)("brain/trace", "GET", async (req, res, role) => {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const agentId = params.get("id") ?? "";
    const config = currentConfig(api);
    if (!listAgentIds(config).includes(agentId)) {
      sendJson(res, 404, { error: `Unknown character: ${agentId}.` });
      return;
    }
    if (
      agentId === config.agents?.defaults?.systemAgent?.agentId &&
      !hasPermission(role, "manage")
    ) {
      sendJson(res, 403, {
        error: "Only the owner can read the system agent's brain trace.",
      });
      return;
    }
    const limit = Math.min(
      Math.max(Number(params.get("limit")) || DEFAULT_TRACE_TURNS, 1),
      MAX_TRACE_TURNS,
    );
    const sessionKey = `agent:${agentId}:brain`;
    const entry = await api.runtime.agent.session.getSessionEntryAsync({
      agentId,
      sessionKey,
    });
    const sessionId = entry?.sessionId?.trim();
    const turns = withFailure(
      sessionId ? await readBrainTurns({ agentId, sessionId }) : [],
      await failureOf(agentId),
    );
    sendJson(res, 200, {
      turns: turns.slice(-limit).reverse(),
      total: turns.length,
    } satisfies BrainTraceResponse);
  });
}
