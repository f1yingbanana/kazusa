import { Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { MoveResponseSchema } from "@kazusa/client";
import { registerLocationHttp } from "./http.ts";
import type { LocationService } from "./register.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

function setup() {
  const routes: Record<string, Handler> = {};
  const api = {
    config: {},
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
  });
  const post = async (body: unknown) => {
    const req = Object.assign(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      {
        method: "POST",
        url: "/kazusa/move",
        headers: {},
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
