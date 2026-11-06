import { afterEach, describe, expect, it, vi } from "vitest";
import { abortCharacterBrain } from "./http";
import { POST } from "../../../app/kazusa/[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("brain stop client and proxy", () => {
  it("sends the character target to the same-origin proxy without a credential", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ aborted: true, drained: false }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", { location: { origin: "https://world.test" } });
    expect(await abortCharacterBrain("alice")).toEqual({
      aborted: true,
      drained: false,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://world.test/kazusa/brain/abort");
    expect(init.method).toBe("POST");
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(init.body as string)).toEqual({ agentId: "alice" });
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
  it("forwards the button request through the server's Gateway credential", async () => {
    vi.stubEnv("KAZUSA_GATEWAY_URL", "http://gateway.test");
    vi.stubEnv("OPENCLAW_GATEWAY_TOKEN", "server-token");
    const fetcher = vi.fn(async () =>
      Response.json({ aborted: true, drained: true }),
    );
    vi.stubGlobal("fetch", fetcher);
    const req = new Request("http://localhost:3000/kazusa/brain/abort", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ agentId: "alice" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ["brain", "abort"] }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://gateway.test/kazusa/brain/abort");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer server-token",
    );
    expect(await res.json()).toEqual({ aborted: true, drained: true });
  });
  it("rejects a cross-origin stop request before reaching the Gateway", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(
      new Request("http://localhost:3000/kazusa/brain/abort", {
        method: "POST",
        headers: { origin: "https://other.test" },
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["brain", "abort"] }) },
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
