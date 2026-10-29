import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerModels } from "./register.ts";
import type { ModelSelection } from "./selection.ts";

type Hook = (event: unknown, ctx: { sessionKey?: string }) => Promise<unknown>;

function setup(selected: ModelSelection) {
  const hooks: Record<string, Hook> = {};
  const api = {
    config: {},
    registerHttpRoute: vi.fn(),
    on: vi.fn((name: string, hook: Hook) => {
      hooks[name] = hook;
    }),
    runtime: {
      state: {
        openKeyedStore: () => ({
          lookup: async () => selected,
          register: vi.fn(),
          entries: async () => [],
        }),
      },
    },
  } as unknown as OpenClawPluginApi;
  registerModels(api);
  return hooks.before_model_resolve;
}

describe("registerModels", () => {
  it("runs brain turns on the picked model", async () => {
    const hook = setup({ model: "openrouter/anthropic/claude-opus" });
    expect(
      await hook({ prompt: "" }, { sessionKey: "agent:airi:brain" }),
    ).toEqual({
      providerOverride: "openrouter",
      modelOverride: "anthropic/claude-opus",
    });
  });

  it("leaves other sessions, and an unpicked world, to OpenClaw", async () => {
    const picked = setup({ model: "venice/qwen3" });
    expect(
      await picked({ prompt: "" }, { sessionKey: "agent:airi:chat:direct:x" }),
    ).toBeUndefined();
    const unpicked = setup({});
    expect(
      await unpicked({ prompt: "" }, { sessionKey: "agent:airi:brain" }),
    ).toBeUndefined();
  });
});
