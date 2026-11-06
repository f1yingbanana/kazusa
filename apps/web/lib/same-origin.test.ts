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

  it("accepts reverse-proxied requests via KAZUSA_PUBLIC_ORIGIN or x-forwarded-host", () => {
    vi.stubEnv("KAZUSA_PUBLIC_ORIGIN", "https://world.openrp.ai");
    expect(
      isSameOrigin(
        request({
          origin: "https://world.openrp.ai",
          host: "kazusa-internal:3000",
        }),
      ),
    ).toBe(true);

    // Mismatched origin rejected even with KAZUSA_PUBLIC_ORIGIN configured
    expect(
      isSameOrigin(
        request({
          origin: "https://attacker.example",
          host: "kazusa-internal:3000",
        }),
      ),
    ).toBe(false);

    // Without KAZUSA_PUBLIC_ORIGIN, accepts x-forwarded-host
    vi.stubEnv("KAZUSA_PUBLIC_ORIGIN", undefined);
    expect(
      isSameOrigin(
        request({
          origin: "https://custom.openrp.ai",
          host: "kazusa-internal:3000",
          "x-forwarded-host": "custom.openrp.ai",
        }),
      ),
    ).toBe(true);
  });
});
