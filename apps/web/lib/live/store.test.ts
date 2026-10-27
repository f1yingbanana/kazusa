import { describe, expect, it, vi } from "vitest";
import { createKeyedStore } from "./store";

describe("keyed live store", () => {
  it("notifies only the written key plus aggregate subscribers", () => {
    const store = createKeyedStore<number>();
    const alice = vi.fn();
    const bob = vi.fn();
    const all = vi.fn();
    store.subscribeKey("alice", alice);
    store.subscribeKey("bob", bob);
    store.subscribe(all);

    store.set("alice", 1);
    expect(alice).toHaveBeenCalledTimes(1);
    expect(bob).not.toHaveBeenCalled();
    expect(all).toHaveBeenCalledTimes(1);
    expect(store.get("alice")).toBe(1);
  });
  it("reset notifies keys that were removed as well as added", () => {
    const store = createKeyedStore<number>();
    store.set("alice", 1);
    const alice = vi.fn();
    store.subscribeKey("alice", alice);
    const before = store.version();
    store.reset([["bob", 2]]);
    expect(alice).toHaveBeenCalledTimes(1);
    expect(store.get("alice")).toBeUndefined();
    expect(store.version()).toBeGreaterThan(before);
  });
});
