import { Socket } from "node:net";
import { Readable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { EmbeddingModelsResponseSchema } from "@kazusa/client";
import {
  configuredChoice,
  EMBEDDING_MODELS,
  registerEmbeddingModels,
} from "./embedding-models.ts";
import {
  createModelSelection,
  type ModelSelection,
} from "../models/selection.ts";
import { MemoryIndex } from "./index.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

const OPENROUTER_SMALL = configuredChoice({
  baseUrl: "https://openrouter.ai/api/v1",
  provider: "openrouter",
  model: "openai/text-embedding-3-small",
});

function setup(keys: readonly string[]) {
  const routes: Record<string, Handler> = {};
  const rows = new Map<string, ModelSelection>();
  const api = {
    registerHttpRoute: (opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    },
    runtime: {
      config: { current: () => ({}) },
      modelAuth: {
        isProviderApiKeyConfigured: ({ provider }: { provider: string }) =>
          keys.includes(provider),
      },
    },
  } as unknown as OpenClawPluginApi;
  const deps = {
    selection: createModelSelection({
      lookup: async (key: string) => rows.get(key),
      register: async (key: string, value: ModelSelection) => {
        rows.set(key, value);
      },
      entries: async () => [],
    }),
    configured: OPENROUTER_SMALL,
    useVectors: vi.fn(),
    progress: () => ({ embedded: 3, total: 4 }),
    fillIn: vi.fn(),
  };
  const models = registerEmbeddingModels(api, deps);
  return { routes, deps, models };
}

async function call(
  handler: Handler | undefined,
  method: string,
  body?: unknown,
) {
  const req = Object.assign(
    Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ),
    { method, url: "/", headers: {}, socket: new Socket() },
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
  return { status, body: JSON.parse(json || "{}") as unknown };
}

describe("embedding models", () => {
  it("lists every choice with whether its provider has a key", async () => {
    const { routes } = setup(["openrouter"]);
    const { body } = await call(routes["/kazusa/models/embedding"], "GET");
    const state = EmbeddingModelsResponseSchema.parse(body);
    expect(state.current).toBe("openrouter/openai/text-embedding-3-small");
    expect(state.progress).toEqual({ embedded: 3, total: 4 });
    expect(state.options).toHaveLength(EMBEDDING_MODELS.length);
    expect(
      state.options.filter((option) => option.available).map(({ ref }) => ref),
    ).toEqual([
      "openrouter/openai/text-embedding-3-small",
      "openrouter/openai/text-embedding-3-large",
    ]);
  });

  it("shares vectors between providers of one model", async () => {
    const { routes, deps, models } = setup(["openrouter", "openai"]);
    const { status } = await call(
      routes["/kazusa/models/embedding/select"],
      "POST",
      { ref: "openai/text-embedding-3-small" },
    );
    expect(status).toBe(200);
    expect((await models.current()).provider).toBe("openai");
    expect(deps.useVectors).toHaveBeenLastCalledWith(OPENROUTER_SMALL.vectors);
    expect(deps.fillIn).toHaveBeenCalled();
  });

  it("refuses a model whose provider has no key", async () => {
    const { routes } = setup(["openrouter"]);
    const { status } = await call(
      routes["/kazusa/models/embedding/select"],
      "POST",
      { ref: "mistral/mistral-embed" },
    );
    expect(status).toBe(409);
  });

  it("keeps a hand-configured endpoint as its own choice", () => {
    const custom = configuredChoice({
      baseUrl: "http://localhost:1234/v1",
      provider: "lmstudio",
      model: "nomic-embed",
    });
    expect(custom).toMatchObject({
      name: "nomic-embed",
      vectors: "nomic-embed",
    });
  });
});

describe("MemoryIndex.useVectors", () => {
  it("keeps each model's vectors apart, so switching back costs nothing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-vectors-"));
    const vectorsPath = path.join(dir, "vectors.sqlite");
    const index = new MemoryIndex({
      worldDir: dir,
      vectorsPath,
      model: "a",
      workspaceDir: () => undefined,
    });
    index.addVectors([["hello", [1, 0]]]);
    index.useVectors("b");
    index.addVectors([["hello", [0, 1]]]);
    index.useVectors("a");
    const rows = new DatabaseSync(vectorsPath)
      .prepare("SELECT model, COUNT(*) AS n FROM vectors GROUP BY model")
      .all();
    expect(rows).toEqual([
      { model: "a", n: 1 },
      { model: "b", n: 1 },
    ]);
  });
});
