import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOrigin } from "./same-origin";

const request = (headers: Record<string, string>) =>
  new Request("http://localhost:3000/setup", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("isSameOrigin", () => {
  it("accepts a page on either loopback name", () => {
    expect(
      isSameOrigin(
        request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        request({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
    ).toBe(true);
  });

  it("refuses another site or port", () => {
    expect(
      isSameOrigin(
        request({ origin: "https://evil.example", host: "127.0.0.1:3000" }),
      ),
    ).toBe(false);
    expect(
      isSameOrigin(
        request({ origin: "http://127.0.0.1:9", host: "127.0.0.1:3000" }),
      ),
    ).toBe(false);
    expect(
      isSameOrigin(request({ origin: "null", host: "127.0.0.1:3000" })),
    ).toBe(false);
  });

  it("allows callers that are not browsers", () => {
    expect(isSameOrigin(request({ host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("ignores KAZUSA_PUBLIC_ORIGIN and forwarded host in local and public modes", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    vi.stubEnv("KAZUSA_PUBLIC_ORIGIN", "https://world.openrp.ai");
    expect(
      isSameOrigin(
        request({
          origin: "https://world.openrp.ai",
          host: "127.0.0.1:3000",
        }),
      ),
    ).toBe(false);

    expect(
      isSameOrigin(
        request({
          origin: "https://world.openrp.ai",
          host: "127.0.0.1:3000",
          "x-forwarded-host": "world.openrp.ai",
        }),
      ),
    ).toBe(false);

    vi.stubEnv("KAZUSA_AUTH_MODE", "public");
    expect(
      isSameOrigin(
        request({
          origin: "https://world.openrp.ai",
          host: "demo.example:3000",
        }),
      ),
    ).toBe(false);
  });

  it("accepts reverse-proxied requests via KAZUSA_PUBLIC_ORIGIN strictly in trusted-proxy mode", () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "trusted-proxy");
    vi.stubEnv("KAZUSA_PUBLIC_ORIGIN", "https://world.openrp.ai");

    expect(
      isSameOrigin(
        request({
          origin: "https://world.openrp.ai",
          host: "kazusa-internal:3000",
        }),
      ),
    ).toBe(true);

    // Mismatched origin rejected even in trusted-proxy mode
    expect(
      isSameOrigin(
        request({
          origin: "https://attacker.example",
          host: "kazusa-internal:3000",
        }),
      ),
    ).toBe(false);

    // Client-sent x-forwarded-host without matching KAZUSA_PUBLIC_ORIGIN is rejected
    expect(
      isSameOrigin(
        request({
          origin: "https://attacker.example",
          host: "kazusa-internal:3000",
          "x-forwarded-host": "attacker.example",
        }),
      ),
    ).toBe(false);
  });
});
