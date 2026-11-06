import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/kazusa/[...path]/route";
import { POST as setupPost } from "../../app/setup/route";
import { GET as updateGet } from "../../app/update/route";

const upstream = vi.fn<typeof fetch>();
const PROXY_SECRET = "cloud-wrapper-shared-secret-key-12345";
const PUBLIC_ORIGIN = "https://world.openrp.ai";
const WORLD_ID = "world-42";
const INTERNAL_HOST = "kazusa-world-42.internal:3000";

const nativeFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
  vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", PROXY_SECRET);
  vi.stubEnv("KAZUSA_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("KAZUSA_WORLD_ID", WORLD_ID);
  vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "gateway-internal-token");
  vi.stubEnv("KAZUSA_GATEWAY_URL", "http://127.0.0.1:18789");
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : "href" in input
            ? input.href
            : input.url;
      if (url.startsWith("http://127.0.0.1:18789")) {
        return upstream(input, init);
      }
      return nativeFetch(input, init);
    },
  );
  upstream.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * An upstream reverse proxy representing the OpenRP Cloud wrapper. Forwards
 * requests across network boundaries to the internal container address
 * (`http://kazusa-world-42.internal:3000`), while maintaining the public Origin
 * (`https://world.openrp.ai`) and attaching the world-scoped proxy secret.
 */
class CloudWrapperProxy {
  async forward(params: {
    clientSession?: { role: "owner" | "visitor"; worldId?: string };
    path: string;
    method?: string;
    body?: string;
    clientForgedHeaders?: Record<string, string>;
  }): Promise<Response> {
    const {
      clientSession,
      path,
      method = "GET",
      body,
      clientForgedHeaders = {},
    } = params;

    const headers = new Headers(clientForgedHeaders);

    // Upstream wrapper validates user membership, strips caller identity,
    // and injects the private secret, destination world ID, and verified role.
    if (clientSession) {
      headers.set("x-kazusa-proxy-secret", PROXY_SECRET);
      headers.set("x-kazusa-role", clientSession.role);
      headers.set("x-kazusa-world-id", clientSession.worldId ?? WORLD_ID);
    }
    // Browser sends its own public origin
    headers.set("Origin", PUBLIC_ORIGIN);
    // Wrapper communicates with the internal container address
    headers.set("Host", INTERNAL_HOST);
    headers.set("x-forwarded-host", new URL(PUBLIC_ORIGIN).host);

    const req = new Request(`http://${INTERNAL_HOST}/kazusa/${path}`, {
      method,
      headers,
      body: method === "POST" ? (body ?? "{}") : undefined,
    });

    const routeParams = {
      params: Promise.resolve({ path: path.split("?")[0].split("/") }),
    };
    return (method === "POST" ? POST : GET)(req, routeParams);
  }
}

describe("trusted-proxy end-to-end wrapper integration", () => {
  const proxy = new CloudWrapperProxy();

  it("allows owner writes when wrapper forwards from public domain to internal container", async () => {
    upstream.mockResolvedValue(
      new Response('{"clock":{"running":true}}', {
        headers: { "content-type": "application/json" },
      }),
    );

    // 1. Owner checks access (internal Host != public Origin)
    const accessRes = await proxy.forward({
      clientSession: { role: "owner" },
      path: "access",
    });
    expect(accessRes.status).toBe(200);
    expect(await accessRes.json()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: false,
    });

    // 2. Owner mutates clock -> same-origin check passes via KAZUSA_PUBLIC_ORIGIN
    const clockRes = await proxy.forward({
      clientSession: { role: "owner" },
      path: "clock",
      method: "POST",
      body: '{"action":"play"}',
    });
    expect(clockRes.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);

    const [, init] = upstream.mock.calls[0];
    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("authorization")).toBe(
      "Bearer gateway-internal-token",
    );
    expect(forwardedHeaders.get("x-kazusa-role")).toBe("owner");
  });

  it("blocks visitor mutations while allowing reads", async () => {
    upstream.mockResolvedValue(
      new Response('{"chats":[]}', {
        headers: { "content-type": "application/json" },
      }),
    );

    // 1. Visitor checks access
    const accessRes = await proxy.forward({
      clientSession: { role: "visitor" },
      path: "access",
    });
    expect(accessRes.status).toBe(200);
    expect(await accessRes.json()).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });

    // 2. Visitor tries to mutate clock -> blocked with 403 without reaching gateway
    const clockRes = await proxy.forward({
      clientSession: { role: "visitor" },
      path: "clock",
      method: "POST",
      body: '{"action":"play"}',
    });
    expect(clockRes.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    // 3. Visitor reads chats -> allowed
    const chatsRes = await proxy.forward({
      clientSession: { role: "visitor" },
      path: "chats",
    });
    expect(chatsRes.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0];
    expect(new Headers(init?.headers).get("x-kazusa-role")).toBe("visitor");
  });

  it("fails closed when wrapper drops or omits the role header", async () => {
    // Wrapper attaches secret but forgets/drops x-kazusa-role
    const res = await proxy.forward({
      path: "access",
      clientForgedHeaders: {
        "x-kazusa-proxy-secret": PROXY_SECRET,
        "x-kazusa-world-id": WORLD_ID,
      },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing viewer role header." });
  });

  it("enforces world-specific binding rejecting requests destined for another world", async () => {
    // Wrapper routes request intended for world-99 to world-42
    const mismatchedRes = await proxy.forward({
      clientSession: { role: "owner", worldId: "world-99" },
      path: "access",
    });
    expect(mismatchedRes.status).toBe(401);
    expect(await mismatchedRes.json()).toEqual({
      error: "Unauthorized: Request world does not match destination instance.",
    });
  });

  it("blocks direct requests bypassing the wrapper or attempting to forge owner role", async () => {
    // Direct attacker without proxy secret
    const directReq = await proxy.forward({
      path: "access",
      clientForgedHeaders: {
        "x-kazusa-role": "owner",
        Authorization: "Bearer attacker-token",
      },
    });
    expect(directReq.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();

    // Direct attacker with wrong secret
    const wrongSecretReq = await proxy.forward({
      path: "access",
      clientForgedHeaders: {
        "x-kazusa-proxy-secret": "wrong-secret",
        "x-kazusa-role": "owner",
      },
    });
    expect(wrongSecretReq.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("streams SSE events through proxy and passes abort signal to upstream", async () => {
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
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        },
      }),
    );

    const res = await proxy.forward({
      clientSession: { role: "visitor" },
      path: "events",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(await res.text()).toContain("event: connected");
  });

  it("protects desktop-only host routes from cloud wrapper users", async () => {
    const updateReq = new Request(`http://${INTERNAL_HOST}/update?boot=1`, {
      headers: {
        "x-kazusa-proxy-secret": PROXY_SECRET,
        "x-kazusa-role": "owner",
        "x-kazusa-world-id": WORLD_ID,
        Origin: PUBLIC_ORIGIN,
      },
    });
    expect((await updateGet(updateReq)).status).toBe(403);

    const setupReq = new Request(`http://${INTERNAL_HOST}/setup`, {
      method: "POST",
      headers: {
        "x-kazusa-proxy-secret": PROXY_SECRET,
        "x-kazusa-role": "owner",
        "x-kazusa-world-id": WORLD_ID,
        Origin: PUBLIC_ORIGIN,
      },
    });
    expect((await setupPost(setupReq)).status).toBe(403);
  });
});

describe("real HTTP socket reverse proxy", () => {
  let proxyServer: Server;
  let proxyUrl: string;

  beforeEach(async () => {
    // Spin up an actual Node.js HTTP server acting as the network reverse proxy
    proxyServer = createServer(async (req, res) => {
      // Proxy verifies client auth and injects secret & verified role
      const clientRole = req.headers["authorization"] ? "owner" : "visitor";
      const headers = new Headers();
      headers.set("x-kazusa-proxy-secret", PROXY_SECRET);
      headers.set("x-kazusa-role", clientRole);
      headers.set("x-kazusa-world-id", WORLD_ID);
      headers.set("Origin", PUBLIC_ORIGIN);
      headers.set("Host", INTERNAL_HOST);

      const nextReq = new Request(
        `http://${INTERNAL_HOST}${req.url ?? "/kazusa/access"}`,
        {
          method: req.method ?? "GET",
          headers,
        },
      );

      const path = (req.url ?? "/kazusa/access")
        .replace(/^\/kazusa\//, "")
        .split("?")[0]
        .split("/");
      const response = await (req.method === "POST" ? POST : GET)(nextReq, {
        params: Promise.resolve({ path }),
      });

      res.writeHead(response.status, {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
      });
      res.end(await response.text());
    });

    await new Promise<void>((resolve) => {
      proxyServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = proxyServer.address() as AddressInfo;
    proxyUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  });

  it("handles real HTTP requests across TCP socket for owner and visitor", async () => {
    // 1. Client connects to proxy with authorization -> recognized as owner
    const ownerRes = await fetch(`${proxyUrl}/kazusa/access`, {
      headers: { Authorization: "Bearer user-token-123" },
    });
    expect(ownerRes.status).toBe(200);
    expect(await ownerRes.json()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: false,
    });

    // 2. Client connects to proxy without authorization -> recognized as visitor
    const visitorRes = await fetch(`${proxyUrl}/kazusa/access`);
    expect(visitorRes.status).toBe(200);
    expect(await visitorRes.json()).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });
  });
});
