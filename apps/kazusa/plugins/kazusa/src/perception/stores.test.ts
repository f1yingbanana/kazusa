import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createPluginStateKeyedStore } from "openclaw/plugin-sdk/plugin-state-store-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPerceptionStores } from "./stores.ts";

const MIGRATION = Symbol.for("kazusa.perception.storeMigration");

/** OpenClaw's real keyed stores, under the test state directory. */
function setup() {
  const pluginId = `kazusa-test-${randomUUID()}`;
  // One store object per namespace, so a test can spy on it.
  const opened = new Map<string, unknown>();
  const open = (namespace: string) => {
    if (!opened.has(namespace))
      opened.set(
        namespace,
        createPluginStateKeyedStore(pluginId, {
          namespace,
          retention: "retained",
        }),
      );
    return opened.get(namespace) as ReturnType<
      typeof createPluginStateKeyedStore
    >;
  };
  const warn = vi.fn();
  const api = {
    runtime: {
      state: {
        openKeyedStore: (options: { namespace: string }) =>
          open(options.namespace),
      },
    },
    logger: { info: vi.fn(), warn },
  } as unknown as OpenClawPluginApi;
  return { api, open, warn };
}

describe("openPerceptionStores", () => {
  beforeEach(() => {
    delete (globalThis as { [MIGRATION]?: unknown })[MIGRATION];
  });

  it("moves the old namespace's inbox records before emptying it", async () => {
    const { api, open } = setup();
    const legacy = open("perception");
    const agent = `momoi-${randomUUID()}`;
    await legacy.register(agent, { pending: [{ id: "waiting" }] });
    await legacy.register("yuzu", { pending: [] });
    await legacy.register(`${agent}:decision:1`, {
      action: "IGNORE",
      delayMs: 0,
      source: "model",
      question: "wake_decision",
      stimulusIds: ["text"],
      simTime: 1_000,
      wallTime: 2_000,
    });
    // Already moved, and changed since: the newer record wins.
    await open("inbox").register("yuzu", { pending: [{ id: "new" }] });

    const stores = openPerceptionStores(api);
    const inbox = await stores.inbox.entries();
    expect(
      Object.fromEntries(inbox.map(({ key, value }) => [key, value])),
    ).toEqual({
      [agent]: { pending: [{ id: "waiting" }] },
      yuzu: { pending: [{ id: "new" }] },
    });
    expect(await legacy.entries()).toEqual([]);
    // Old decisions are dropped: they can't say what they were about.
    expect(stores.decisions.window({ limit: 10, actors: [agent] })).toEqual([]);
  });

  it("keeps the old namespace when the copy fails, and tries again", async () => {
    const { api, open, warn } = setup();
    const legacy = open("perception");
    await legacy.register("momoi", { pending: [{ id: "waiting" }] });
    const register = vi
      .spyOn(open("inbox"), "register")
      .mockRejectedValueOnce(new Error("disk full"));
    const stores = openPerceptionStores(api);

    await expect(stores.inbox.lookup("momoi")).rejects.toThrow("disk full");
    expect(warn).toHaveBeenCalledOnce();
    expect((await legacy.entries()).map(({ key }) => key)).toEqual(["momoi"]);

    // The next access finishes the move.
    expect(await stores.inbox.lookup("momoi")).toEqual({
      pending: [{ id: "waiting" }],
    });
    expect(register).toHaveBeenCalledTimes(2);
    expect(await legacy.entries()).toEqual([]);
  });
});
