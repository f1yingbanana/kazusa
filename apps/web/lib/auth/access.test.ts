import { afterEach, describe, expect, it, vi } from "vitest";
import { requireLocalOwner, resolveViewer } from "./access";

afterEach(() => vi.unstubAllEnvs());

describe("server-resolved viewer", () => {
  it("grants the local owner access without a login", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", undefined);
    expect(resolveViewer()).toEqual({
      role: "owner",
      permissions: ["observe", "play", "manage"],
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
    expect(resolveViewer().role).toBe("visitor");
    expect(requireLocalOwner(request)?.status).toBe(403);
  });

  it("fails closed for invalid modes and cross-origin owner requests", () => {
    const request = new Request("http://localhost/update", {
      headers: { Origin: "https://elsewhere.example" },
    });
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    expect(requireLocalOwner(request)?.status).toBe(403);
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    expect(() => resolveViewer()).toThrow();
    expect(requireLocalOwner(request)?.status).toBe(503);
  });
});
