import { Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerModelsHttp, type ModelsDeps } from "./http.ts";
import { createModelSelection, type ModelSelection } from "./selection.ts";
import {
  ModelsResponseSchema,
  ModelSelectResponseSchema,
  ThinkingSelectResponseSchema,
} from "@kazusa/client";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

const LIST = {
  models: [
    {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      provider: "zai",
      alias: "GLM",
      available: true,
      contextWindow: 1_048_576,
      reasoning: true,
      thinkingLevels: [
        { id: "off", label: "off" },
        { id: "low", label: "on" },
        { id: "ultra", label: "ultra" },
      ],
      thinkingDefault: "off",
      tags: ["default", "configured"],
    },
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      provider: "zai",
      available: true,
      supportsTools: true,
    },
    {
      id: "anthropic/claude-opus",
      name: "Claude Opus",
      provider: "openrouter",
      available: false,
      unavailableReason: "missing-auth",
    },
    {
      id: "hermes-3",
      name: "Hermes 3",
      provider: "venice",
      available: true,
      supportsTools: false,
    },
  ],
  providerOutcomes: [{ provider: "zai", status: "ready" }],
};

function memoryStore() {
  const rows = new Map<string, ModelSelection>();
  return {
    lookup: async (key: string) => rows.get(key),
    register: async (key: string, value: ModelSelection) => {
      rows.set(key, value);
    },
    entries: async () =>
      [...rows].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
}

function setup(config: Record<string, unknown>) {
  const routes: Record<string, Handler> = {};
  const api = {
    config: {},
    registerHttpRoute: vi.fn((opts) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  const selection = createModelSelection(memoryStore());
  const deps = {
    list: vi.fn(async (_params: Parameters<ModelsDeps["list"]>[0]) => LIST),
    readConfig: () => config,
    selection,
  } satisfies ModelsDeps;
  registerModelsHttp(api, deps);
  return { routes, deps, selection };
}

async function call(
  handler: Handler | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const req = Object.assign(
    Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ),
    { method, url, headers: {}, socket: new Socket() },
  );
  let status = 0;
  let json = "";
  const res = {
    headersSent: false,
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      status = s;
    },
    end: (data?: string) => {
      json = data ?? "";
    },
  };
  await handler?.(req, res);
  return { status, body: JSON.parse(json || "{}") };
}

const CONFIG = {
  agents: {
    entries: { kazusa: {}, airi: {} },
    defaults: {
      model: { primary: "zai/glm-5.3-flash" },
      models: { "zai/glm-5.3-flash": { alias: "GLM" } },
    },
  },
};

describe("registerModelsHttp", () => {
  it("serves the Gateway catalog with the shortlist and current model", async () => {
    const { routes, deps } = setup(CONFIG);
    const { status, body } = await call(
      routes["/kazusa/models"],
      "GET",
      "/kazusa/models?refresh=1",
    );
    expect(status).toBe(200);
    expect(deps.list).toHaveBeenCalledWith(
      expect.objectContaining({ refresh: true }),
    );
    expect(body.current).toBe("zai/glm-5.3-flash");
    expect(body.configured).toBe("zai/glm-5.3-flash");
    expect(body.thinking).toBeUndefined();
    expect(body.providers).toEqual([{ provider: "zai", status: "ready" }]);
    expect(body.models).toEqual([
      expect.objectContaining({
        ref: "zai/glm-5.3-flash",
        alias: "GLM",
        pinned: true,
        available: true,
        thinkingLevels: [
          { id: "off", label: "off" },
          { id: "low", label: "on" },
        ],
        thinkingDefault: "off",
      }),
      expect.objectContaining({ ref: "zai/glm-5.3", pinned: false }),
      expect.objectContaining({
        ref: "openrouter/anthropic/claude-opus",
        available: false,
        unavailableReason: "missing-auth",
      }),
    ]);
  });

  it("picks the model every character runs on without touching config", async () => {
    const { routes, selection } = setup(CONFIG);
    const { status, body } = await call(
      routes["/kazusa/model"],
      "POST",
      "/kazusa/model",
      { ref: "zai/glm-5.3" },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ current: "zai/glm-5.3" });
    expect(await selection.read()).toEqual({ model: "zai/glm-5.3" });
    const after = await call(routes["/kazusa/models"], "GET", "/kazusa/models");
    expect(after.body.current).toBe("zai/glm-5.3");
    expect(after.body.configured).toBe("zai/glm-5.3-flash");
  });

  it("refuses models outside the catalog or without credentials", async () => {
    const { routes, selection } = setup(CONFIG);
    const unknown = await call(routes["/kazusa/model"], "POST", "/", {
      ref: "zai/nope",
    });
    expect(unknown.status).toBe(404);
    const locked = await call(routes["/kazusa/model"], "POST", "/", {
      ref: "openrouter/anthropic/claude-opus",
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toContain("missing-auth");
    expect(await selection.read()).toEqual({});
  });

  it("leaves out models that can't call tools, for every scope", async () => {
    const { routes, selection } = setup(CONFIG);
    for (const url of ["/", "/?agentId=airi"]) {
      const { body } = await call(routes["/kazusa/models"], "GET", url);
      const refs = ModelsResponseSchema.parse(body).models.map(
        (model) => model.ref,
      );
      expect(refs).toContain("zai/glm-5.3");
      expect(refs).not.toContain("venice/hermes-3");
    }
    const picked = await call(routes["/kazusa/model"], "POST", "/", {
      ref: "venice/hermes-3",
    });
    expect(picked.status).toBe(404);
    expect(await selection.read()).toEqual({});
  });

  it("keeps the reasoning level beside the model, and clears it", async () => {
    const { routes, selection } = setup(CONFIG);
    await selection.update({ model: "zai/glm-5.3-flash" });
    const set = await call(routes["/kazusa/thinking"], "POST", "/", {
      level: "off",
    });
    expect(set.body).toEqual({ thinking: "off" });
    expect(await selection.read()).toEqual({
      model: "zai/glm-5.3-flash",
      thinking: "off",
    });
    const cleared = await call(routes["/kazusa/thinking"], "POST", "/", {
      level: null,
    });
    expect(cleared.body).toEqual({});
    expect(await selection.read()).toEqual({ model: "zai/glm-5.3-flash" });
    const unsupported = await call(routes["/kazusa/thinking"], "POST", "/", {
      level: "max",
    });
    expect(unsupported.status).toBe(409);
    expect(await selection.read()).toEqual({ model: "zai/glm-5.3-flash" });
  });

  it("keeps per-agent choices isolated and returns explicit and inherited values", async () => {
    const { routes, deps, selection } = setup(CONFIG);
    await selection.update({ model: "zai/glm-5.3-flash", thinking: "low" });
    const picked = await call(routes["/kazusa/model"], "POST", "/", {
      agentId: "airi",
      ref: "zai/glm-5.3",
    });
    expect(ModelSelectResponseSchema.parse(picked.body)).toEqual({
      agentId: "airi",
      current: "zai/glm-5.3",
    });
    expect(deps.list).toHaveBeenLastCalledWith({
      agentId: "airi",
      refresh: false,
    });
    const response = await call(
      routes["/kazusa/models"],
      "GET",
      "/?agentId=airi&refresh=1",
    );
    const body = ModelsResponseSchema.parse(response.body);
    expect(body).toMatchObject({
      agentId: "airi",
      current: "zai/glm-5.3",
      thinking: "low",
      overrides: { model: "zai/glm-5.3" },
    });
    expect(deps.list).toHaveBeenLastCalledWith({
      agentId: "airi",
      refresh: true,
    });
    expect(await selection.read("kazusa")).toEqual({
      model: "zai/glm-5.3-flash",
      thinking: "low",
    });
    const world = await call(routes["/kazusa/models"], "GET", "/");
    expect(world.body.current).toBe("zai/glm-5.3-flash");
    expect(world.body.agentId).toBeUndefined();
  });

  it("validates thinking against the agent's effective model and catalog", async () => {
    const { routes, deps, selection } = setup(CONFIG);
    // The same model can have different availability for another agent.
    deps.list.mockImplementation(async ({ agentId }: { agentId: string }) => ({
      ...LIST,
      models: LIST.models.map((model) => ({
        ...model,
        available: agentId !== "airi",
      })),
    }));
    const locked = await call(routes["/kazusa/model"], "POST", "/", {
      agentId: "airi",
      ref: "zai/glm-5.3-flash",
    });
    expect(locked.status).toBe(409);
    expect(await selection.overrides("airi")).toEqual({});

    deps.list.mockImplementation(async () => LIST);
    await selection.update({ model: "zai/glm-5.3" });
    await selection.update({ model: "zai/glm-5.3-flash" }, "airi");
    const set = await call(routes["/kazusa/thinking"], "POST", "/", {
      agentId: "airi",
      level: "low",
    });
    expect(set.status).toBe(200);
    expect(ThinkingSelectResponseSchema.parse(set.body)).toEqual({
      agentId: "airi",
      thinking: "low",
    });
    const unsupported = await call(routes["/kazusa/thinking"], "POST", "/", {
      agentId: "kazusa",
      level: "low",
    });
    expect(unsupported.status).toBe(409);
    expect(await selection.read("kazusa")).toEqual({ model: "zai/glm-5.3" });
  });

  it("clears each override independently, returning the inherited choice", async () => {
    const { routes, selection } = setup(CONFIG);
    await selection.update({ model: "zai/glm-5.3-flash", thinking: "low" });
    await selection.update({ model: "zai/glm-5.3", thinking: "off" }, "airi");
    const model = await call(routes["/kazusa/model"], "POST", "/", {
      agentId: "airi",
      ref: null,
    });
    expect(model.body).toEqual({
      agentId: "airi",
      current: "zai/glm-5.3-flash",
    });
    expect(await selection.overrides("airi")).toEqual({ thinking: "off" });
    const thinking = await call(routes["/kazusa/thinking"], "POST", "/", {
      agentId: "airi",
      level: null,
    });
    expect(thinking.body).toEqual({ agentId: "airi", thinking: "low" });
    expect(await selection.overrides("airi")).toEqual({});
    const world = await call(routes["/kazusa/model"], "POST", "/", {
      ref: null,
    });
    expect(world.body).toEqual({ current: "zai/glm-5.3-flash" });
    expect(await selection.read()).toEqual({ thinking: "low" });
  });

  it("reports native per-agent primaries before any plugin choice", async () => {
    const { routes } = setup({
      ...CONFIG,
      agents: {
        ...CONFIG.agents,
        entries: {
          kazusa: {},
          airi: { model: { primary: "zai/glm-5.3" } },
        },
      },
    });
    const result = await call(
      routes["/kazusa/models"],
      "GET",
      "/?agentId=airi",
    );
    expect(result.body).toMatchObject({
      agentId: "airi",
      current: "zai/glm-5.3",
      configured: "zai/glm-5.3",
      overrides: {},
    });
  });

  it("rejects unknown agents on every route before reading a catalog or writing", async () => {
    const { routes, deps, selection } = setup(CONFIG);
    const responses = [
      await call(routes["/kazusa/models"], "GET", "/?agentId=missing"),
      await call(routes["/kazusa/model"], "POST", "/", {
        agentId: "missing",
        ref: null,
      }),
      await call(routes["/kazusa/thinking"], "POST", "/", {
        agentId: "missing",
        level: null,
      }),
    ];
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
    expect(deps.list).not.toHaveBeenCalled();
    expect(await selection.read()).toEqual({});
    expect(await selection.overrides("missing")).toEqual({});
  });
});
