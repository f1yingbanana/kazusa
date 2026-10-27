/**
 * Keyed external store for high-frequency live state (D5). A write to one key
 * notifies only that key's subscribers plus aggregate subscribers, so a status
 * delta for one of 300 characters re-renders one row.
 */
export interface KeyedStore<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  /** Replaces all values (snapshot seed). */
  reset(entries: Iterable<readonly [string, V]>): void;
  values(): IterableIterator<V>;
  subscribeKey(key: string, listener: () => void): () => void;
  /** Aggregate subscription; `version()` changes on every write. */
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createKeyedStore<V>(): KeyedStore<V> {
  const data = new Map<string, V>();
  const keyListeners = new Map<string, Set<() => void>>();
  const allListeners = new Set<() => void>();
  let version = 0;

  function notify(keys: Iterable<string>) {
    version += 1;
    for (const key of keys) {
      for (const listener of keyListeners.get(key) ?? []) listener();
    }
    for (const listener of allListeners) listener();
  }

  return {
    get: (key) => data.get(key),
    set(key, value) {
      data.set(key, value);
      notify([key]);
    },
    reset(entries) {
      const touched = new Set(data.keys());
      data.clear();
      for (const [key, value] of entries) {
        data.set(key, value);
        touched.add(key);
      }
      notify(touched);
    },
    values: () => data.values(),
    subscribeKey(key, listener) {
      let set = keyListeners.get(key);
      if (!set) keyListeners.set(key, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) keyListeners.delete(key);
      };
    },
    subscribe(listener) {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    },
    version: () => version,
  };
}

/** Single-value external store. */
export interface ValueStore<V> {
  get(): V;
  set(value: V): void;
  subscribe(listener: () => void): () => void;
}

export function createValueStore<V>(initial: V): ValueStore<V> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
