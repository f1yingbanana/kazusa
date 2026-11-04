import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { ContextSettingsResponseSchema } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { registerContextHttp } from "./http.ts";
import type { ContextEngineService } from "./register.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

function setup(contextEngine: Record<string, unknown> = {}) {
  const routes: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, unknown>>();
  const config = { agents: { list: [{ id: "alice" }, { id: "bob" }] } };
  registerContextHttp(
    {
      pluginConfig: { contextEngine },
      registerHttpRoute: (route: { path: string; handler: Handler }) => {
        routes[route.path] = route.handler;
      },
      runtime: {
        config: { current: () => config },
        state: {
          openKeyedStore: ({ namespace }: { namespace: string }) => {
            const store = stores.get(namespace) ?? new Map<string, unknown>();
            stores.set(namespace, store);
            return {
              lookup: async (key: string) => store.get(key),
              register: async (key: string, value: unknown) => {
                store.set(key, value);
              },
            };
          },
        },
        agent: {
          session: {
            getSessionEntryAsync: async () => ({ contextTokens: 1_048_576 }),
          },
        },
      },
    } as unknown as OpenClawPluginApi,
    { context: {} as ContextEngineService },
  );
  const call = async (route: string, body?: unknown) => {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ) as unknown as IncomingMessage;
    Object.assign(req, {
      method: body === undefined ? "GET" : "POST",
      headers: {},
      url: route,
      socket: new Socket(),
    });
    const res = new ServerResponse(req);
    let text = "";
    res.write = ((chunk: string) => ((text += chunk), true)) as never;
    res.end = ((chunk?: string) => {
      if (chunk) text += chunk;
      return res;
    }) as never;
    await routes[route.split("?")[0]](req, res);
    return { status: res.statusCode, body: JSON.parse(text) as unknown };
  };
  return { call, stores };
}

const BUILT_IN = {
  shortTermHours: 24,
  ledgerMaxTokens: "unlimited",
  maxContextTokens: 64_000,
  ledgerGridHours: 4,
  ledgerTrimTo: 0.75,
  onYourMindTokens: 800,
  peopleLimit: 20,
  placesLimit: 16,
  toolHistoryTokens: 600,
};

describe("context settings routes", () => {
  it("reports the world's settings over the plugin config", async () => {
    const { call } = setup({ shortTermHours: 48 });
    const { body } = await call("/kazusa/context/settings");
    expect(ContextSettingsResponseSchema.parse(body)).toEqual({
      inherited: { ...BUILT_IN, shortTermHours: 48 },
      overrides: {},
      effective: { ...BUILT_IN, shortTermHours: 48 },
    });
  });

  it("layers a character's choices over the world's, and says the model's window", async () => {
    const { call } = setup();
    await call("/kazusa/context/settings/save", {
      overrides: { maxContextTokens: 128_000 },
    });
    await call("/kazusa/context/settings/save", {
      agentId: "alice",
      overrides: { ledgerMaxTokens: 20_000 },
    });
    const { body } = await call("/kazusa/context/settings?agentId=alice");
    expect(ContextSettingsResponseSchema.parse(body)).toEqual({
      agentId: "alice",
      inherited: { ...BUILT_IN, maxContextTokens: 128_000 },
      overrides: { ledgerMaxTokens: 20_000 },
      effective: {
        ...BUILT_IN,
        maxContextTokens: 128_000,
        ledgerMaxTokens: 20_000,
      },
      modelContextTokens: 1_048_576,
    });
    // Another character still follows the world.
    const bob = await call("/kazusa/context/settings?agentId=bob");
    expect(ContextSettingsResponseSchema.parse(bob.body).overrides).toEqual({});
  });

  it("replaces a scope's overrides, so a field left out inherits again", async () => {
    const { call } = setup();
    await call("/kazusa/context/settings/save", {
      overrides: { shortTermHours: 72, ledgerGridHours: 2 },
    });
    const { body } = await call("/kazusa/context/settings/save", {
      overrides: { shortTermHours: 72 },
    });
    expect(ContextSettingsResponseSchema.parse(body).effective).toEqual({
      ...BUILT_IN,
      shortTermHours: 72,
    });
  });

  it("refuses unknown characters and settings out of range", async () => {
    const { call } = setup();
    expect((await call("/kazusa/context/settings?agentId=nobody")).status).toBe(
      404,
    );
    expect(
      (
        await call("/kazusa/context/settings/save", {
          overrides: { shortTermHours: 2 },
        })
      ).status,
    ).toBe(400);
  });
});
