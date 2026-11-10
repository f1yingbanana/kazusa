import { KAZUSA_ROUTES } from "@kazusa/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/kazusa/[...path]/route";

const upstream = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("KAZUSA_AUTH_MODE", "public");
  vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "test-service-token");
  vi.stubEnv("KAZUSA_GATEWAY_URL", "http://127.0.0.1:18789");
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function call(
  path: string,
  method = "GET",
  headers?: HeadersInit,
  origin = "https://demo.example",
): Promise<Response> {
  return (method === "POST" ? POST : GET)(
    new Request(`${origin}/kazusa/${path}`, {
      method,
      headers,
      // An invalid body must not be read before a permission refusal.
      ...(method === "POST" ? { body: "not json" } : {}),
    }),
    { params: Promise.resolve({ path: path.split("?")[0].split("/") }) },
  );
}

describe("Kazusa browser proxy", () => {
  it("denies every visitor mutation and operational read before forwarding", async () => {
    for (const [path, policy] of KAZUSA_ROUTES) {
      if (!policy.proxy || policy.permission === "observe") continue;
      const response = await call(path, policy.method, {
        "x-kazusa-role": "owner",
        Authorization: "Bearer attacker",
      });
      expect(response.status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("serves viewer metadata uncached without contacting the Gateway", async () => {
    const response = await call("access");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });
    expect((await call("access", "POST")).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("replaces all incoming credentials and keeps ordinary reads intact", async () => {
    upstream.mockResolvedValue(
      new Response('{"chats":[]}', {
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await call("chats?query=hello&token=attacker", "GET", {
      Authorization: "Bearer attacker",
      "x-kazusa-role": "owner",
      "x-kazusa-user-id": "admin",
    });
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url instanceof URL ? url.href : url).toBe(
      "http://127.0.0.1:18789/kazusa/chats?query=hello",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-service-token");
    expect(headers.get("x-kazusa-role")).toBe("visitor");
    expect(headers.has("x-kazusa-user-id")).toBe(false);
    expect(await response.json()).toEqual({ chats: [] });
  });

  it("streams SSE without buffering and passes cancellation upstream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("event: connected\ndata: {}\n\n"),
        );
        controller.close();
      },
    });
    upstream.mockResolvedValue(
      new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
        },
      }),
    );
    const response = await call("events");
    expect(response.body).toBe(stream);
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(upstream.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(await response.text()).toContain("event: connected");
  });

  it("preserves local writes and same-origin checks", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    const local = "http://localhost:3000";
    upstream.mockResolvedValue(new Response("{}"));
    expect((await call("clock", "POST", { Origin: local }, local)).status).toBe(
      200,
    );
    expect(
      new Headers(upstream.mock.calls[0][1]?.headers).get("x-kazusa-role"),
    ).toBe("owner");
    expect(
      (
        await call(
          "clock",
          "POST",
          { Origin: "https://elsewhere.example" },
          local,
        )
      ).status,
    ).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("refuses rebound DNS names in local mode, even same-origin", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    upstream.mockResolvedValue(new Response("{}"));
    for (const origin of [
      "http://rebind.example:3000",
      "http://127.0.0.1.nip.io:3000",
      "http://localhost.example:3000",
    ]) {
      expect((await call("access", "GET", {}, origin)).status).toBe(403);
      expect((await call("chats", "GET", {}, origin)).status).toBe(403);
      expect(
        (await call("clock", "POST", { Origin: origin }, origin)).status,
      ).toBe(403);
    }
    for (const origin of [
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://kazusa.localhost:3000",
    ])
      expect((await call("access", "GET", {}, origin)).status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses unknown/private routes, wrong methods, and missing configuration", async () => {
    for (const path of ["unknown", "memory/consolidate"])
      expect((await call(path)).status).toBe(404);
    expect((await call("clock")).status).toBe(405);
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", undefined);
    expect((await call("world")).status).toBe(503);
    vi.stubEnv("KAZUSA_AUTH_MODE", "typo");
    expect((await call("access")).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("trusted-proxy browser proxy", () => {
  const SECRET = "proxy-shared-secret";
  const ORIGIN = "https://cloud.example";

  beforeEach(() => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", SECRET);
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "test-service-token");
    vi.stubEnv("KAZUSA_GATEWAY_URL", "http://127.0.0.1:18789");
    upstream.mockReset();
  });

  it("rejects calls without proxy credentials", async () => {
    const response = await call("access", "GET", {}, ORIGIN);
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("serves access metadata for authenticated owner and visitor", async () => {
    // Owner
    const ownerRes = await call(
      "access",
      "GET",
      {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "owner",
      },
      ORIGIN,
    );
    expect(ownerRes.status).toBe(200);
    expect(await ownerRes.json()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: false,
    });

    // Visitor
    const visitorRes = await call(
      "access",
      "GET",
      {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "visitor",
      },
      ORIGIN,
    );
    expect(visitorRes.status).toBe(200);
    expect(await visitorRes.json()).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards owner mutations to Gateway with service token and owner role", async () => {
    upstream.mockResolvedValue(
      new Response('{"success":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await call(
      "clock",
      "POST",
      {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "owner",
        Origin: ORIGIN,
      },
      ORIGIN,
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-service-token");
    expect(headers.get("x-kazusa-role")).toBe("owner");
  });

  it("blocks visitor mutations before calling upstream Gateway", async () => {
    const response = await call(
      "clock",
      "POST",
      {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "visitor",
        Origin: ORIGIN,
      },
      ORIGIN,
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects duplicate or unsupported roles with 401 without contacting Gateway", async () => {
    for (const role of ["collaborator", "owner, visitor", "admin"]) {
      const response = await call(
        "chats",
        "GET",
        {
          "x-kazusa-proxy-secret": SECRET,
          "x-kazusa-role": role,
        },
        ORIGIN,
      );
      expect(response.status).toBe(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});
