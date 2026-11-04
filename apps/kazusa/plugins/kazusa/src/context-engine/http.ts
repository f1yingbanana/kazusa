import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import {
  ContextSettingsSavePayloadSchema,
  type ContextResponse,
  type ContextSettingsResponse,
} from "@kazusa/client";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { ContextEngineService } from "./register.ts";
import { contextSettings, contextSettingsBase } from "./settings.ts";

/**
 * Serves what each brain turn was given (`GET /kazusa/context?id=`), and the
 * world's and each character's context settings (`GET /kazusa/context/settings
 * [?agentId=]`, `POST /kazusa/context/settings/save`).
 */
export function registerContextHttp(
  api: OpenClawPluginApi,
  deps: { readonly context: ContextEngineService },
): void {
  const route = createRouteRegistrar(api);
  const settings = contextSettings(api);
  const base = () => contextSettingsBase(api.pluginConfig);
  const unknownAgent = (agentId: string | undefined): boolean =>
    agentId !== undefined &&
    !listAgentIds(currentConfig(api)).includes(agentId);

  route("context", "GET", async (req, res) => {
    const id = new URL(req.url ?? "/", "http://localhost").searchParams.get(
      "id",
    );
    if (!id) {
      sendJson(res, 400, { error: "Missing required id query parameter." });
      return;
    }
    sendJson(res, 200, {
      contexts: await deps.context.recentContexts(id),
    } satisfies ContextResponse);
  });

  const read = async (
    agentId: string | undefined,
  ): Promise<ContextSettingsResponse> => {
    const resolved = await settings.resolve(base(), agentId);
    // The model's own window, as the host last resolved it for their brain.
    const window =
      agentId === undefined
        ? undefined
        : (
            await api.runtime.agent.session.getSessionEntryAsync({
              agentId,
              sessionKey: `agent:${agentId}:brain`,
            })
          )?.contextTokens;
    return {
      ...(agentId === undefined ? {} : { agentId }),
      ...resolved,
      ...(window ? { modelContextTokens: window } : {}),
    };
  };

  route("context/settings", "GET", async (req, res) => {
    const agentId =
      new URL(req.url ?? "/", "http://localhost").searchParams.get("agentId") ??
      undefined;
    if (unknownAgent(agentId)) {
      sendJson(res, 404, { error: `Unknown agent: ${agentId}.` });
      return;
    }
    sendJson(res, 200, await read(agentId));
  });

  route("context/settings/save", "POST", async (req, res) => {
    const { agentId, overrides } = ContextSettingsSavePayloadSchema.parse(
      await readJsonBody(req),
    );
    if (unknownAgent(agentId)) {
      sendJson(res, 404, { error: `Unknown agent: ${agentId}.` });
      return;
    }
    await settings.save(overrides, agentId);
    sendJson(res, 200, await read(agentId));
  });
}
