import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerClockHttp, worldConfigOf } from "./http.ts";
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

describe("worldConfigOf", () => {
  it("passes this install's note to visitors through", () => {
    const note = {
      title: "Talk to them",
      text: "On Discord you can text one student at a time.",
      link: { label: "Join the Discord", href: "https://discord.gg/abc" },
    };
    expect(worldConfigOf({ title: "Kivotos", visitorNote: note })).toEqual({
      title: "Kivotos",
      visitorNote: note,
    });
  });

  it("leaves out a malformed note and keeps the rest", () => {
    expect(
      worldConfigOf({
        title: "Kivotos",
        visitorNote: { link: { label: "x", href: "javascript:alert(1)" } },
      }),
    ).toEqual({ title: "Kivotos" });
    expect(worldConfigOf(undefined)).toEqual({});
  });
});

describe("registerClockHttp", () => {
  it("registers GET /kazusa/world and POST /kazusa/clock routes", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: { gateway: { auth: { token: "test-service-token" } } },
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
      {
        method: "GET",
        url: "/kazusa/world",
        headers: { authorization: "Bearer test-service-token" },
      },
      worldRes,
    );

    expect(worldStatus).toBe(200);
    const parsedWorld = JSON.parse(worldJson ?? "{}");
    expect(parsedWorld.operator.name).toBe("Tester");
    expect(parsedWorld.player).toBeNull();
    expect(parsedWorld.world.title).toBe("Test World");
    expect(parsedWorld.clock.speed).toBe(1);
    expect(parsedWorld.capabilities.clock).toBe("live");
  });

  it("tells who the operator plays to them alone", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: { gateway: { auth: { token: "test-service-token" } } },
      pluginConfig: { user: { id: "user:test", name: "Tester" } },
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
    const played = { id: "alice", name: "Alice" };
    registerClockHttp(api, clock, {
      player: {
        operator: { id: "user:test", name: "Tester" },
        playing: async () => played,
        playingNow: () => played.id,
        actorIn: async () => played,
        owns: () => true,
      },
    });
    const playerSeenBy = async (role?: string): Promise<unknown> => {
      let json: string | undefined;
      await routes["/kazusa/world"]?.(
        {
          method: "GET",
          url: "/kazusa/world",
          headers: {
            authorization: "Bearer test-service-token",
            ...(role ? { "x-kazusa-role": role } : {}),
          },
        },
        {
          writeHead: vi.fn(),
          setHeader: vi.fn(),
          end: (data?: string) => {
            json = data;
          },
        },
      );
      return (JSON.parse(json ?? "{}") as { player: unknown }).player;
    };
    expect(await playerSeenBy()).toEqual(played);
    expect(await playerSeenBy("owner")).toEqual(played);
    // A visitor watches: nobody is "you" to them.
    expect(await playerSeenBy("visitor")).toBeNull();
  });
});
