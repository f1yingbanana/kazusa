import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBrainTurns } from "./brain-trace.ts";
import { registerBrainTraceHttp } from "./http.ts";

vi.mock("./brain-trace.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./brain-trace.ts")>()),
  readBrainTurns: vi.fn(async () => [
    { id: "turn", prompts: ["private diagnostic"], calls: [] },
  ]),
}));

type Route = Parameters<OpenClawPluginApi["registerHttpRoute"]>[0];

function setup() {
  let registered: Route | undefined;
  const session = vi.fn(async () => ({ sessionId: "brain-session" }));
  const failure = vi.fn(async () => undefined);
  const config = {
    agents: {
      defaults: { systemAgent: { agentId: "admin" } },
      entries: { admin: {}, alice: {} },
    },
  };
  const api = {
    config: { gateway: { auth: { token: "test-service-token" } } },
    runtime: {
      config: { current: () => config },
      agent: { session: { getSessionEntryAsync: session } },
    },
    registerHttpRoute: (route: Route) => {
      registered = route;
    },
  } as unknown as OpenClawPluginApi;
  registerBrainTraceHttp(api, failure);
  if (!registered) throw new Error("Trace route wasn't registered");
  const route = registered;

  const call = async (
    id: string,
    role?: string,
    token = "test-service-token",
  ): Promise<{ readonly status: number; readonly body: string }> => {
    let status = 200;
    let body = "";
    await route.handler(
      {
        method: "GET",
        url: `/kazusa/brain/trace?id=${id}`,
        headers: {
          authorization: `Bearer ${token}`,
          ...(role === undefined ? {} : { "x-kazusa-role": role }),
        },
      } as IncomingMessage,
      {
        headersSent: false,
        setHeader: vi.fn(),
        writeHead: (code: number) => {
          status = code;
        },
        end: (data?: string) => {
          body = data ?? "";
        },
      } as unknown as ServerResponse,
    );
    return { status, body };
  };
  return { call, config, session, failure };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KAZUSA_AUTH_MODE", "local");
});
afterEach(() => vi.unstubAllEnvs());

describe("system agent trace access", () => {
  it.each([
    { mode: "local", role: "visitor" },
    { mode: "public", role: "visitor" },
    { mode: "public", role: "owner" },
    { mode: "public", role: undefined },
  ])(
    "denies $mode/$role before reading private state",
    async ({ mode, role }) => {
      vi.stubEnv("KAZUSA_AUTH_MODE", mode);
      const h = setup();
      expect((await h.call("admin", role)).status).toBe(403);
      expect(h.session).not.toHaveBeenCalled();
      expect(readBrainTurns).not.toHaveBeenCalled();
      expect(h.failure).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "owner"])(
    "preserves local owner access (%s)",
    async (role) => {
      const h = setup();
      const response = await h.call("admin", role);
      expect(response.status).toBe(200);
      expect(response.body).toContain("private diagnostic");
      expect(readBrainTurns).toHaveBeenCalledWith({
        agentId: "admin",
        sessionId: "brain-session",
      });
    },
  );

  it("keeps ordinary character traces observable", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "public");
    expect((await setup().call("alice", "visitor")).status).toBe(200);
    expect(readBrainTurns).toHaveBeenCalledWith({
      agentId: "alice",
      sessionId: "brain-session",
    });
  });

  it("uses the current native system agent selection", async () => {
    const h = setup();
    h.config.agents.defaults.systemAgent.agentId = "alice";
    expect((await h.call("alice", "visitor")).status).toBe(403);
    expect(h.session).not.toHaveBeenCalled();
  });

  it("rejects a forged owner without valid service authentication", async () => {
    const h = setup();
    for (const token of ["wrong", ""])
      expect((await h.call("admin", "owner", token)).status).toBe(401);
    expect(h.session).not.toHaveBeenCalled();
  });

  it("still rejects unknown agents", async () => {
    const h = setup();
    expect((await h.call("unknown", "owner")).status).toBe(404);
    expect(h.session).not.toHaveBeenCalled();
  });
});
