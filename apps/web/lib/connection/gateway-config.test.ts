import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/connection/route";
import {
  DEFAULT_GATEWAY_URL,
  GatewayConfigError,
  normalizeGatewayUrl,
  saveGatewayConnection,
  upsertEnvContent,
} from "./gateway-config";

describe("gateway-config", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "kazusa-conn-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("normalizes valid http/https URLs and rejects invalid or credentialed ones", () => {
    expect(normalizeGatewayUrl("  https://gw.example.ts.net:18789/// ")).toBe(
      "https://gw.example.ts.net:18789",
    );
    expect(normalizeGatewayUrl("http://100.64.0.5:18789/proxy/")).toBe(
      "http://100.64.0.5:18789/proxy",
    );
    expect(() => normalizeGatewayUrl("")).toThrow(GatewayConfigError);
    expect(() => normalizeGatewayUrl("ftp://gw.example:18789")).toThrow(
      GatewayConfigError,
    );
    expect(() => normalizeGatewayUrl("https://user:pass@gw.example")).toThrow(
      GatewayConfigError,
    );
  });

  it("preserves unrelated env vars when updating .env.local", () => {
    const initial = [
      "# custom comment",
      "KAZUSA_GATEWAY_URL=http://127.0.0.1:18789",
      'OPENCLAW_GATEWAY_TOKEN="old-token"',
      "KAZUSA_CUSTOM=keep-me",
      "",
    ].join("\n");
    const updated = upsertEnvContent(initial, {
      KAZUSA_GATEWAY_URL: "https://remote.example:18789",
      OPENCLAW_GATEWAY_TOKEN: "new token with spaces",
    });
    expect(updated).toContain("# custom comment");
    expect(updated).toContain("KAZUSA_CUSTOM=keep-me");
    expect(updated).toContain(
      "KAZUSA_GATEWAY_URL=https://remote.example:18789",
    );
    expect(updated).toContain('OPENCLAW_GATEWAY_TOKEN="new token with spaces"');
  });

  it("drops duplicate definitions and escapes $ for Next env expansion", () => {
    const initial = [
      "OPENCLAW_GATEWAY_TOKEN=first-stale",
      "KAZUSA_KEEP=1",
      "OPENCLAW_GATEWAY_TOKEN=second-stale",
      "",
    ].join("\n");
    const updated = upsertEnvContent(initial, {
      OPENCLAW_GATEWAY_TOKEN: "abc$MISSING",
    });
    expect(updated.match(/OPENCLAW_GATEWAY_TOKEN=/g)).toHaveLength(1);
    expect(updated).toContain('OPENCLAW_GATEWAY_TOKEN="abc\\$MISSING"');
    expect(updated).toContain("KAZUSA_KEEP=1");
  });

  it("writes .env.local, updates process.env immediately, and restores local world token on reset", () => {
    const envFile = path.join(dir, ".env.local");
    const localWorldEnvFile = path.join(dir, "world.env");
    writeFileSync(localWorldEnvFile, "OPENCLAW_GATEWAY_TOKEN=local-secret\n");
    vi.stubEnv("KAZUSA_GATEWAY_URL", DEFAULT_GATEWAY_URL);
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "local-secret");

    const saved = saveGatewayConnection(
      { url: "https://remote.example:18789/", token: "remote-secret" },
      { envFile, localWorldEnvFile },
    );
    expect(saved).toEqual({
      url: "https://remote.example:18789",
      hasToken: true,
      defaultUrl: DEFAULT_GATEWAY_URL,
      isDefault: false,
    });
    expect(process.env.KAZUSA_GATEWAY_URL).toBe("https://remote.example:18789");
    expect(process.env.OPENCLAW_GATEWAY_TOKEN).toBe("remote-secret");
    expect(readFileSync(envFile, "utf8")).toContain(
      "KAZUSA_GATEWAY_URL=https://remote.example:18789",
    );

    // Changing URL without re-entering token keeps the saved token.
    const urlOnly = saveGatewayConnection(
      { url: "https://remote-2.example:18789" },
      { envFile, localWorldEnvFile },
    );
    expect(urlOnly.hasToken).toBe(true);
    expect(process.env.OPENCLAW_GATEWAY_TOKEN).toBe("remote-secret");

    // Resetting restores default URL and local world token.
    const reset = saveGatewayConnection(
      { reset: true },
      { envFile, localWorldEnvFile },
    );
    expect(reset).toEqual({
      url: DEFAULT_GATEWAY_URL,
      hasToken: true,
      defaultUrl: DEFAULT_GATEWAY_URL,
      isDefault: true,
    });
    expect(process.env.KAZUSA_GATEWAY_URL).toBe(DEFAULT_GATEWAY_URL);
    expect(process.env.OPENCLAW_GATEWAY_TOKEN).toBe("local-secret");
  });

  it("never leaks the token on GET and denies non-local callers", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    vi.stubEnv("KAZUSA_GATEWAY_URL", "https://remote.example:18789");
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "super-secret-token");

    const ok = GET(new Request("http://localhost:3000/connection"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body).toEqual({
      url: "https://remote.example:18789",
      hasToken: true,
      defaultUrl: DEFAULT_GATEWAY_URL,
      isDefault: false,
    });
    expect(JSON.stringify(body)).not.toContain("super-secret-token");

    vi.stubEnv("KAZUSA_AUTH_MODE", "public");
    const deniedGet = GET(new Request("https://demo.example/connection"));
    expect(deniedGet.status).toBe(403);
    const deniedPost = await POST(
      new Request("https://demo.example/connection", {
        method: "POST",
        headers: { Origin: "https://demo.example" },
        body: JSON.stringify({ url: "https://evil.example" }),
      }),
    );
    expect(deniedPost.status).toBe(403);
  });
});
