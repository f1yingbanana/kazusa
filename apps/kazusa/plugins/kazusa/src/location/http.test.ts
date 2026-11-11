import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { MoveResponseSchema, PlacesResponseSchema } from "@kazusa/client";
import { SCENE_CONFIG } from "../scene/config.ts";
import { registerLocationHttp } from "./http.ts";
import type { LocationService } from "./register.ts";
import { loadWorld } from "./world.ts";

const { times } = SCENE_CONFIG.parse({});

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

function setup() {
  const routes: Record<string, Handler> = {};
  const api = {
    config: { gateway: { auth: { token: "test-service-token" } } },
    pluginConfig: { user: { id: "user:player", name: "Player" } },
    registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  const place = vi.fn(async (_id: string, placeId: string) => {
    if (placeId !== "library") throw new Error(`No place called ${placeId}.`);
    return { placeId, since: 1_000 };
  });
  registerLocationHttp(api, {
    location: { place } as unknown as LocationService,
    times,
  });
  const post = async (body: unknown) => {
    const req = Object.assign(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      {
        method: "POST",
        url: "/kazusa/move",
        headers: { authorization: "Bearer test-service-token" },
        socket: new Socket(),
      },
    );
    let status = 0;
    let json = "";
    await routes["/kazusa/move"]?.(req, {
      writeHead: (s: number) => {
        status = s;
      },
      setHeader: vi.fn(),
      end: (data?: string) => {
        json = data ?? "";
      },
    });
    return { status, body: JSON.parse(json || "{}") as unknown };
  };
  return { place, post };
}

describe("POST /kazusa/move", () => {
  it("moves the configured player, whoever the body names", async () => {
    const { place, post } = setup();
    const response = await post({ placeId: "library", id: "kazusa" });
    expect(response.status).toBe(200);
    expect(MoveResponseSchema.parse(response.body)).toEqual({
      record: { placeId: "library", since: 1_000 },
    });
    expect(place).toHaveBeenCalledWith("user:player", "library");
  });

  it("refuses a place that is not on the map", async () => {
    const { post } = setup();
    expect(await post({ placeId: "nowhere" })).toEqual({
      status: 400,
      body: { error: "No place called nowhere." },
    });
  });
});

describe("POST /kazusa/places/positions", () => {
  function route(saved: unknown[]) {
    let handler: Handler | undefined;
    const api = {
      config: { gateway: { auth: { token: "test-service-token" } } },
      pluginConfig: { user: { id: "user:player", name: "Player" } },
      registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
        if (opts.path === "/kazusa/places/positions") handler = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;
    registerLocationHttp(api, {
      location: {
        savePositions: async (positions: unknown) => {
          saved.push(positions);
          return 1;
        },
      } as unknown as LocationService,
      times,
    });
    return async (body: unknown) => {
      const req = Object.assign(
        Readable.from([Buffer.from(JSON.stringify(body))]),
        {
          method: "POST",
          url: "/kazusa/places/positions",
          headers: { authorization: "Bearer test-service-token" },
          socket: new Socket(),
        },
      );
      let status = 0;
      let json = "";
      await handler?.(req, {
        writeHead: (s: number) => {
          status = s;
        },
        setHeader: vi.fn(),
        end: (data?: string) => {
          json = data ?? "";
        },
      });
      return { status, body: JSON.parse(json || "{}") as unknown };
    };
  }

  it("saves valid positions and refuses anything else", async () => {
    const saved: unknown[] = [];
    const post = route(saved);
    const positions = { dock: { x: 0.5, y: 0.6 } };
    const ok = await post({ positions });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ written: 1 });
    expect(saved).toEqual([positions]);
    const bad = await post({ positions: { dock: { x: "far" } } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(saved).toHaveLength(1);
  });
});

describe("GET /kazusa/places", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });

  it("resolves each place's backdrop and sends the library and times", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-places-"));
    roots.push(root);
    const places = path.join(root, "shared/wiki/entities/places");
    mkdirSync(places, { recursive: true });
    const page = (id: string, extra = ""): void => {
      writeFileSync(
        path.join(places, `${id}.md`),
        `---\nplace_id: ${id}\nname: ${id}\nsummary: ${id}.\n${extra}---\n`,
      );
    };
    page("school", "backdrop: hall\n");
    page("classroom", "parent: school\nbackdrop: classroom\n");
    page("corridor", "parent: school\n");
    page("park");
    const set = path.join(root, "shared/backdrops/classroom");
    mkdirSync(set, { recursive: true });
    for (const file of ["day.webp", "festival-night.png", "notes.txt"])
      writeFileSync(path.join(set, file), file);
    writeFileSync(
      path.join(set, "backdrops.json"),
      JSON.stringify({ states: { festival: "decorated for the festival" } }),
    );
    mkdirSync(path.join(root, "shared/backdrops/hall"));
    writeFileSync(path.join(root, "shared/backdrops/hall/day.webp"), "hall");
    const world = loadWorld(path.join(root, "shared/wiki"));

    let handler: Handler | undefined;
    const api = {
      config: { gateway: { auth: { token: "test-service-token" } } },
      pluginConfig: {},
      registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
        if (opts.path === "/kazusa/places") handler = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;
    registerLocationHttp(api, {
      location: { world } as unknown as LocationService,
      times,
    });
    let json = "";
    await handler?.(
      {
        method: "GET",
        url: "/kazusa/places",
        headers: { authorization: "Bearer test-service-token" },
      },
      {
        writeHead: vi.fn(),
        setHeader: vi.fn(),
        end: (data: string) => (json = data),
      },
    );
    const body = PlacesResponseSchema.parse(JSON.parse(json));
    expect(
      Object.fromEntries(body.places.map(({ id, backdrop }) => [id, backdrop])),
    ).toEqual({
      school: "hall",
      classroom: "classroom",
      corridor: "hall",
      park: undefined,
    });
    expect(body.backdrops.classroom).toEqual({
      files: [
        {
          name: "day",
          url: expect.stringMatching(
            /^\/kazusa\/backdrop\?set=classroom&name=day&v=\w+$/,
          ),
          time: "day",
        },
        {
          name: "festival-night",
          url: expect.stringContaining("name=festival-night"),
          state: "festival",
          time: "night",
        },
      ],
      states: { festival: "decorated for the festival" },
    });
    expect(Object.keys(body.backdrops)).toEqual(["classroom", "hall"]);
    expect(body.times).toEqual([
      { name: "day", from: "06:00" },
      { name: "dusk", from: "17:00" },
      { name: "night", from: "19:00" },
    ]);
  });
});
