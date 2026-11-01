import { UsageResponseSchema, type UsageResponse } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import {
  createRouteRegistrar,
  resolveAuthToken,
  sendJson,
} from "../http/helpers.ts";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;
const REQUEST_TIMEOUT_MS = 60_000;

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

interface SessionsUsageResult {
  readonly startDate: string;
  readonly endDate: string;
  readonly totals: unknown;
  readonly cacheStatus?: { readonly status?: string };
  readonly aggregates: {
    readonly sessionCount: number;
    readonly messages: unknown;
    readonly byAgent: unknown;
    readonly byModel: unknown;
    readonly daily: unknown;
  };
}

/** The parts of OpenClaw's report the client shows. */
export function toUsageResponse(result: SessionsUsageResult): UsageResponse {
  const { aggregates } = result;
  return UsageResponseSchema.parse({
    startDate: result.startDate,
    endDate: result.endDate,
    totals: result.totals,
    sessionCount: aggregates.sessionCount,
    messages: aggregates.messages,
    byAgent: aggregates.byAgent,
    byModel: aggregates.byModel,
    daily: aggregates.daily,
    partial: (result.cacheStatus?.status ?? "fresh") !== "fresh",
  });
}

/**
 * Serves OpenClaw's own usage report. `api.runtime.gateway.request` is reserved
 * for bundled and official plugins, so this asks the Gateway the way its CLI
 * does, with the token this plugin already authenticates routes with. Nothing
 * here counts tokens: `sessions.usage` is the one source.
 */
export function registerUsageHttp(api: OpenClawPluginApi): void {
  createRouteRegistrar(api)("usage", "GET", async (req, res) => {
    const days = Number(
      new URL(req.url ?? "/", "http://localhost").searchParams.get("days"),
    );
    const span = Math.min(Math.max(days || DEFAULT_DAYS, 1), MAX_DAYS);
    const now = Date.now();
    const result = (await callGatewayFromCli(
      "sessions.usage",
      {
        token: resolveAuthToken(api),
        timeout: String(REQUEST_TIMEOUT_MS),
        json: true,
      },
      {
        agentScope: "all",
        // The aggregates cover every session; this only bounds the session list.
        limit: 1,
        startDate: utcDate(now - (span - 1) * DAY_MS),
        endDate: utcDate(now),
      },
      { progress: false },
    )) as unknown as SessionsUsageResult;
    sendJson(res, 200, toUsageResponse(result));
  });
}
