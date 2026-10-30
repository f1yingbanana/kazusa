import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginBrainRun,
  brainRunLimits,
  registerBrainRunLimits,
} from "./run-limits.ts";

const native = vi.hoisted(() => ({
  abort: vi.fn(() => true),
  resolve: vi.fn(() => "session-1"),
}));
vi.mock("openclaw/plugin-sdk/agent-harness-runtime", () => ({
  abortAgentHarnessRun: native.abort,
  resolveActiveEmbeddedRunSessionId: native.resolve,
}));
type Hook = (
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => unknown;
const ended: (() => void)[] = [];
function setup(
  limits: Record<string, unknown> = {
    maxModelCalls: 5,
    maxToolCalls: 2,
    maxRunSeconds: 5,
  },
  runId = "run-1",
) {
  const hooks = new Map<string, Hook>();
  const api = {
    pluginConfig: { perception: limits },
    logger: { warn: vi.fn() },
    on: (name: string, hook: Hook) => hooks.set(name, hook),
    runtime: {
      config: {
        current: () => ({
          agents: { defaults: { systemAgent: { agentId: "arona" } } },
        }),
      },
    },
  } as unknown as OpenClawPluginApi;
  const finish = registerBrainRunLimits(api);
  const ctx = {
    runId,
    sessionKey: "agent:alice:brain",
    sessionId: "session-1",
  };
  const call = (name: string, event: Record<string, unknown>) =>
    hooks.get(name)?.(event, ctx);
  ended.push(() => finish(runId));
  return {
    api,
    finish: () => finish(runId),
    ctx,
    call,
    start: (callId: string) => call("model_call_started", { runId, callId }),
    tool: (toolCallId: string, toolName = "read") =>
      call("before_tool_call", {
        toolName,
        params: {},
        toolCallId,
      }),
  };
}
afterEach(() => {
  ended.splice(0).forEach((end) => end());
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("brain run hard budgets", () => {
  it("blocks an excess tool before its side effects, without counting duplicate hook deliveries", () => {
    const h = setup();
    const budget = beginBrainRun(
      h.api,
      "alice",
      h.ctx.runId,
      new AbortController().signal,
    );
    h.start("model-1");
    expect(h.tool("a")).toBeUndefined();
    expect(h.tool("a")).toBeUndefined();
    expect(h.tool("b")).toBeUndefined();
    expect(h.tool("c")).toMatchObject({ block: true });
    budget.dispose();
  });
  it("still lets a run that is out of tool calls report before it ends", () => {
    const h = setup();
    h.start("m1");
    h.tool("a");
    h.tool("b");
    expect(h.tool("c")).toMatchObject({
      blockReason: expect.stringContaining("send_message"),
    });
    expect(h.tool("d", "send_message")).toBeUndefined();
    expect(native.abort).not.toHaveBeenCalled();
  });
  it("keeps the last model calls for reporting", () => {
    const h = setup();
    h.start("m1");
    h.start("m2");
    expect(h.tool("a")).toBeUndefined();
    h.start("m3");
    expect(h.tool("b")).toMatchObject({ block: true });
    expect(h.tool("c", "send_message")).toBeUndefined();
  });
  it("tells a run to wrap up before its time expires", () => {
    vi.useFakeTimers();
    const h = setup();
    h.start("m1");
    vi.advanceTimersByTime(3999);
    expect(h.tool("a")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(h.tool("b")).toMatchObject({ block: true });
    expect(h.tool("c", "send_message")).toBeUndefined();
    expect(native.abort).not.toHaveBeenCalled();
  });
  it("gives the configured system agent its own limits", () => {
    const h = setup({
      maxModelCalls: 3,
      systemAgent: { maxModelCalls: 50 },
    });
    h.ctx.sessionKey = "agent:arona:brain";
    for (const id of ["m1", "m2", "m3", "m4"]) h.start(id);
    expect(native.abort).not.toHaveBeenCalled();
    expect(h.tool("a")).toBeUndefined();
    expect(brainRunLimits(h.api, "arona").maxModelCalls).toBe(50);
    expect(brainRunLimits(h.api, "alice").maxModelCalls).toBe(3);
  });
  it("counts reused tool IDs in successive model calls", () => {
    const h = setup();
    h.start("model-1");
    h.tool("a");
    h.start("model-2");
    h.tool("a");
    expect(h.tool("b")).toMatchObject({ block: true });
  });
  it("caps model calls even for a native queued run whose dispatch has already returned", () => {
    const h = setup();
    h.start("m1");
    h.start("m1");
    h.start("m2");
    h.start("m3");
    h.start("m4");
    expect(native.abort).not.toHaveBeenCalled();
    h.start("m5");
    expect(native.abort).toHaveBeenCalledTimes(1);
    expect(h.tool("a", "send_message")).toMatchObject({ block: true });
  });
  it("expires after the elapsed budget and clears terminal timers", () => {
    vi.useFakeTimers();
    const h = setup();
    h.start("m1");
    vi.advanceTimersByTime(5000);
    expect(native.abort).toHaveBeenCalledTimes(1);
    h.finish();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never cancels a newer run in the same session with an older timer", () => {
    vi.useFakeTimers();
    const older = setup();
    older.start("m1");
    vi.advanceTimersByTime(1000);
    const newer = setup(undefined, "run-2");
    newer.start("m1");
    vi.advanceTimersByTime(4000);
    expect(native.abort).not.toHaveBeenCalled();
    expect(newer.tool("a", "send_message")).toBeUndefined();
  });
  it("leaves non-brain agent work alone", () => {
    const h = setup();
    h.ctx.sessionKey = "agent:alice:main";
    h.start("m1");
    h.start("m2");
    h.start("m3");
    h.tool("a");
    h.tool("b");
    expect(h.tool("c")).toBeUndefined();
    expect(native.abort).not.toHaveBeenCalled();
  });
});
