import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { DesiresResponseSchema, type StreamEvent } from "@kazusa/client";
import { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { DESIRES_CONFIG } from "./config.ts";
import { anchorAt, type DesireRecord } from "./desires.ts";
import { registerDesiresHttp } from "./http.ts";
import type { DesiresService } from "./register.ts";

const T0 = Date.parse("2026-10-27T08:00:00.000Z");

function setup() {
  const routes: Record<
    string,
    (req: unknown, res: unknown) => Promise<boolean>
  > = {};
  const api = {
    config: {
      agents: { list: [{ id: "kazusa" }, { id: "hoshino" }] },
    },
    registerHttpRoute: vi.fn((opts) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  const config = DESIRES_CONFIG.parse({});
  const records = new Map<string, DesireRecord>([
    ["kazusa", anchorAt(config, undefined, T0)],
  ]);
  const listeners = new Set<(agentId: string, record: DesireRecord) => void>();
  const desires = {
    config,
    store: {
      lookup: vi.fn(async (id: string) => records.get(id)),
    },
    onChange: (listener: (agentId: string, record: DesireRecord) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as DesiresService;
  const broadcaster = new KazusaRealtimeBroadcaster();
  registerDesiresHttp(api, { desires, broadcaster });
  return { routes, api, config, broadcaster, listeners };
}

describe("registerDesiresHttp", () => {
  it("serves the catalog and every stored record", async () => {
    const { routes, api } = setup();
    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/desires", match: "exact" }),
    );

    let status = 0;
    let body: string | undefined;
    await routes["/kazusa/desires"]?.(
      { method: "GET", url: "/kazusa/desires" },
      {
        writeHead: (s: number) => {
          status = s;
        },
        setHeader: vi.fn(),
        end: (data?: string) => {
          body = data;
        },
      },
    );
    expect(status).toBe(200);
    const parsed = DesiresResponseSchema.parse(JSON.parse(body ?? "{}"));
    expect(parsed.config.catalog.map(({ name }) => name)).toContain("energy");
    expect(parsed.config.initial).toBe("fine");
    expect(Object.keys(parsed.records)).toEqual(["kazusa"]);
    expect(parsed.records.kazusa?.anchorAt).toBe(T0);
  });

  it("broadcasts each written record as an SSE desires event", () => {
    const { broadcaster, listeners, config } = setup();
    const events: StreamEvent[] = [];
    broadcaster.subscribe((event) => events.push(event));
    const record = anchorAt(config, undefined, T0 + 60_000);
    for (const listener of listeners) listener("hoshino", record);
    expect(events).toEqual([
      { type: "desires", characterId: "hoshino", record },
    ]);
  });
});
