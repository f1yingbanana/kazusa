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

function sharedCaches(): Map<string, Map<string, unknown>> {
  const scope = globalThis as {
    [SHARED_CACHES]?: Map<string, Map<string, unknown>>;
  };
  return (scope[SHARED_CACHES] ??= new Map());
}

/**
 * Write-through cache for a store read in loops over the whole cast, where each
 * native lookup is a worker round trip. Every write in the process must go
 * through the returned store.
 */
export function cachedStore<T>(
  namespace: string,
  store: StateStore<T>,
): StateStore<T> {
  const caches = sharedCaches();
  let cache = caches.get(namespace) as Map<string, T | undefined> | undefined;
  if (!cache) {
    cache = new Map();
    caches.set(namespace, cache);
  }
  const values = cache;
  return {
    entries: () => store.entries(),
    lookup: async (key) => {
      if (values.has(key)) return values.get(key);
      const value = await store.lookup(key);
      // A write that landed during this read is newer.
      if (!values.has(key)) values.set(key, value);
      return values.get(key);
    },
    register: async (key, value, options) => {
      await store.register(key, value, options);
      values.set(key, value);
    },
  };
}

export function resetStateCaches(): void {
  for (const cache of sharedCaches().values()) cache.clear();
}
