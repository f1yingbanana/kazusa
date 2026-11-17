import {
  StatsResponseSchema,
  type StatCatalog,
  type StatSetPayload,
  type StatsResponse,
  type StatsStreamEvent,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const STATS_KEY = "kazusa/stats";

export async function fetchStats(): Promise<StatsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/stats"));
  return StatsResponseSchema.parse(data);
}

export async function saveStatCatalog(
  catalog: StatCatalog,
): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/catalog"), {
    catalog,
  });
  return StatsResponseSchema.parse(data);
}

export async function setStat(payload: StatSetPayload): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/set"), payload);
  return StatsResponseSchema.parse(data);
}

/**
 * The snapshot with one subject's record replaced, as SSE `stats` sends it.
 * Nothing to patch (no snapshot yet, or the definitions changed) is
 * `undefined`: refetch.
 */
export function withStatsEvent(
  current: StatsResponse | undefined,
  event: StatsStreamEvent,
): StatsResponse | undefined {
  if (!current || !event.record) return undefined;
  return event.characterId === undefined
    ? { ...current, world: event.record.own }
    : {
        ...current,
        records: { ...current.records, [event.characterId]: event.record },
      };
}
