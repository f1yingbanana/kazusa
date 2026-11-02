import { Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { ProviderSummarySchema, ProvidersResponseSchema } from "@kazusa/client";
import { registerProvidersHttp, type ProvidersDeps } from "./http.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

function setup(
  initial: Record<string, unknown>,
  env: NodeJS.ProcessEnv = {},
  stored: readonly string[] = [],
) {
  const config = initial as OpenClawConfig;
  const store = new Set<string>(stored);
  const routes: Record<string, Handler> = {};
  const api = {
    registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  const deps = {
    readConfig: () => config,
    env: () => env,
    call: vi.fn(async (method: string, params: unknown) => {
      const { name } = params as { name?: string };
      if (method === "secrets.store.set" && name) store.add(name);
      if (method === "secrets.store.delete" && name) store.delete(name);
      return { entries: [...store].map((entry) => ({ name: entry })) };
    }),
  } satisfies ProvidersDeps;
  registerProvidersHttp(api, deps);
  return { routes, deps, store };
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

const ref = (id: string) => ({ source: "store", provider: "default", id });

/** A world as `worlds/base.json` makes it: every reference written up front. */
const WORLD = {
  plugins: {
    allow: ["kazusa", "openrouter", "venice", "zai"],
    entries: {
      kazusa: {
        config: { decisions: { typesafeApiKey: ref("TYPESAFE_API_KEY") } },
      },
    },
  },
  models: {
    providers: {
      openrouter: { apiKey: ref("OPENROUTER_API_KEY") },
      venice: { apiKey: ref("VENICE_API_KEY") },
      zai: { apiKey: { source: "env", provider: "default", id: "ZAI_KEY" } },
    },
  },
};

describe("registerProvidersHttp", () => {
  it("says where each key comes from, counting a store entry only once it exists", async () => {
    const { routes } = setup(WORLD, {}, ["OPENROUTER_API_KEY"]);
    const { body } = await call(routes["/kazusa/providers"], "GET");
    const { providers } = ProvidersResponseSchema.parse(body);
    expect(providers.map(({ id, key }) => [id, key])).toEqual([
      ["openrouter", "store"],
      ["typesafe", "none"],
      ["venice", "none"],
      ["zai", "config"],
    ]);
  });

  it("saves and removes a key in the store, never in the config", async () => {
    const { routes, deps, store } = setup(WORLD);
    const before = JSON.stringify(WORLD);
    const saved = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "venice",
      key: " vapi_x ",
    });
    expect(ProviderSummarySchema.parse(saved.body).key).toBe("store");
    expect(deps.call).toHaveBeenCalledWith("secrets.store.set", {
      name: "VENICE_API_KEY",
      value: "vapi_x",
      kind: "secret",
    });
    const removed = await call(routes["/kazusa/providers/remove"], "POST", {
      provider: "venice",
    });
    expect(ProviderSummarySchema.parse(removed.body).key).toBe("none");
    expect(store.has("VENICE_API_KEY")).toBe(false);
    expect(JSON.stringify(WORLD)).toBe(before);
  });

  it("keeps TypeSafe's key behind Kazusa's own reference", async () => {
    const { routes, deps } = setup(WORLD);
    const { body } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "typesafe",
      key: "ts",
    });
    expect(ProviderSummarySchema.parse(body).key).toBe("store");
    expect(deps.call).toHaveBeenCalledWith("secrets.store.set", {
      name: "TYPESAFE_API_KEY",
      value: "ts",
      kind: "secret",
    });
  });

  it("leaves a reference set by hand alone", async () => {
    const { routes, deps } = setup(WORLD);
    const { status } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "zai",
      key: "z",
    });
    expect(status).toBe(409);
    expect(deps.call).not.toHaveBeenCalledWith(
      "secrets.store.set",
      expect.anything(),
    );
  });

  it("refuses a provider whose plugin isn't allowed", async () => {
    const { routes } = setup(WORLD);
    const { status } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "openai",
      key: "sk",
    });
    expect(status).toBe(404);
  });
});
