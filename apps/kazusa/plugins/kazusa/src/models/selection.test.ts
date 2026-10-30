import { describe, expect, it } from "vitest";
import { createModelSelection, type ModelSelection } from "./selection.ts";

function memoryStore() {
  const rows = new Map<string, ModelSelection>();
  return {
    rows,
    lookup: async (key: string) => rows.get(key),
    register: async (key: string, value: ModelSelection) => {
      rows.set(key, value);
    },
    entries: async () =>
      [...rows].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
}

describe("model selection", () => {
  it("inherits each field without copying world defaults into the agent record", async () => {
    const store = memoryStore();
    const selection = createModelSelection(store);
    await selection.update({ model: "zai/world", thinking: "low" });
    await selection.update({ thinking: "high" }, "airi");
    await selection.update({ model: "venice/kazusa" }, "kazusa");
    await selection.update({ model: "zai/new-world", thinking: "off" });
    expect(store.rows.get("agent:airi")).toEqual({ thinking: "high" });
    expect(await selection.read("airi")).toEqual({
      model: "zai/new-world",
      thinking: "high",
    });
    expect(await selection.read("kazusa")).toEqual({
      model: "venice/kazusa",
      thinking: "off",
    });
    // A fresh registration reads the retained choices with no in-memory cache.
    const reloaded = createModelSelection(store);
    expect(await reloaded.read("airi")).toEqual(await selection.read("airi"));
    await reloaded.update({ thinking: undefined }, "airi");
    expect(await selection.read("airi")).toEqual({
      model: "zai/new-world",
      thinking: "off",
    });
    expect(await selection.overrides("airi")).toEqual({});
  });

  it("preserves concurrent model and thinking patches across registrations", async () => {
    const store = memoryStore();
    const first = createModelSelection(store);
    const second = createModelSelection(store);
    await Promise.all([
      first.update({ model: "zai/airi" }, "airi"),
      second.update({ thinking: "high" }, "airi"),
      second.update({ model: "venice/world" }),
      first.update({ thinking: "low" }),
    ]);
    expect(await first.read()).toEqual({
      model: "venice/world",
      thinking: "low",
    });
    expect(await first.overrides("airi")).toEqual({
      model: "zai/airi",
      thinking: "high",
    });
  });
});
