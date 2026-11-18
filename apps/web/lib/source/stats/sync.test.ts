import { describe, expect, it } from "vitest";
import {
  StatsResponseSchema,
  type StatsResponse,
  type StatsStreamEvent,
} from "@kazusa/client";
import { statsSync } from "./sync";

const entry = (value: number) => ({ value, at: 1, by: "user" as const });
const snapshot = (
  revision: string,
  records: StatsResponse["records"] = {},
): StatsResponse => ({
  catalog: [],
  revision,
  records,
  world: {},
  outfits: {},
});
const record = (id: string, hp: number): StatsStreamEvent => ({
  type: "stats",
  characterId: id,
  record: { own: { hp: entry(hp) }, toward: {} },
});

/** A cache and reads that land when the test says. */
function harness(cached?: StatsResponse) {
  const reads: ((value: StatsResponse | Error) => void)[] = [];
  const sync = statsSync({
    read: () =>
      new Promise((resolve, reject) => {
        reads.push((value) =>
          value instanceof Error ? reject(value) : resolve(value),
        );
      }),
    write: async (data) => {
      cached = typeof data === "function" ? data(cached) : data;
      return cached;
    },
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  return { sync, reads, settle, cache: () => cached };
}

describe("a Gateway from before catalogs had a revision", () => {
  it("is still read", () => {
    const { revision: _, ...older } = snapshot("r");
    expect(StatsResponseSchema.parse(older).revision).toBeUndefined();
  });
});

describe("the states snapshot under the stream", () => {
  it("keeps a read of new definitions when a record event lands first", async () => {
    const h = harness(snapshot("old", { airi: { own: {}, toward: {} } }));
    h.sync.event({ type: "stats", catalog: true });
    h.sync.event(record("natsu", 7));
    expect(h.reads).toHaveLength(1);
    // The read is as the server stood before natsu changed.
    h.reads[0](snapshot("new"));
    await h.settle();
    expect(h.cache()?.revision).toBe("new");
    expect(h.cache()?.records.natsu?.own.hp?.value).toBe(7);
  });

  it("lets only the latest read land", async () => {
    const h = harness(snapshot("old"));
    h.sync.refresh();
    h.sync.refresh();
    h.reads[0](snapshot("first"));
    await h.settle();
    expect(h.cache()?.revision).toBe("old");
    h.reads[1](snapshot("second"));
    await h.settle();
    expect(h.cache()?.revision).toBe("second");
  });

  it("reads everything when there is nothing to patch", async () => {
    const h = harness();
    h.sync.event(record("airi", 3));
    await h.settle();
    expect(h.reads).toHaveLength(1);
    h.reads[0](snapshot("new"));
    await h.settle();
    expect(h.cache()?.records.airi?.own.hp?.value).toBe(3);
  });

  it("asks again at the next event after a read fails", async () => {
    const h = harness(snapshot("old"));
    h.sync.refresh();
    h.reads[0](new Error("offline"));
    await h.settle();
    h.sync.event(record("airi", 3));
    expect(h.reads).toHaveLength(2);
    h.reads[1](
      snapshot("new", { airi: { own: { hp: entry(3) }, toward: {} } }),
    );
    await h.settle();
    expect(h.cache()?.revision).toBe("new");
  });
});
