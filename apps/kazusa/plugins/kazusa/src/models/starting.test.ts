import type { ModelOption } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { MODELS_CONFIG } from "./config.ts";
import { createStartingModel, startingModel } from "./starting.ts";
import type { ModelSelection } from "./selection.ts";

const model = (
  provider: string,
  id: string,
  name: string,
  available = true,
): ModelOption => ({
  ref: `${provider}/${id}`,
  provider,
  id,
  name,
  available,
  thinkingLevels: [],
});

const CATALOG = [
  model("venice", "xiaomi-mimo-v2-6-flash", "MiMo-V2.6-Flash"),
  model("venice", "deepseek-v4-1-flash", "DeepSeek V4.1 Flash"),
  model("zai", "glm-5.3-flashx", "glm-5.3-flashx"),
  model("zai", "glm-5.3-flash", "GLM-5.3-Flash"),
  model("openrouter", "z-ai/glm-5.3-flash", "Z.ai: GLM 5.3 Flash"),
  model("openrp", "zai/glm-5.3-flash", "GLM-5.3-Flash (OX Alpha)"),
  model("openrp", "deepseek/deepseek-flash", "DeepSeek V4.1 Flash"),
];

const config = MODELS_CONFIG.parse({});

describe("startingModel", () => {
  it("takes the best starting model through the first listed provider", () => {
    expect(startingModel(CATALOG, config)).toBe("openrp/zai/glm-5.3-flash");
    expect(
      startingModel(
        CATALOG.filter(({ provider }) => provider !== "openrp"),
        config,
      ),
    ).toBe("openrouter/z-ai/glm-5.3-flash");
    // Unlisted providers keep the catalog's order.
    expect(
      startingModel(
        CATALOG.filter(({ provider }) => provider === "zai"),
        config,
      ),
    ).toBe("zai/glm-5.3-flash");
  });

  it("matches by name where ids differ, and moves down the list", () => {
    const noGlm = CATALOG.filter(({ id }) => !id.includes("glm"));
    expect(startingModel(noGlm, config)).toBe("venice/xiaomi-mimo-v2-6-flash");
    expect(
      startingModel(
        noGlm.filter(({ id }) => !id.includes("mimo")),
        config,
      ),
    ).toBe("openrp/deepseek/deepseek-flash");
  });

  it("skips models that can't run, and has none when nothing matches", () => {
    expect(
      startingModel(
        [model("openrp", "zai/glm-5.3-flash", "GLM", false)],
        config,
      ),
    ).toBeUndefined();
  });
});

describe("createStartingModel", () => {
  const store = () => {
    const rows = new Map<string, ModelSelection>();
    return {
      rows,
      lookup: async (key: string) => rows.get(key),
      register: async (key: string, value: ModelSelection) => {
        rows.set(key, value);
      },
      entries: async () => [],
    };
  };

  it("keeps what it worked out, and keeps it through a catalog not ready yet", async () => {
    const rows = store();
    const starting = createStartingModel(rows, config);
    await starting.update(CATALOG);
    expect(await starting.current()).toBe("openrp/zai/glm-5.3-flash");
    await starting.update([]);
    expect(await starting.current()).toBe("openrp/zai/glm-5.3-flash");
    await starting.update([model("anthropic", "claude", "Claude")]);
    expect(await starting.current()).toBeUndefined();
  });

  it("makes a turn wait for the one being worked out", async () => {
    const starting = createStartingModel(store(), config);
    let resolve: (models: ModelOption[]) => void = () => {};
    void starting.updateFrom(new Promise((done) => (resolve = done)));
    const current = starting.current();
    resolve(CATALOG);
    expect(await current).toBe("openrp/zai/glm-5.3-flash");
  });
});
