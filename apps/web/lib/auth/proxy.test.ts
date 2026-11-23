import { KAZUSA_ROUTES } from "@kazusa/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/kazusa/[...path]/route";
import { readLive, readSlow } from "../proxy/visitor-read";
import { resetWorldChanges } from "../proxy/world-changes";

// Next's cache only exists inside Next: here `use cache` is an ordinary call,
// so these tests cover what is asked for and under which count, not the
// keeping itself (measured against a real server; see `visitor-read.ts`).
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("../proxy/visitor-read", async (original) => {
  const actual = await original<typeof import("../proxy/visitor-read")>();
  return {
    ...actual,
    readLive: vi.fn(actual.readLive),
    readSlow: vi.fn(actual.readSlow),
  };
});

const upstream = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("KAZUSA_AUTH_MODE", "public");
  vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "test-service-token");
  vi.stubEnv("KAZUSA_GATEWAY_URL", "http://127.0.0.1:18789");
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
  resetWorldChanges();
  vi.mocked(readLive).mockClear();
  vi.mocked(readSlow).mockClear();
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
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    expect(upstream.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(await response.text()).toContain("event: connected");
  });

  it("reads for a visitor under the count of changes seen so far", async () => {
    const json = () =>
      new Response('{"characters":[]}', {
        headers: { "content-type": "application/json" },
      });
    upstream.mockImplementation(async () => json());
    const first = await call(`characters?junk=${Math.random()}&limit=5`);
    expect(first.status).toBe(200);
    // Kept under the route, its known parameters and the count: a made-up
    // parameter is not a new thing to read.
    expect(vi.mocked(readLive).mock.calls).toEqual([["characters?limit=5", 0]]);
    const [url, init] = upstream.mock.calls[0];
    expect(url instanceof URL ? url.search : url).toBe("?limit=5");
    expect(new Headers(init?.headers).get("x-kazusa-role")).toBe("visitor");
    await call("places");
    expect(vi.mocked(readSlow).mock.calls).toEqual([["places", 0]]);

    // The browser that already has it is told so.
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).not.toBe("");
    const again = await call("characters?limit=5", "GET", {
      "If-None-Match": etag,
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    // Compared weakly, as RFC 9110 has it, and `*` names any answer.
    for (const known of [`W/${etag}`, `"other", ${etag}`, "*"])
      expect(
        (await call("characters?limit=5", "GET", { "If-None-Match": known }))
          .status,
      ).toBe(304);
    expect(
      (await call("characters?limit=5", "GET", { "If-None-Match": '"other"' }))
        .status,
    ).toBe(200);

    // An event on anyone's stream: what is read next is read anew. Someone
    // talking isn't an edit to the map; a write through here is.
    upstream.mockImplementationOnce(
      async () =>
        new Response(
          new TextEncoder().encode('event: status\ndata: {"a":1}\n\n'),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    await (await call("events")).text();
    await call("characters");
    await call("places");
    expect(vi.mocked(readLive).mock.calls.at(-1)).toEqual(["characters", 1]);
    expect(vi.mocked(readSlow).mock.calls.at(-1)).toEqual(["places", 0]);
  });

  it("passes the Gateway's refusal on, and never asks it twice", async () => {
    upstream.mockImplementation(
      async () =>
        new Response('{"error":"No chat called x."}', {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const refused = await call("messages?chatId=x");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "No chat called x." });
    expect(refused.headers.has("etag")).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);

    // No answer at all: a 502, after one try, not a second per reader.
    upstream.mockReset();
    upstream.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const unreachable = await call("timeline?limit=5");
    expect(unreachable.status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("never holds the world's clock, a stream or a picture", async () => {
    upstream.mockImplementation(async () => new Response("{}"));
    for (const path of ["world", "avatar?id=a", "portrait?id=a&name=b"])
      await call(path);
    expect(readLive).not.toHaveBeenCalled();
    expect(readSlow).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("never keeps an owner's reads", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    const local = "http://localhost:3000";
    upstream.mockImplementation(async () => new Response("{}"));
    await call("characters", "GET", undefined, local);
    const second = await call("characters?junk=1", "GET", undefined, local);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(readLive).not.toHaveBeenCalled();
    expect(second.headers.has("etag")).toBe(false);
    // And what they ask is passed on as asked.
    const [url] = upstream.mock.calls[1];
    expect(url instanceof URL ? url.search : url).toBe("?junk=1");
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
