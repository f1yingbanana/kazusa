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
 * refused (409) when the catalog has changed since. Without one (an older
 * Gateway gives none) it is not checked.
 */
export async function saveStatCatalog(
  catalog: StatCatalog,
  base: string | undefined,
): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/catalog"), {
    catalog,
    ...(base === undefined ? {} : { base }),
  });
  return StatsResponseSchema.parse(data);
}

export async function setStat(payload: StatSetPayload): Promise<StatsResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/stats/set"), payload);
  return StatsResponseSchema.parse(data);
}

/** What a write's response does to the snapshot. */
export interface AfterStatWrite {
  /** `undefined` only when nothing was cached and nothing came back. */
  readonly data: StatsResponse;
  /**
   * The stream changed the same thing while the request was out, and to
   * something else: the response may be the older of the two, so it is left out
   * and everything is to be read again.
   */
  readonly reread: boolean;
}

function settled<T>(
  before: StatsResponse | undefined,
  current: StatsResponse | undefined,
  response: StatsResponse,
  part: (snapshot: StatsResponse) => T,
  merged: (current: StatsResponse) => StatsResponse,
): AfterStatWrite {
  if (!current) return { data: response, reread: false };
  // Every change to a snapshot makes the changed part anew, and leaves the rest.
  if (before && part(before) === part(current))
    return { data: merged(current), reread: false };
  return {
    data: current,
    reread: JSON.stringify(part(current)) !== JSON.stringify(part(response)),
  };
}

/**
 * The snapshot after one value was set, from the write's response. Only the
 * subject's record (or the world's) is taken from it: the rest of a response is
 * as old as the server's read, and the stream may have brought newer since.
 * `before` is the snapshot as the request went out: when the stream has changed
 * that record since, the response is not put over what the stream brought.
 */
export function afterStatSet(
  before: StatsResponse | undefined,
  current: StatsResponse | undefined,
  response: StatsResponse,
  { characterId }: Pick<StatSetPayload, "characterId">,
): AfterStatWrite {
  return settled(
    before,
    current,
    response,
    (snapshot) =>
      characterId === undefined
        ? snapshot.world
        : snapshot.records[characterId],
    (current) => {
      if (characterId === undefined)
        return { ...current, world: response.world };
      const { [characterId]: _, ...others } = current.records;
      const record = response.records[characterId];
      return {
        ...current,
        records: record ? { ...others, [characterId]: record } : others,
      };
    },
  );
}

/**
 * The snapshot after the definitions were saved, from the save's response;
 * records stay. Definitions the stream replaced while the request was out are
 * not put back.
 */
export function afterStatCatalog(
  before: StatsResponse | undefined,
  current: StatsResponse | undefined,
  response: StatsResponse,
): AfterStatWrite {
  return settled(
    before,
    current,
    response,
    (snapshot) => snapshot.catalog,
    (current) => ({
      ...current,
      catalog: response.catalog,
      revision: response.revision,
    }),
  );
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
