import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedStore,
  resetStateCaches,
  stateCacheStats,
  type StateStore,
} from "./state.ts";

/** An in-memory native store, counting what reaches it. */
function nativeStore() {
  const values = new Map<string, string>();
  const store = {
    lookup: vi.fn(async (key: string) => values.get(key)),
    register: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    entries: vi.fn(async () =>
      [...values].map(([key, value]) => ({ key, value, createdAt: 0 })),
    ),
  } satisfies StateStore<string>;
  return { values, store };
}

const stats = (namespace: string) =>
  stateCacheStats().find((entry) => entry.namespace === namespace);

describe("cachedStore", () => {
  beforeEach(resetStateCaches);

  it("answers repeat reads from memory and writes through", async () => {
    const { values, store } = nativeStore();
    values.set("alice", "reading");
    const cached = cachedStore("test-reads", store);
    expect(await cached.lookup("alice")).toBe("reading");
    expect(await cached.lookup("alice")).toBe("reading");
    expect(await cached.lookup("bob")).toBeUndefined();
    expect(await cached.lookup("bob")).toBeUndefined();
    expect(store.lookup).toHaveBeenCalledTimes(2);
    await cached.register("alice", "sleeping");
    expect(values.get("alice")).toBe("sleeping");
    expect(await cached.lookup("alice")).toBe("sleeping");
    expect(store.lookup).toHaveBeenCalledTimes(2);
    expect(stats("test-reads")).toMatchObject({
      entries: 2,
      hits: 3,
      misses: 2,
      evictions: 0,
    });
  });

  it("shares one cache per store between registrations", async () => {
    const { store } = nativeStore();
    const first = cachedStore("test-shared", store);
    const second = cachedStore("test-shared", store);
    await first.register("alice", "eating");
    expect(await second.lookup("alice")).toBe("eating");
    expect(store.lookup).not.toHaveBeenCalled();
  });

  it("keeps at most its limit, dropping the least recently used, and says so once", async () => {
    const { store } = nativeStore();
    const warn = vi.fn();
    const cached = cachedStore("test-bound", store, { limit: 2, warn });
    await cached.register("a", "1");
    await cached.register("b", "2");
    // Reading `a` makes `b` the least recently used.
    await cached.lookup("a");
    await cached.register("c", "3");
    await cached.register("d", "4");
    expect(stats("test-bound")).toMatchObject({ entries: 2, evictions: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    // What left is read from the store again, still correct.
    expect(await cached.lookup("b")).toBe("2");
    expect(store.lookup).toHaveBeenCalledWith("b");
  });

  it("refuses entries that expire, which a cached copy would outlive", async () => {
    const { store } = nativeStore();
    const cached = cachedStore("test-ttl", store);
    await expect(
      cached.register("alice", "brief", { ttlMs: 1_000 }),
    ).rejects.toThrow("can't hold entries that expire");
    expect(store.register).not.toHaveBeenCalled();
  });

  it("reports roughly how much it holds", async () => {
    const { store } = nativeStore();
    const cached = cachedStore("test-size", store);
    await cached.register("alice", "x".repeat(100));
    expect(stats("test-size")?.bytes).toBeGreaterThanOrEqual(100);
  });
});
