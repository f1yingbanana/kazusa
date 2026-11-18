import { describe, expect, it } from "vitest";
import {
  StatsResponseSchema,
  type StatsResponse,
  type StatsStreamEvent,
} from "@kazusa/client";
import { RETRY_MS, statsSync } from "./sync";

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
      await held;
      cached = typeof data === "function" ? data(cached) : data;
      return cached;
    },
    stale: (stale) => stales.push(stale),
    later: (run, ms) => {
      const waiting = { run, ms };
      retries.push(waiting);
      return () => retries.splice(retries.indexOf(waiting), 1);
    },
  });
  const stales: boolean[] = [];
  /** Writes wait while this is set, as a cache write that takes a while. */
  let held: Promise<void> | undefined;
  const holdWrites = (): (() => void) => {
    let release = (): void => {};
    held = new Promise((resolve) => (release = resolve));
    return () => {
      held = undefined;
      release();
    };
  };
  /** Retries waiting to run: what a timer would hold. */
  const retries: { run: () => void; ms: number }[] = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve));
  return {
    sync,
    reads,
    retries,
    stales,
    settle,
    holdWrites,
    cache: () => cached,
  };
}

describe("an outfit named in a way no state's value could be", () => {
  it("does not keep the states from loading", () => {
    const outfits = { natsu: [{ name: "uniform: summer" }, { name: "" }] };
    expect(
      StatsResponseSchema.parse({ ...snapshot("r"), outfits }).outfits,
    ).toEqual(outfits);
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

  it("tries a failed read again by itself, with nothing new on the stream", async () => {
    const h = harness(snapshot("old"));
    h.sync.refresh();
    h.reads[0](new Error("down"));
    await h.settle();
    expect(h.retries.map(({ ms }) => ms)).toEqual([1_000]);
    h.retries[0].run();
    h.reads[1](new Error("still down"));
    await h.settle();
    expect(h.retries.map(({ ms }) => ms)).toEqual([2_000]);
    h.retries[0].run();
    h.reads[2](snapshot("new"));
    await h.settle();
    expect(h.cache()?.revision).toBe("new");
    // Back to the first wait after a read that worked.
    h.sync.refresh();
    h.reads[3](new Error("down"));
    await h.settle();
    expect(h.retries.at(-1)?.ms).toBe(1_000);
  });

  it("calls a waiting retry off when another read starts or it stops", async () => {
    const h = harness(snapshot("old"));
    h.sync.refresh();
    h.reads[0](new Error("down"));
    await h.settle();
    expect(h.retries).toHaveLength(1);
    h.sync.event({ type: "stats", catalog: true });
    expect(h.retries).toHaveLength(0);
    h.reads[1](new Error("down"));
    await h.settle();
    expect(h.retries).toHaveLength(1);
    h.sync.stop();
    expect(h.retries).toHaveLength(0);
  });

  it("stops trying by itself after the last wait", async () => {
    const h = harness(snapshot("old"));
    h.sync.refresh();
    for (let read = 0; read < RETRY_MS.length; read += 1) {
      h.reads[read](new Error("down"));
      await h.settle();
      h.retries[0].run();
    }
    expect(h.stales).toEqual([]);
    h.reads[RETRY_MS.length](new Error("down"));
    await h.settle();
    expect(h.retries).toHaveLength(0);
    // Nothing is trying any more: whoever shows the states is told so.
    expect(h.stales).toEqual([true]);
    h.sync.event({ type: "stats", catalog: true });
    h.reads[RETRY_MS.length + 1](snapshot("new"));
    await h.settle();
    expect(h.stales).toEqual([true, false]);
  });

  it("says when a whole read has landed, with what arrived during it kept", async () => {
    const h = harness(snapshot("old"));
    let landed = false;
    const whole = h.sync.whole().then(() => (landed = true));
    h.sync.event(record("natsu", 7));
    await h.settle();
    expect(landed).toBe(false);
    h.reads[0](snapshot("new"));
    await whole;
    expect(h.cache()?.revision).toBe("new");
    expect(h.cache()?.records.natsu?.own.hp?.value).toBe(7);
  });

  it("follows the read that overtook it, without waiting for the one overtaken", async () => {
    const h = harness(snapshot("old"));
    let landed = false;
    const whole = h.sync.whole().then(() => (landed = true));
    h.sync.event({ type: "stats", catalog: true });
    // The newer read lands while the first is still out.
    h.reads[1](snapshot("new"));
    await whole;
    expect(landed).toBe(true);
    expect(h.cache()?.revision).toBe("new");
    // And the first, arriving at last, changes nothing.
    h.reads[0](snapshot("stale"));
    await h.settle();
    expect(h.cache()?.revision).toBe("new");
  });

  it("throws when the read could not be made, or was stopped before it landed", async () => {
    const h = harness(snapshot("old"));
    const failing = h.sync.whole();
    h.reads[0](new Error("down"));
    await expect(failing).rejects.toThrow("could not be read");
    const stopped = h.sync.whole();
    h.sync.stop();
    await expect(stopped).rejects.toThrow("no longer being read");
    h.reads[1](snapshot("new"));
    await h.settle();
    expect(h.cache()?.revision).toBe("old");
    await expect(h.sync.whole()).rejects.toThrow("no longer being read");
  });

  it("is not told of a read that was still being written when it asked", async () => {
    const h = harness(snapshot("old"));
    const release = h.holdWrites();
    h.sync.refresh();
    h.reads[0](snapshot("first"));
    await h.settle();
    // Asked while the first read is on its way into the cache.
    let landed = false;
    const whole = h.sync.whole().then(() => (landed = true));
    release();
    await h.settle();
    expect(landed).toBe(false);
    h.reads[1](snapshot("second"));
    await whole;
    expect(h.cache()?.revision).toBe("second");
  });
});
