import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { PortraitsResponseSchema } from "@kazusa/client";
import { createRouteRegistrar } from "../http/helpers.ts";
import { registerScene } from "./http.ts";

type Handler = (req: unknown, res: unknown) => Promise<void>;

/** A world with one character's portraits and one backdrop set. */
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "kazusa-scene-"));
  const workspace = path.join(root, "workspaces", "aris");
  await mkdir(path.join(workspace, "portraits"), { recursive: true });
  for (const file of ["neutral.webp", "happy.png"])
    await writeFile(path.join(workspace, "portraits", file), file);
  await writeFile(
    path.join(workspace, "portraits", "portraits.json"),
    JSON.stringify({ eyeline: 0.2, placement: { "": { centre: 0.6 } } }),
  );
  const bare = path.join(root, "workspaces", "momoi");
  await mkdir(bare, { recursive: true });
  await mkdir(path.join(root, "shared", "backdrops", "park"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "shared", "backdrops", "park", "day.webp"),
    "day",
  );
  await writeFile(path.join(root, "shared", "secret.webp"), "secret");

  const routes: Record<string, Handler> = {};
  const workspaces: Record<string, string> = { aris: workspace, momoi: bare };
  const api = {
    config: {
      gateway: { auth: { token: "test-service-token" } },
      agents: {
        list: [
          { id: "aris", workspace },
          { id: "momoi", workspace: bare },
        ],
      },
    },
    pluginConfig: {
      location: { wikiDir: path.join(root, "shared", "wiki") },
      scene: { times: [{ name: "night", from: "20:00" }] },
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir: vi.fn(
          (_config: unknown, id: string) => workspaces[id],
        ),
      },
    },
    registerHttpRoute: vi.fn((opts: { path: string; handler: Handler }) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  Object.assign(api, {
    runtime: { ...api.runtime, config: { current: () => api.config } },
  });
  const scene = registerScene(api, createRouteRegistrar(api));

  const get = async (url: string) => {
    const res = Object.assign(new PassThrough(), {
      status: 0,
      headers: {},
      headersSent: false,
      setHeader: vi.fn(),
      writeHead(status: number, headers: Record<string, unknown>) {
        res.status = status;
        res.headers = headers;
        res.headersSent = true;
      },
    });
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    await routes[new URL(url, "http://localhost").pathname]?.(
      {
        method: "GET",
        url,
        headers: { authorization: "Bearer test-service-token" },
      },
      res,
    );
    return { ...res, body: Buffer.concat(chunks).toString() };
  };
  return { get, scene };
}

describe("scene routes", () => {
  it("takes the times of day from config", async () => {
    const { scene } = await setup();
    expect(scene.times).toEqual([{ name: "night", from: "20:00" }]);
  });

  it("lists a roster character's portraits", async () => {
    const { get } = await setup();
    const ok = await get("/kazusa/portraits?id=aris");
    expect(ok.status).toBe(200);
    expect(PortraitsResponseSchema.parse(JSON.parse(ok.body))).toEqual({
      portraits: [
        {
          name: "happy",
          url: expect.stringMatching(
            /^\/kazusa\/portrait\?id=aris&name=happy&v=\w+$/,
          ),
          mood: "happy",
          placement: { centre: 0.6 },
        },
        {
          name: "neutral",
          url: expect.stringContaining("name=neutral"),
          mood: "neutral",
          placement: { centre: 0.6 },
        },
      ],
      default: "neutral",
      eyeline: 0.2,
    });
    const none = await get("/kazusa/portraits?id=momoi");
    expect([none.status, JSON.parse(none.body)]).toEqual([
      200,
      { portraits: [] },
    ]);
    expect((await get("/kazusa/portraits?id=mallory")).status).toBe(404);
    expect((await get("/kazusa/portraits")).status).toBe(400);
  });

  it("serves a portrait in the set and nothing else", async () => {
    const { get } = await setup();
    const ok = await get("/kazusa/portrait?id=aris&name=happy&v=abc");
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    expect(ok.body).toBe("happy.png");
    for (const url of [
      "/kazusa/portrait?id=aris&name=sad",
      "/kazusa/portrait?id=mallory&name=happy",
      "/kazusa/portrait?id=aris&name=../IDENTITY",
      "/kazusa/portrait?id=aris&name=portraits",
      "/kazusa/portrait?id=aris",
    ])
      expect({ url, status: (await get(url)).status }).toEqual({
        url,
        status: 404,
      });
  });

  it("serves a backdrop in the library and nothing else", async () => {
    const { get } = await setup();
    const ok = await get("/kazusa/backdrop?set=park&name=day&v=abc");
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    expect(ok.body).toBe("day");
    for (const url of [
      "/kazusa/backdrop?set=park&name=night",
      "/kazusa/backdrop?set=..&name=secret",
      "/kazusa/backdrop?set=park/..&name=secret",
      "/kazusa/backdrop?set=lake&name=day",
      "/kazusa/backdrop?name=day",
    ])
      expect({ url, status: (await get(url)).status }).toEqual({
        url,
        status: 404,
      });
  });
});
