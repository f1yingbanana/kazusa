import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { KAZUSA_ROUTES } from "@kazusa/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteRegistrar } from "./helpers.ts";

type Route = Parameters<OpenClawPluginApi["registerHttpRoute"]>[0];

beforeEach(() => vi.stubEnv("KAZUSA_AUTH_MODE", "local"));
afterEach(() => vi.unstubAllEnvs());

function setup(
  auth: "plugin" | "gateway" = "plugin",
  token: string | undefined = "test-service-token",
) {
  const routes = new Map<string, Route>();
  const handler = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
    res.end("ok");
  });
  const api = {
    config: { gateway: { auth: { token } } },
    registerHttpRoute: (route: Route) => {
      routes.set(route.path, route);
    },
  } as unknown as OpenClawPluginApi;
  const register = createRouteRegistrar(api, { auth });
  for (const [path, policy] of KAZUSA_ROUTES)
    register(path, policy.method, handler);
  return { routes, handler, register };
}

async function call(
  route: Route | undefined,
  role?: string | string[],
  token: string | null = "test-service-token",
  method?: string,
): Promise<number> {
  if (!route) throw new Error("Missing test route");
  const req = new IncomingMessage(new Socket());
  req.url = route.path;
  req.method =
    method ?? KAZUSA_ROUTES.get(route.path.slice("/kazusa/".length))?.method;
  req.headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(role === undefined ? {} : { "x-kazusa-role": role }),
  };
  const res = new ServerResponse(req);
  await route.handler(req, res);
  return res.statusCode;
}

describe.each(["plugin", "gateway"] as const)(
  "%s route permissions",
  (auth) => {
    it("denies every visitor write/admin read without calling the handler", async () => {
      const h = setup(auth);
      for (const [path, policy] of KAZUSA_ROUTES) {
        if (policy.permission === "observe") continue;
        expect(await call(h.routes.get(`/kazusa/${path}`), "visitor")).toBe(
          403,
        );
      }
      expect(h.handler).not.toHaveBeenCalled();
    });

    it("requires service authentication before accepting delegated roles", async () => {
      const h = setup(auth);
      for (const token of ["wrong", null]) {
        expect(await call(h.routes.get("/kazusa/clock"), "owner", token)).toBe(
          401,
        );
      }
      for (const role of [
        "admin",
        "collaborator",
        "owner, visitor",
        ["owner", "visitor"],
      ]) {
        expect(await call(h.routes.get("/kazusa/clock"), role)).toBe(401);
      }
      expect(h.handler).not.toHaveBeenCalled();
    });

    it("allows local owner actions and visitor reads, including SSE", async () => {
      const h = setup(auth);
      expect(await call(h.routes.get("/kazusa/clock"), "owner")).toBe(200);
      expect(await call(h.routes.get("/kazusa/events"), "visitor")).toBe(200);
      expect(h.handler).toHaveBeenCalledTimes(2);
      expect(h.routes.get("/kazusa/clock")?.auth).toBe(auth);
    });
  },
);

describe("deployment policy", () => {
  it("clamps the public Gateway to visitor even with an owner assertion", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "public");
    const h = setup();
    expect(await call(h.routes.get("/kazusa/clock"))).toBe(403);
    expect(await call(h.routes.get("/kazusa/clock"), "owner")).toBe(403);
    expect(h.handler).not.toHaveBeenCalled();
  });

  it("does not register unclassified endpoints or mismatched methods", () => {
    const h = setup();
    expect(() => h.register("unclassified", "POST", h.handler)).toThrow(
      "Missing Kazusa route policy",
    );
    expect(() => h.register("world", "POST", h.handler)).toThrow(
      "Missing Kazusa route policy",
    );
    vi.stubEnv("KAZUSA_AUTH_MODE", "typo");
    expect(() => setup()).toThrow();
  });

  it("fails closed without a plugin credential, while preserving native Gateway auth", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", undefined);
    const plugin = setup("plugin", "");
    expect(await call(plugin.routes.get("/kazusa/world"))).toBe(401);
    expect(plugin.handler).not.toHaveBeenCalled();
    const gateway = setup("gateway", "");
    // Only the real Gateway invokes this handler after native authentication.
    expect(
      await call(gateway.routes.get("/kazusa/clock"), undefined, null),
    ).toBe(200);
    expect(await call(gateway.routes.get("/kazusa/clock"), "owner")).toBe(401);
  });
});
