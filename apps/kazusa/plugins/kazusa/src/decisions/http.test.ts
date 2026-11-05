import { Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { MODELS_CONFIG } from "../models/config.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { DecisionModelsResponseSchema } from "@kazusa/client";
import {
  createModelSelection,
  type ModelSelection,
} from "../models/selection.ts";
import { registerDecisionModelsHttp } from "./http.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

function setup(keys: readonly string[]) {
  const routes: Record<string, Handler> = {};
  const rows = new Map<string, ModelSelection>();
  const api = {
    registerHttpRoute: (opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    },
  } as unknown as OpenClawPluginApi;
  const selection = createModelSelection({
    lookup: async (key: string) => rows.get(key),
    register: async (key: string, value: ModelSelection) => {
      rows.set(key, value);
    },
    entries: async () => [],
  });
  registerDecisionModelsHttp(api, {
    selection,
    keyConfigured: (provider) => keys.includes(provider),
    config: MODELS_CONFIG.parse({}),
  });
  return { routes, selection };
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

describe("decision model routes", () => {
  it("offers Jev under each provider, OpenRouter first by default", async () => {
    const { routes } = setup(["openrouter"]);
    const { body } = await call(routes["/kazusa/models/decision"], "GET");
    const state = DecisionModelsResponseSchema.parse(body);
    expect(state.current).toBe("openrouter/jev-latest");
    expect(state.options.map(({ ref, available }) => [ref, available])).toEqual(
      [
        ["openrouter/jev-latest", true],
        ["typesafe/jev-latest", false],
        ["openrp/typesafe/jev-1.14.0", false],
      ],
    );
  });

  it("decides through OpenRP with only an OpenRP key", async () => {
    const { routes } = setup(["openrp"]);
    const { body } = await call(routes["/kazusa/models/decision"], "GET");
    expect(DecisionModelsResponseSchema.parse(body).current).toBe(
      "openrp/typesafe/jev-1.14.0",
    );
  });

  it("keeps the pick in Kazusa's selection, refusing one without a key", async () => {
    const select = (keys: readonly string[]) => {
      const world = setup(keys);
      return {
        ...world,
        pick: (ref: string) =>
          call(world.routes["/kazusa/models/decision/select"], "POST", { ref }),
      };
    };
    const without = select(["openrouter"]);
    expect((await without.pick("typesafe/jev-latest")).status).toBe(409);
    expect((await without.pick("typesafe/kev-latest")).status).toBe(404);

    const both = select(["openrouter", "typesafe"]);
    const { body } = await both.pick("typesafe/jev-latest");
    expect(DecisionModelsResponseSchema.parse(body).current).toBe(
      "typesafe/jev-latest",
    );
    expect((await both.selection.read()).decision).toBe("typesafe/jev-latest");
  });
});
