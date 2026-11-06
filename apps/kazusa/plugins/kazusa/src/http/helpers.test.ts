import type { IncomingMessage } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAuth, resolveAuthToken } from "./helpers.ts";

const apiWith = (token?: string) =>
  ({
    config: token ? { gateway: { auth: { token } } } : {},
  }) as unknown as OpenClawPluginApi;

describe("Gateway token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("comes from the environment when the config has none", () => {
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "from-env");
    expect(resolveAuthToken(apiWith())).toBe("from-env");
    expect(resolveAuthToken(apiWith("from-config"))).toBe("from-config");
  });

  it("refuses a request without it", () => {
    const request = (authorization?: string) =>
      ({ headers: { authorization }, url: "/kazusa/send" }) as IncomingMessage;
    expect(checkAuth(request(), "secret")).toBe(false);
    expect(checkAuth(request("Bearer wrong"), "secret")).toBe(false);
    expect(checkAuth(request("Bearer secret"), "secret")).toBe(true);
    expect(checkAuth(request("Bearer secret"))).toBe(false);
    expect(checkAuth(request())).toBe(false);
  });

  it("is never read from the URL, where browsers and logs keep it", () => {
    expect(
      checkAuth(
        { headers: {}, url: "/kazusa/events?token=secret" } as IncomingMessage,
        "secret",
      ),
    ).toBe(false);
  });
});
