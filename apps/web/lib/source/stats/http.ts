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

/**
 * `base` is the `revision` of the catalog the change was made from. The save is
 * refused (409) when the catalog has changed since.
 */
export async function saveStatCatalog(
  catalog: StatCatalog,
  base: string,
): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/catalog"), {
    catalog,
    base,
  });
  return StatsResponseSchema.parse(data);
}

export async function setStat(payload: StatSetPayload): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/set"), payload);
  return StatsResponseSchema.parse(data);
}

/**
 * The snapshot with what one write changed, from its response: the subject's
 * record, or the world's. The rest of a response is as old as the server's
 * read, and the stream may have brought newer since, so it stays as it is.
 */
export function withStatSet(
  current: StatsResponse | undefined,
  response: StatsResponse,
  { characterId }: Pick<StatSetPayload, "characterId">,
): StatsResponse {
  if (!current) return response;
  if (characterId === undefined) return { ...current, world: response.world };
  const { [characterId]: _, ...others } = current.records;
  const record = response.records[characterId];
  return {
    ...current,
    records: record ? { ...others, [characterId]: record } : others,
  };
}

/** The snapshot with the definitions a save returned; records stay. */
export function withStatCatalog(
  current: StatsResponse | undefined,
  response: StatsResponse,
): StatsResponse {
  return current
    ? { ...current, catalog: response.catalog, revision: response.revision }
    : response;
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
