import { Socket } from "node:net";
import { Readable } from "node:stream";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerBrainHttp } from "./http.ts";

const native = vi.hoisted(() => ({
  resolve: vi.fn<() => string | undefined>(() => "brain-session"),
  abort: vi.fn(async () => ({
    aborted: true,
    drained: true,
    forceCleared: false,
  })),
}));
vi.mock("openclaw/plugin-sdk/agent-harness-runtime", () => ({
  resolveActiveEmbeddedRunSessionId: native.resolve,
  abortAndDrainAgentHarnessRun: native.abort,
}));

type Route = Parameters<OpenClawPluginApi["registerHttpRoute"]>[0];
function setup() {
  let registered: Route | undefined;
  const api = {
    runtime: {
      config: {
        current: () => ({ agents: { entries: { alice: {}, bob: {} } } }),
      },
    },
    registerHttpRoute: (route: Route) => {
      registered = route;
    },
  } as unknown as OpenClawPluginApi;
  registerBrainHttp(api);
  if (!registered) throw new Error("Abort route wasn't registered");
  const route = registered;
  const call = async (body: unknown, method = "POST") => {
    const req = Object.assign(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      {
        method,
        url: "/kazusa/brain/abort",
        headers: {},
        socket: new Socket(),
      },
    );
    let status = 0;
    let json = "";
    const res = {
      headersSent: false,
      setHeader: vi.fn(),
      writeHead: (code: number) => {
        status = code;
      },
      end: (data?: string) => {
        json = data ?? "";
      },
    };
    await route.handler(
      req as unknown as Parameters<typeof route.handler>[0],
      res as unknown as Parameters<typeof route.handler>[1],
    );
    return { status, body: JSON.parse(json || "{}") };
  };
  return { route, call };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.resolve.mockReturnValue("brain-session");
  native.abort.mockResolvedValue({
    aborted: true,
    drained: true,
    forceCleared: false,
  });
});
describe("operator brain abort", () => {
  it("requires Gateway authentication and targets the character's brain", async () => {
    const h = setup();
    expect(h.route).toMatchObject({
      path: "/kazusa/brain/abort",
      auth: "gateway",
      match: "exact",
    });
    expect(await h.call({ agentId: "alice" })).toEqual({
      status: 200,
      body: { aborted: true, drained: true },
    });
    expect(native.resolve).toHaveBeenCalledWith("agent:alice:brain");
    expect(native.abort).toHaveBeenCalledWith({
      sessionId: "brain-session",
      sessionKey: "agent:alice:brain",
      settleMs: 2000,
      reason: "operator",
    });
  });
  it("accepts an idle or stale click without changing anything", async () => {
    native.resolve.mockReturnValue(undefined);
    expect(await setup().call({ agentId: "alice" })).toEqual({
      status: 200,
      body: { aborted: false, drained: true },
    });
    expect(native.abort).not.toHaveBeenCalled();
  });
  it("reports a cancellation still settling instead of claiming completion", async () => {
    native.abort.mockResolvedValue({
      aborted: true,
      drained: false,
      forceCleared: false,
    });
    expect((await setup().call({ agentId: "alice" })).body).toEqual({
      aborted: true,
      drained: false,
    });
  });
  it("rejects unknown characters before touching a run", async () => {
    expect((await setup().call({ agentId: "unknown" })).status).toBe(404);
    expect(native.resolve).not.toHaveBeenCalled();
  });
  it("rejects arbitrary session keys and malformed targets", async () => {
    const h = setup();
    for (const body of [
      { agentId: "agent:alice:brain" },
      {},
      { agentId: "alice", sessionKey: "agent:bob:brain" },
    ])
      expect((await h.call(body)).status).toBe(400);
    expect(native.abort).not.toHaveBeenCalled();
  });
  it("requires POST", async () => {
    expect((await setup().call({ agentId: "alice" }, "GET")).status).toBe(405);
    expect(native.abort).not.toHaveBeenCalled();
  });
});
