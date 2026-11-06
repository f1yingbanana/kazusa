import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerModels } from "./register.ts";
import type { ModelSelection } from "./selection.ts";

type Hook = (event: unknown, ctx: { sessionKey?: string }) => Promise<unknown>;

function setup(
  selected: ModelSelection,
  agents: Record<string, ModelSelection> = {},
  config: Record<string, unknown> = {},
  call: (method: string, params: unknown) => Promise<unknown> = vi.fn(),
  isKeyConfigured: (provider: string) => boolean = () => true,
) {
  const hooks: Record<string, Hook> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const api = {
    config: {},
    logger,
    registerHttpRoute: vi.fn(),
    on: vi.fn((name: string, hook: Hook) => {
      hooks[name] = hook;
    }),
    runtime: {
      config: { current: () => config },
      modelAuth: {
        isProviderApiKeyConfigured: vi.fn(
          ({ provider }: { provider: string }) => isKeyConfigured(provider),
        ),
      },
      agent: {
        resolveAgentIdentity: vi.fn((_cfg, agentId) => ({ name: agentId })),
        resolveAgentWorkspaceDir: vi.fn(() => ""),
      },
      state: {
        openKeyedStore: () => ({
          lookup: async (key: string) =>
            key === "world" ? selected : agents[key],
          register: vi.fn(async (key: string, value: ModelSelection) => {
            agents[key] = value;
          }),
          entries: async () => [],
        }),
      },
    },
  } as unknown as OpenClawPluginApi;
  registerModels(api, { call });
  return Object.assign(hooks.before_model_resolve, { hooks, logger });
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

  it("runs an unpicked world on its starting model, unless an agent has its own", async () => {
    const hook = setup(
      {},
      { starting: { model: "openrp/zai/glm-5.3-flash" } },
      {
        agents: { entries: { airi: { model: { primary: "venice/qwen3" } } } },
      },
    );
    expect(await hook({}, { sessionKey: "agent:kazusa:brain" })).toEqual({
      providerOverride: "openrp",
      modelOverride: "zai/glm-5.3-flash",
    });
    expect(await hook({}, { sessionKey: "agent:airi:brain" })).toBeUndefined();
  });

  it("works out the starting model at start, waiting out a catalog not ready yet", async () => {
    vi.useFakeTimers();
    const listing = (models: unknown[]) => ({ models });
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("Retry the request."))
      .mockResolvedValueOnce(listing([]))
      .mockResolvedValue(
        listing([
          {
            id: "zai/glm-5.3-flash",
            name: "GLM-5.3-Flash",
            provider: "openrp",
            available: true,
          },
        ]),
      );
    const hook = setup({}, {}, { agents: { entries: { arona: {} } } }, call);
    await hook.hooks.gateway_start?.({}, {});
    // A turn arriving meanwhile waits for it.
    const turn = hook({}, { sessionKey: "agent:arona:brain" });
    await vi.runAllTimersAsync();
    expect(await turn).toEqual({
      providerOverride: "openrp",
      modelOverride: "zai/glm-5.3-flash",
    });
    // A failed read is tried again like an empty one.
    expect(call).toHaveBeenCalledTimes(3);
    expect(call).toHaveBeenCalledWith("models.list", {
      agentId: "arona",
      view: "all",
    });
    vi.useRealTimers();
  });

  it("resolves the brain's owner independently of other agents", async () => {
    const hook = setup(
      { model: "venice/qwen3" },
      {
        "agent:airi": { model: "openrouter/anthropic/claude-opus" },
      },
    );
    expect(await hook({}, { sessionKey: "agent:airi:brain" })).toEqual({
      providerOverride: "openrouter",
      modelOverride: "anthropic/claude-opus",
    });
    expect(await hook({}, { sessionKey: "agent:kazusa:brain" })).toEqual({
      providerOverride: "venice",
      modelOverride: "qwen3",
    });
  });

  it("falls back to world model and logs warning when character model override has no key", async () => {
    const isKey = (p: string) => p === "openrp";
    const hook = setup(
      { model: "openrp/xiaomi/mimo-v2.6-flash" },
      {
        "agent:arona": { model: "openrouter/z-ai/glm-5.3-flash" },
      },
      {
        agents: { entries: { arona: {} } },
      },
      vi.fn(),
      isKey,
    );
    expect(await hook({}, { sessionKey: "agent:arona:brain" })).toEqual({
      providerOverride: "openrp",
      modelOverride: "xiaomi/mimo-v2.6-flash",
    });
    expect(hook.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Character "arona" (arona) model override "openrouter/z-ai/glm-5.3-flash" has no configured API key for provider "openrouter". Falling back to world model "openrp/xiaomi/mimo-v2.6-flash".',
      ),
    );
  });

  it("throws hard error when character model has no key and world model is also unreachable", async () => {
    const isKey = () => false;
    const hook = setup(
      { model: "openrp/xiaomi/mimo-v2.6-flash" },
      {
        "agent:arona": { model: "openrouter/z-ai/glm-5.3-flash" },
      },
      {},
      vi.fn(),
      isKey,
    );
    await expect(hook({}, { sessionKey: "agent:arona:brain" })).rejects.toThrow(
      /No API key configured for arona's model/,
    );
    expect(hook.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("is also unreachable"),
    );
  });
});
