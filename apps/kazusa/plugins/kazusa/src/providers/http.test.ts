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
  saved: readonly string[] = [],
) {
  const config = initial as OpenClawConfig;
  const profiles = new Map<string, string>(saved.map((id) => [id, "k"]));
  const routes: Record<string, Handler> = {};
  const api = {
    registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  const deps = {
    readConfig: () => config,
    env: () => env,
    keys: {
      has: (provider: string) => profiles.has(provider),
      save: vi.fn(async (provider: string, key: string) => {
        profiles.set(provider, key);
      }),
      remove: vi.fn(async (provider: string) => {
        profiles.delete(provider);
      }),
    },
    call: vi.fn(async () => ({ refreshed: true })),
  } satisfies ProvidersDeps;
  registerProvidersHttp(api, deps);
  return { routes, deps, profiles };
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

/** A world as `apps/kazusa/base.json` makes it, plus one key set by hand. */
const WORLD = {
  plugins: { allow: ["kazusa", "openrouter", "venice", "zai"] },
  models: {
    providers: {
      zai: { apiKey: { source: "env", provider: "default", id: "ZAI_KEY" } },
    },
  },
};

describe("registerProvidersHttp", () => {
  it("says where each key comes from", async () => {
    const { routes } = setup(WORLD, { VENICE_API_KEY: "v" }, ["openrouter"]);
    const { body } = await call(routes["/kazusa/providers"], "GET");
    const { providers } = ProvidersResponseSchema.parse(body);
    expect(providers.map(({ id, key }) => [id, key])).toEqual([
      ["openrouter", "profile"],
      ["typesafe", "none"],
      ["venice", "env"],
      ["zai", "config"],
    ]);
  });

  it("saves and removes a key as an auth profile, never in the config", async () => {
    const { routes, deps, profiles } = setup(WORLD);
    const before = JSON.stringify(WORLD);
    const saved = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "venice",
      key: " vapi_x ",
    });
    expect(ProviderSummarySchema.parse(saved.body).key).toBe("profile");
    expect(profiles.get("venice")).toBe("vapi_x");
    expect(deps.call).toHaveBeenCalledWith("models.authRefresh", {
      operation: "login",
    });
    const removed = await call(routes["/kazusa/providers/remove"], "POST", {
      provider: "venice",
    });
    expect(ProviderSummarySchema.parse(removed.body).key).toBe("none");
    expect(profiles.has("venice")).toBe(false);
    expect(deps.call).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(WORLD)).toBe(before);
  });

  it("saves TypeSafe's key as a profile too", async () => {
    const { routes, profiles } = setup(WORLD);
    const { body } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "typesafe",
      key: "ts",
    });
    expect(ProviderSummarySchema.parse(body).key).toBe("profile");
    expect(profiles.get("typesafe")).toBe("ts");
  });

  it("leaves a key set by hand in openclaw.json alone", async () => {
    const { routes, deps } = setup(WORLD);
    const { status } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "zai",
      key: "z",
    });
    expect(status).toBe(409);
    expect(deps.keys.save).not.toHaveBeenCalled();
    expect(deps.call).not.toHaveBeenCalled();
  });

  it("refuses a provider whose plugin isn't allowed", async () => {
    const { routes } = setup(WORLD);
    const { status } = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "openai",
      key: "sk",
    });
    expect(status).toBe(404);
  });

  it("survives Gateway auth refresh timeout or failure when saving or removing a key", async () => {
    const { routes, deps, profiles } = setup(WORLD);
    vi.mocked(deps.call).mockRejectedValue(
      new Error("gateway timeout after 3000ms"),
    );
    const saved = await call(routes["/kazusa/providers/key"], "POST", {
      provider: "venice",
      key: "vapi_x",
    });
    expect(saved.status).toBe(200);
    expect(ProviderSummarySchema.parse(saved.body).key).toBe("profile");
    expect(profiles.get("venice")).toBe("vapi_x");

    const removed = await call(routes["/kazusa/providers/remove"], "POST", {
      provider: "venice",
    });
    expect(removed.status).toBe(200);
    expect(ProviderSummarySchema.parse(removed.body).key).toBe("none");
    expect(profiles.has("venice")).toBe(false);
  });
});
