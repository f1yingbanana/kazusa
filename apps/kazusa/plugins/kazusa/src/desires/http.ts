import { currentConfig } from "../current-config.ts";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { DesireRecord, DesiresResponse } from "@kazusa/client";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import type { DesiresService } from "./register.ts";

/**
 * Serves the closed-form desire records so observers compute levels at any sim
 * time themselves, and pushes each re-anchored record as an SSE `desires`
 * event. Desire values stay out of Markdown and ledgers.
 */
export function registerDesiresHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly desires: DesiresService;
    readonly broadcaster: KazusaRealtimeBroadcaster;
  },
): void {
  const getConfig = () => currentConfig(api);
  const route = createRouteRegistrar(api);
  const { desires, broadcaster } = deps;

  desires.onChange((agentId, record) => {
    broadcaster.broadcast({
      type: "desires",
      characterId: agentId,
      record: record satisfies DesireRecord,
    });
  });

  route("desires", "GET", async (_req, res) => {
    const agentIds = [...new Set(listAgentIds(getConfig()))];
    const records: Record<string, DesireRecord> = {};
    await Promise.all(
      agentIds.map(async (agentId) => {
        const record = await desires.store.lookup(agentId);
        if (record) records[agentId] = record;
      }),
    );
    const { states, initial, catalog } = desires.config;
    sendJson(res, 200, {
      config: { states, initial, catalog },
      records,
    } satisfies DesiresResponse);
  });
}
