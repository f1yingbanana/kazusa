import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerClockHttp } from "./http.ts";
import { Clock } from "./clock.ts";

function createMockStore() {
  const data = new Map<string, unknown>();
  return {
    lookup: vi.fn(async (key: string) => data.get(key)),
    register: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
  };
}

describe("registerClockHttp", () => {
  it("registers GET /kazusa/world and POST /kazusa/clock routes", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: {},
      pluginConfig: {
        user: { id: "user:test", name: "Tester" },
        world: { title: "Test World" },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;

    const clock = new Clock({
      store: createMockStore() as never,
      initialTime: 100_000,
      defaultSpeed: 1,
    });
    await clock.init();

    registerClockHttp(api, clock);

    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/world", match: "exact" }),
    );
    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/clock", match: "exact" }),
    );

    // Test GET /kazusa/world
    let worldStatus = 0;
    let worldJson: string | undefined;
    const worldRes = {
      writeHead: (s: number) => {
        worldStatus = s;
      },
      setHeader: vi.fn(),
      end: (data?: string) => {
        worldJson = data;
      },
    };
    await routes["/kazusa/world"]?.(
      { method: "GET", url: "/kazusa/world" },
      worldRes,
    );

    expect(worldStatus).toBe(200);
    const parsedWorld = JSON.parse(worldJson ?? "{}");
    expect(parsedWorld.user.name).toBe("Tester");
    expect(parsedWorld.world.title).toBe("Test World");
    expect(parsedWorld.clock.speed).toBe(1);
    expect(parsedWorld.capabilities.clock).toBe("live");
  });
});
