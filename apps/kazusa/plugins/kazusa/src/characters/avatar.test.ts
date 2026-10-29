import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createRouteRegistrar } from "../http/helpers.ts";
import { localAvatarUrl, registerAvatarHttp } from "./avatar.ts";

async function setup(withAvatar: boolean) {
  const workspace = await mkdtemp(path.join(tmpdir(), "kazusa-avatar-"));
  if (withAvatar) await writeFile(path.join(workspace, "avatar.png"), "PNG");
  const routes: Record<string, (req: unknown, res: unknown) => Promise<void>> =
    {};
  const api = {
    config: { agents: { list: [{ id: "kazusa", workspace }] } },
    runtime: {
      agent: { resolveAgentWorkspaceDir: vi.fn(() => workspace) },
    },
    registerHttpRoute: vi.fn((opts) => {
      routes[opts.path] = opts.handler;
    }),
  } as unknown as OpenClawPluginApi;
  Object.assign(api, {
    runtime: { ...api.runtime, config: { current: () => api.config } },
  });
  registerAvatarHttp(api, createRouteRegistrar(api));
  return { api, routes };
}

async function get(
  handler: ((req: unknown, res: unknown) => Promise<void>) | undefined,
  url: string,
) {
  const headers: Record<string, unknown> = {};
  const res = Object.assign(new PassThrough(), {
    status: 0,
    headers,
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
  await handler?.({ method: "GET", url, headers: {} }, res);
  return { ...res, body: Buffer.concat(chunks).toString() };
}

describe("avatars", () => {
  it("points at and serves the workspace image", async () => {
    const { api, routes } = await setup(true);
    const url = await localAvatarUrl(api, "kazusa");
    expect(url).toMatch(/^\/kazusa\/avatar\?id=kazusa&v=\w+$/);

    const res = await get(routes["/kazusa/avatar"], url!);
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("image/png");
    expect(res.body).toBe("PNG");
  });

  it("has no URL and 404s without an image or for unknown ids", async () => {
    const { api, routes } = await setup(false);
    expect(await localAvatarUrl(api, "kazusa")).toBeUndefined();
    const missing = await get(
      routes["/kazusa/avatar"],
      "/kazusa/avatar?id=kazusa",
    );
    expect(missing.status).toBe(404);
    const unknown = await get(
      routes["/kazusa/avatar"],
      "/kazusa/avatar?id=../etc",
    );
    expect(unknown.status).toBe(404);
  });
});
