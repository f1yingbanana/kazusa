import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST as PROXY_POST } from "../../app/kazusa/[...path]/route";
import { DELETE, POST } from "../../app/owner/route";
import { requireLocalOwner, resolveViewer } from "./access";
import { MAX_AGE_S, ownerCookie } from "./owner-session";

const TOKEN = "a".repeat(64);
const ORIGIN = "https://kazusa.example";
const upstream = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("KAZUSA_AUTH_MODE", "public");
  vi.stubEnv("KAZUSA_OWNER_SIGN_IN", "1");
  vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", TOKEN);
  vi.stubGlobal("fetch", upstream);
  upstream.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function signIn(token: unknown, headers?: HeadersInit): Promise<Response> {
  return POST(
    new Request(`${ORIGIN}/owner`, {
      method: "POST",
      headers: { Origin: ORIGIN, Host: "kazusa.example", ...headers },
      body: JSON.stringify({ token }),
    }),
  );
}

/** The `name=value` a browser would send back. */
function sessionOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function viewerWith(cookie: string) {
  return resolveViewer(new Headers({ cookie }));
}

describe("owner sign-in on a public frontend", () => {
  it("keeps every browser a visitor until it signs in", () => {
    expect(resolveViewer(new Headers())).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
      signIn: true,
    });
  });

  it("signs in with the Gateway token into an HttpOnly, strict cookie", async () => {
    const response = await signIn(TOKEN, { "x-forwarded-proto": "https" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "owner" });
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
    // The cookie is a signature, never the token.
    expect(header).not.toContain(TOKEN);
    const viewer = viewerWith(sessionOf(response));
    expect(viewer.role).toBe("owner");
    expect(viewer.local).toBe(false);
  });

  it("refuses a wrong, missing, oversized or cross-site sign-in", async () => {
    expect((await signIn("b".repeat(64))).status).toBe(401);
    expect((await signIn(undefined)).status).toBe(401);
    expect((await signIn(`${TOKEN} `.repeat(30))).status).toBe(413);
    const crossSite = await signIn(TOKEN, {
      Origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("set-cookie")).toBeNull();
  });

  it("trusts no forged, stale, doubled or old-token session", async () => {
    const good = sessionOf(await signIn(TOKEN));
    const [name, value] = good.split("=");
    const [issued] = value.split(".");
    expect(viewerWith(`${name}=${issued}.forged`).role).toBe("visitor");
    expect(
      viewerWith(`${name}=${Number(issued) - 10}.${value.split(".")[1]}`).role,
    ).toBe("visitor");
    expect(viewerWith(`${good}; ${good}`).role).toBe("visitor");
    const old = ownerCookie(
      new Request(ORIGIN),
      Date.now() - (MAX_AGE_S + 60) * 1000,
    ).split(";")[0];
    expect(viewerWith(old).role).toBe("visitor");
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "c".repeat(64));
    expect(viewerWith(good).role).toBe("visitor");
  });

  it("is off unless the launcher turned it on", async () => {
    const good = sessionOf(await signIn(TOKEN));
    vi.stubEnv("KAZUSA_OWNER_SIGN_IN", undefined);
    expect(viewerWith(good)).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });
    expect((await signIn(TOKEN)).status).toBe(404);
    vi.stubEnv("KAZUSA_OWNER_SIGN_IN", "1");
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    expect((await signIn(TOKEN)).status).toBe(404);
  });

  it("signs out by clearing the cookie", async () => {
    const response = DELETE(
      new Request(`${ORIGIN}/owner`, {
        method: "DELETE",
        headers: { Origin: ORIGIN, Host: "kazusa.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "visitor" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("forwards a signed-in owner as owner, and nobody else", async () => {
    const good = sessionOf(await signIn(TOKEN));
    upstream.mockResolvedValue(Response.json({ ok: true }));
    const call = (cookie: string) =>
      PROXY_POST(
        new Request(`${ORIGIN}/kazusa/wiki/save`, {
          method: "POST",
          headers: { cookie, Origin: ORIGIN, Host: "kazusa.example" },
          body: "{}",
        }),
        { params: Promise.resolve({ path: ["wiki", "save"] }) },
      );
    expect((await call("")).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect((await call(good)).status).toBe(200);
    const headers = new Headers(upstream.mock.calls[0][1]?.headers);
    expect(headers.get("x-kazusa-role")).toBe("owner");
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    const access = await GET(
      new Request(`${ORIGIN}/kazusa/access`, { headers: { cookie: good } }),
      { params: Promise.resolve({ path: ["access"] }) },
    );
    expect(await access.json()).toMatchObject({ role: "owner", signIn: true });
  });

  it("still keeps desktop-only operations off the internet", async () => {
    const good = sessionOf(await signIn(TOKEN));
    const request = new Request(`${ORIGIN}/setup`, {
      method: "POST",
      headers: { cookie: good, Origin: ORIGIN, Host: "kazusa.example" },
    });
    expect(requireLocalOwner(request)?.status).toBe(403);
  });
});
