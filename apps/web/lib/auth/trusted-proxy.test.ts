import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/kazusa/[...path]/route";
import { GET as updateGet } from "../../app/update/route";
import { POST as setupPost } from "../../app/setup/route";

const upstream = vi.fn<typeof fetch>();
const PROXY_SECRET = "cloud-wrapper-shared-secret-key-12345";
const APP_ORIGIN = "https://world.openrp.ai";

beforeEach(() => {
  vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
  vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", PROXY_SECRET);
  vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "gateway-internal-token");
  vi.stubEnv("KAZUSA_GATEWAY_URL", "http://127.0.0.1:18789");
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * A minimal upstream reverse proxy simulation (representing the OpenRP cloud
 * wrapper). It authenticates the client session, validates world membership,
 * overwrites identity headers, attaches the private proxy secret, and forwards
 * the request to Kazusa.
 */
class CloudWrapperProxy {
  async handleIncomingClientRequest(params: {
    clientSession?: { userId: string; role: "owner" | "visitor" };
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

    // The wrapper creates clean forwarded headers, stripping client-supplied identity
    const headers = new Headers(clientForgedHeaders);

    // If client is authenticated with the wrapper, attach the secret and verified role
    if (clientSession) {
      headers.set("x-kazusa-proxy-secret", PROXY_SECRET);
      headers.set("x-kazusa-role", clientSession.role);
      headers.set("x-kazusa-user-id", clientSession.userId);
    }
    headers.set("Origin", APP_ORIGIN);

    const req = new Request(`${APP_ORIGIN}/kazusa/${path}`, {
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

  it("authenticates the owner through wrapper and allows mutations to gateway", async () => {
    upstream.mockResolvedValue(
      new Response('{"clock":{"running":true}}', {
        headers: { "content-type": "application/json" },
      }),
    );

    // 1. Owner checks access
    const accessRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-owner-1", role: "owner" },
      path: "access",
    });
    expect(accessRes.status).toBe(200);
    expect(await accessRes.json()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: false,
    });

    // 2. Owner mutates clock
    const clockRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-owner-1", role: "owner" },
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

  it("authenticates visitor through wrapper and blocks mutations while allowing reads", async () => {
    upstream.mockResolvedValue(
      new Response('{"chats":[]}', {
        headers: { "content-type": "application/json" },
      }),
    );

    // 1. Visitor checks access
    const accessRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-guest-2", role: "visitor" },
      path: "access",
    });
    expect(accessRes.status).toBe(200);
    expect(await accessRes.json()).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });

    // 2. Visitor tries to mutate clock -> blocked 403 without reaching gateway
    const clockRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-guest-2", role: "visitor" },
      path: "clock",
      method: "POST",
      body: '{"action":"play"}',
    });
    expect(clockRes.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    // 3. Visitor reads chats -> allowed
    const chatsRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-guest-2", role: "visitor" },
      path: "chats",
    });
    expect(chatsRes.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0];
    expect(new Headers(init?.headers).get("x-kazusa-role")).toBe("visitor");
  });

  it("blocks direct requests bypassing the wrapper or attempting to forge owner role", async () => {
    // Direct attacker sending requests directly to Kazusa without proxy secret
    const directReq = await proxy.handleIncomingClientRequest({
      path: "access",
      clientForgedHeaders: {
        "x-kazusa-role": "owner",
        Authorization: "Bearer attacker-token",
      },
    });
    expect(directReq.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();

    // Direct attacker with wrong secret
    const wrongSecretReq = await proxy.handleIncomingClientRequest({
      path: "access",
      clientForgedHeaders: {
        "x-kazusa-proxy-secret": "wrong-secret",
        "x-kazusa-role": "owner",
      },
    });
    expect(wrongSecretReq.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("reflects revoked access immediately when wrapper revokes owner session", async () => {
    // Active owner
    const initialRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-owner-1", role: "owner" },
      path: "access",
    });
    expect((await initialRes.json()).role).toBe("owner");

    // Session is revoked upstream -> wrapper downgrades to visitor or drops secret
    const revokedRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-owner-1", role: "visitor" },
      path: "access",
    });
    expect((await revokedRes.json()).role).toBe("visitor");

    // Subsequent write attempt is blocked
    const clockRes = await proxy.handleIncomingClientRequest({
      clientSession: { userId: "user-owner-1", role: "visitor" },
      path: "clock",
      method: "POST",
    });
    expect(clockRes.status).toBe(403);
  });

  it("protects desktop-only host routes from cloud wrapper users", async () => {
    const updateReq = new Request(`${APP_ORIGIN}/update?boot=1`, {
      headers: {
        "x-kazusa-proxy-secret": PROXY_SECRET,
        "x-kazusa-role": "owner",
        Origin: APP_ORIGIN,
      },
    });
    expect((await updateGet(updateReq)).status).toBe(403);

    const setupReq = new Request(`${APP_ORIGIN}/setup`, {
      method: "POST",
      headers: {
        "x-kazusa-proxy-secret": PROXY_SECRET,
        "x-kazusa-role": "owner",
        Origin: APP_ORIGIN,
      },
    });
    expect((await setupPost(setupReq)).status).toBe(403);
  });
});
