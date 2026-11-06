import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, requireLocalOwner, resolveViewer } from "./access";

afterEach(() => vi.unstubAllEnvs());

describe("server-resolved viewer", () => {
  it("grants the local owner access without a login", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", undefined);
    expect(resolveViewer()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: true,
    });
    expect(
      requireLocalOwner(new Request("http://localhost/setup")),
    ).toBeUndefined();
  });

  it("denies host operations for public visitors even with spoofed identity", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "public");
    const request = new Request("https://demo.example/setup", {
      headers: { "x-kazusa-role": "owner", "x-forwarded-for": "127.0.0.1" },
    });
    expect(resolveViewer(request).role).toBe("visitor");
    expect(requireLocalOwner(request)?.status).toBe(403);
  });

  it("fails closed for invalid modes and cross-origin owner requests", () => {
    const request = new Request("http://localhost/update", {
      headers: { Origin: "https://elsewhere.example" },
    });
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    expect(requireLocalOwner(request)?.status).toBe(403);
    vi.stubEnv("KAZUSA_AUTH_MODE", "invalid-mode");
    expect(() => resolveViewer(request)).toThrow();
    expect(requireLocalOwner(request)?.status).toBe(503);
  });
});

describe("trusted-proxy authentication", () => {
  const SECRET = "super-secret-wrapper-token";

  it("fails closed with 503 when proxy secret is not configured on the server", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", undefined);
    vi.stubEnv("KAZUSA_PROXY_SECRET", undefined);
    const req = new Request("https://demo.example/kazusa/access", {
      headers: { "x-kazusa-proxy-secret": SECRET },
    });
    let error: AuthError | undefined;
    try {
      resolveViewer(req);
    } catch (err) {
      error = err as AuthError;
    }
    expect(error?.status).toBe(503);
  });

  it("rejects requests missing or providing incorrect proxy credentials", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", SECRET);

    // Missing secret
    const noSecret = new Request("https://demo.example/kazusa/access");
    let noSecretError: AuthError | undefined;
    try {
      resolveViewer(noSecret);
    } catch (err) {
      noSecretError = err as AuthError;
    }
    expect(noSecretError?.status).toBe(401);

    // Wrong secret
    const wrongSecret = new Request("https://demo.example/kazusa/access", {
      headers: { "x-kazusa-proxy-secret": "wrong-secret" },
    });
    let wrongSecretError: AuthError | undefined;
    try {
      resolveViewer(wrongSecret);
    } catch (err) {
      wrongSecretError = err as AuthError;
    }
    expect(wrongSecretError?.status).toBe(401);
  });

  it("accepts valid proxy secret via x-kazusa-proxy-secret or Bearer Authorization", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", SECRET);

    // via custom header
    const customReq = new Request("https://demo.example/kazusa/access", {
      headers: {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "owner",
      },
    });
    expect(resolveViewer(customReq)).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
      local: false,
    });

    // via Bearer header
    const bearerReq = new Request("https://demo.example/kazusa/access", {
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "x-kazusa-role": "visitor",
      },
    });
    expect(resolveViewer(bearerReq)).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });

    // missing role header defaults to visitor
    const noRoleReq = new Request("https://demo.example/kazusa/access", {
      headers: {
        "x-kazusa-proxy-secret": SECRET,
      },
    });
    expect(resolveViewer(noRoleReq)).toEqual({
      role: "visitor",
      permissions: ["observe"],
      local: false,
    });
  });

  it("rejects duplicate, malformed, or unsupported roles", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", SECRET);

    for (const badRole of [
      "collaborator",
      "admin",
      "owner, visitor",
      "unknown",
    ]) {
      const req = new Request("https://demo.example/kazusa/access", {
        headers: {
          "x-kazusa-proxy-secret": SECRET,
          "x-kazusa-role": badRole,
        },
      });
      let roleError: AuthError | undefined;
      try {
        resolveViewer(req);
      } catch (err) {
        roleError = err as AuthError;
      }
      expect(roleError?.status).toBe(401);
    }
  });

  it("forbids desktop host routes even when authenticated as owner in trusted-proxy mode", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_TRUSTED_PROXY_SECRET", SECRET);

    const ownerReq = new Request("https://demo.example/update", {
      headers: {
        "x-kazusa-proxy-secret": SECRET,
        "x-kazusa-role": "owner",
        Origin: "https://demo.example",
      },
    });
    expect(requireLocalOwner(ownerReq)?.status).toBe(403);
  });
});
