import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Instantiate the SDK's generic factory in type space only.
declare const openKeyedStore: OpenClawPluginApi["runtime"]["state"]["openKeyedStore"];

/** Narrow native store contract, also usable by in-memory test stores. */
export type StateStore<T> = Pick<
  ReturnType<typeof openKeyedStore<T>>,
  "lookup" | "register" | "entries"
>;

/** A store whose entries are removed once their work completes. */
export type RemovableStateStore<T> = StateStore<T> &
  Pick<ReturnType<typeof openKeyedStore<T>>, "delete">;

/*
 * OpenClaw can load this plugin more than once in one Gateway process, so
 * every instance has to share the cached values (see `realtime.ts`).
 */
const SHARED_CACHES = Symbol.for("kazusa.state-caches");

/** The most keys one store keeps in memory; the least recently used go first. */
const CACHE_LIMIT = 4_096;

/** One store's cache: values in recency order, oldest first, and its counts. */
interface StateCache {
  readonly values: Map<string, unknown>;
  hits: number;
  misses: number;
  evictions: number;
  /** Warned once that the limit was reached. */
  full: boolean;
}

function sharedCaches(): Map<string, StateCache> {
  const scope = globalThis as {
    [SHARED_CACHES]?: Map<string, StateCache>;
  };
  return (scope[SHARED_CACHES] ??= new Map<string, StateCache>());
}

/** How big each store's cache is now, and how often it answered. */
export interface StateCacheStats {
  readonly namespace: string;
  readonly entries: number;
  /** Serialized size of the cached values, roughly what they hold. */
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/** Every cached store's size and counts, for monitoring. */
export function stateCacheStats(): StateCacheStats[] {
  return [...sharedCaches()].map(([namespace, cache]) => ({
    namespace,
    entries: cache.values.size,
    bytes: [...cache.values].reduce(
      (sum, [key, value]) =>
        sum + key.length + (JSON.stringify(value)?.length ?? 0),
      0,
    ),
    hits: cache.hits,
    misses: cache.misses,
    evictions: cache.evictions,
  }));
}

/**
 * Write-through cache for a store Kazusa alone writes, read on every brain
 * build and decision, where each native lookup waits in OpenClaw's shared
 * database queue. Every write in the process must go through a store this
 * returns for the same namespace, and none may expire (`ttlMs`): a cached copy
 * would outlive it. At most `limit` keys stay in memory, the least recently
 * used leaving first; `warn` hears once if a store fills up, which a cast-sized
 * store never should.
 */
export function cachedStore<T>(
  namespace: string,
  store: StateStore<T>,
  {
    limit = CACHE_LIMIT,
    warn,
  }: {
    readonly limit?: number;
    readonly warn?: (message: string) => void;
  } = {},
): StateStore<T> {
  const caches = sharedCaches();
  let cache = caches.get(namespace);
  if (!cache) {
    cache = {
      values: new Map(),
      hits: 0,
      misses: 0,
      evictions: 0,
      full: false,
    };
    caches.set(namespace, cache);
  }
  const state = cache;
  const { values } = state;
  /** Most recent last; the oldest leaves when the store is full. */
  const remember = (key: string, value: T | undefined): void => {
    values.delete(key);
    values.set(key, value);
    if (values.size <= limit) return;
    const [oldest] = values.keys();
    values.delete(oldest);
    state.evictions += 1;
    if (!state.full) {
      state.full = true;
      warn?.(
        `Kazusa state cache "${namespace}" reached ${limit} keys; the least recently used are dropped.`,
      );
    }
  };
  return {
    entries: () => store.entries(),
    lookup: async (key) => {
      if (values.has(key)) {
        state.hits += 1;
        const value = values.get(key) as T | undefined;
        remember(key, value);
        return value;
      }
      state.misses += 1;
      const value = await store.lookup(key);
      // A write that landed during this read is newer.
      if (!values.has(key)) remember(key, value);
      return values.get(key) as T | undefined;
    },
    register: async (key, value, options) => {
      if (options?.ttlMs !== undefined)
        throw new Error(
          `Kazusa state cache "${namespace}" can't hold entries that expire.`,
        );
      await store.register(key, value, options);
      remember(key, value);
    },
  };
}

export function resetStateCaches(): void {
  for (const cache of sharedCaches().values()) {
    cache.values.clear();
    cache.hits = cache.misses = cache.evictions = 0;
    cache.full = false;
  }
}
