import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  StatCatalogSavePayloadSchema,
  StatSetPayloadSchema,
  type StatRecord,
  type StatsResponse,
} from "@kazusa/client";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { StatsService } from "./register.ts";

/**
 * Serves the world's states and what each stands at (`GET /kazusa/stats`), and
 * lets the user define them (`POST /kazusa/stats/catalog`) and set a value
 * (`POST /kazusa/stats/set`).
 */
export function registerStatsHttp(
  api: OpenClawPluginApi,
  deps: { readonly stats: StatsService; readonly clock: Clock },
): void {
  const route = createRouteRegistrar(api);
  const { stats, clock } = deps;
  const user = api.pluginConfig?.user as { readonly id?: string } | undefined;

  const read = async (): Promise<StatsResponse> => {
    const ids = [
      ...new Set([
        ...listAgentIds(currentConfig(api)),
        user?.id ?? "user:sensei",
      ]),
    ];
    const records: Record<string, StatRecord> = {};
    await Promise.all(
      ids.map(async (id) => {
        const record = await stats.record(id);
        if (record) records[id] = record;
      }),
    );
    return {
      catalog: stats.catalog(),
      records,
      world: (await stats.world())?.own ?? {},
      outfits: Object.fromEntries(
        ids.flatMap((id) => {
          const outfits = stats.outfits(id);
          return outfits.length ? [[id, [...outfits]]] : [];
        }),
      ),
    };
  };

  /** A request the user can fix says what is wrong with it. */
  const refused = (error: unknown): string =>
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : String(error instanceof Error ? error.message : error);

  route("stats", "GET", async (_req, res) => {
    sendJson(res, 200, await read());
  });

  route("stats/catalog", "POST", async (req, res) => {
    const parsed = StatCatalogSavePayloadSchema.safeParse(
      await readJsonBody(req),
    );
    if (!parsed.success) {
      sendJson(res, 400, { error: refused(parsed.error) });
      return;
    }
    stats.saveCatalog(parsed.data.catalog);
    sendJson(res, 200, await read());
  });

  route("stats/set", "POST", async (req, res) => {
    const parsed = StatSetPayloadSchema.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { error: refused(parsed.error) });
      return;
    }
    await clock.init();
    try {
      await stats.set(parsed.data, "user");
    } catch (error) {
      sendJson(res, 400, { error: refused(error) });
      return;
    }
    sendJson(res, 200, await read());
  });
}
