import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPerception } from "./register.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");

function setup(onDeadline?: (agentId: string) => Promise<string | undefined>) {
  const stores = new Map<string, Map<string, unknown>>();
  const on = vi.fn();
  const subscription = vi.fn();
  const dispose = vi.fn();
  const registerChannel = vi.fn();
  const dispatchBrain = vi.fn<
    OpenClawPluginApi["runtime"]["channel"]["reply"]["dispatchReplyWithBufferedBlockDispatcher"]
  >(async ({ replyOptions }) => {
    await replyOptions?.turnAdoptionLifecycle?.onAdopted();
    return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
  });
  const runEmbeddedAgent = vi.fn(async () => ({ runId: "embedded-1" }));

  const api = {
    pluginConfig: {
      perception: {
        coalesceWindowMs: 0,
      },
    },
    config: {},
    on,
    registerChannel,
    logger: { info: vi.fn(), warn: vi.fn() },
    lifecycle: { onDispose: dispose },
    agent: { events: { registerAgentEventSubscription: subscription } },
    runtime: {
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: dispatchBrain },
      },
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) => {
          const store = stores.get(namespace) ?? new Map<string, unknown>();
          stores.set(namespace, store);
          return {
            lookup: async (key: string) => structuredClone(store.get(key)),
            register: async (key: string, value: unknown) => {
              store.set(key, structuredClone(value));
            },
            registerIfAbsent: async (key: string, value: unknown) => {
              if (!store.has(key)) store.set(key, structuredClone(value));
            },
            entries: async () =>
              [...store].map(([key, value]) => ({
                key,
                value: structuredClone(value),
              })),
          };
        },
      },
      agent: {
        session: {
          patchSessionEntry: vi.fn(async () => ({ sessionId: "ledger-1" })),
        },
        resolveAgentWorkspaceDir: vi.fn(() => "/mock/workspace/alice"),
        resolveAgentTimeoutMs: vi.fn(() => 60000),
        runEmbeddedAgent,
      },
    },
  } as unknown as OpenClawPluginApi;

  const clock = {
    time: () => NOW,
    init: async () => {},
    now: () => ({ simTime: NOW, speed: 1, formatted: "" }),
    onClockChange: () => () => {},
  };
  const perception = registerPerception(api, { clock, onDeadline });

  const hook = (name: string) =>
    on.mock.calls.find(([registered]) => registered === name)?.[1];

  const dispatch = async (
    content = "Hello Alice",
    context: {
      sessionKey?: string;
      senderId?: string;
      messageId?: string;
    } = {},
  ) => {
    const beforeDispatch = hook("before_dispatch");
    return beforeDispatch(
      {
        content,
        messageId: context.messageId ?? "message-1",
      },
      {
        sessionKey: context.sessionKey ?? "agent:alice:chat:direct:bob",
        senderId: context.senderId ?? "bob",
      },
    );
  };

  return {
    api,
    stores,
    dispatch,
    perception,
    hook,
    subscription,
    dispose,
    runEmbeddedAgent,
    registerChannel,
    dispatchBrain,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Perception host integration", () => {
  it("claims invalid and empty ledger ingress and independently blocks non-brain inference", async () => {
    const h = setup();
    expect(await h.dispatch("x".repeat(32_001))).toEqual({ handled: true });
    expect(await h.dispatch("")).toEqual({ handled: true });
    expect(h.dispatchBrain).not.toHaveBeenCalled();
    const gate = h.hook("before_agent_run");
    for (const sessionKey of [
      "agent:alice:main",
      "agent:alice:chat:direct:bob",
      "agent:alice:tasks",
      "agent:bob:brain",
    ]) {
      expect(await gate({}, { agentId: "alice", sessionKey })).toMatchObject({
        outcome: "block",
      });
    }
    expect(
      await gate({}, { agentId: "alice", sessionKey: "agent:alice:brain" }),
    ).toBeUndefined();
  });

  it("captures the current brain input without treating it as an activity", async () => {
    const h = setup();
    await h.hook("before_agent_reply")(
      { cleanedBody: "Answer Bob about exams" },
      { agentId: "alice", sessionKey: "agent:alice:brain" },
    );
    expect(h.stores.get("perception")?.get("alice")).toMatchObject({
      brainContext: "Answer Bob about exams",
    });
  });

  it("claims incoming chat before dispatch and delivers stimulus to brain", async () => {
    const h = setup();
    const result = await h.dispatch();
    expect(result).toEqual({ handled: true });
    expect(h.dispatchBrain).toHaveBeenCalledTimes(1);
    expect(h.runEmbeddedAgent).not.toHaveBeenCalled();
    expect(
      h.api.runtime.agent.session.patchSessionEntry,
    ).not.toHaveBeenCalled();

    // Second call with same message id is deduplicated by stimulus id
    await h.dispatch();
    expect(h.dispatchBrain).toHaveBeenCalledTimes(1);
  });

  it("ignores self-authored outgoing messages in before_dispatch", async () => {
    const h = setup();
    const result = await h.dispatch("Hello Bob", { senderId: "alice" });
    expect(result).toEqual({ handled: true });
    expect(h.dispatchBrain).not.toHaveBeenCalled();
  });

  it("claims incoming chat messages via before_dispatch hook", async () => {
    const h = setup();
    const result = await h.dispatch("Hey from Discord", {
      messageId: "msg-discord-1",
    });

    expect(result).toEqual({ handled: true });
    expect(h.dispatchBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          Body: expect.stringContaining("Hey from Discord"),
          AgentId: "alice",
          SessionKey: "agent:alice:brain",
          Provider: "kazusa",
          CommandAuthorized: false,
          InboundEventKind: "room_event",
        }),
      }),
    );
  });

  it("ignores non-chat session keys in before_dispatch", async () => {
    const h = setup();
    const result = await h.dispatch("Task updated", {
      sessionKey: "agent:alice:tasks",
    });
    expect(result).toBeUndefined();
  });

  it("tracks brain active lifecycle in real-time", async () => {
    const h = setup();
    const eventHandler = h.subscription.mock.calls[0][0];

    // Start brain run
    await eventHandler.handle({
      sessionKey: "agent:alice:brain",
      runId: "brain-run-1",
      data: { phase: "start" },
    });

    const state1 = (await h.stores.get("perception")?.get("alice")) as {
      brainRun?: string;
    };
    expect(state1?.brainRun).toBe("brain-run-1");

    // End brain run
    await eventHandler.handle({
      sessionKey: "agent:alice:brain",
      runId: "brain-run-1",
      data: { phase: "end" },
    });

    const state2 = (await h.stores.get("perception")?.get("alice")) as {
      brainRun?: string;
    };
    expect(state2?.brainRun).toBeUndefined();
  });

  it("rejects writes from a disposed plugin generation", async () => {
    const h = setup();
    h.dispose.mock.calls[0][0]();
    await expect(h.dispatch()).resolves.toEqual({ handled: true });
    expect(h.dispatchBrain).not.toHaveBeenCalled();
  });

  it("wires assembleDecisionContext dependency to perception instance", () => {
    const api = {
      pluginConfig: { perception: { coalesceWindowMs: 0 } },
      config: {},
      on: vi.fn(),
      registerChannel: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn() },
      lifecycle: { onDispose: vi.fn() },
      agent: { events: { registerAgentEventSubscription: vi.fn() } },
      runtime: {
        channel: {
          reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        },
        state: {
          openKeyedStore: () => ({
            lookup: vi.fn(),
            register: vi.fn(),
            entries: vi.fn(),
          }),
        },
      },
    } as unknown as OpenClawPluginApi;
    const assembleDecisionContext = vi.fn();
    const perception = registerPerception(api, {
      clock: {
        time: () => NOW,
        init: async () => {},
        now: () => ({ simTime: NOW, speed: 1, formatted: "" }),
        onClockChange: () => () => {},
      },
      assembleDecisionContext,
    });
    expect(perception).toBeDefined();
  });

  it("notifies perception of task deadline and claims turn when cron fires before_agent_reply", async () => {
    const h = setup();
    const beforeAgentReply = h.hook("before_agent_reply");
    const deadlineSpy = vi.spyOn(h.perception, "deadline");

    const result = await beforeAgentReply(
      { cleanedBody: "Scheduled task deadline reached" },
      { trigger: "cron", jobId: "cron-job-1", agentId: "alice" },
    );

    expect(deadlineSpy).toHaveBeenCalledWith("alice", undefined);
    expect(result).toEqual({ handled: true });
  });

  it("settles what a deadline means elsewhere before admitting it", async () => {
    const calls: string[] = [];
    const h = setup(async (agentId) => {
      calls.push(`settle ${agentId}`);
      return "You've arrived at the club.";
    });
    vi.spyOn(h.perception, "deadline").mockImplementation(
      async (agentId, note) => {
        calls.push(`deadline ${agentId}: ${note}`);
      },
    );
    await h.hook("before_agent_reply")(
      { cleanedBody: "Scheduled task deadline reached" },
      { trigger: "cron", jobId: "cron-job-1", agentId: "alice" },
    );
    expect(calls).toEqual([
      "settle alice",
      "deadline alice: You've arrived at the club.",
    ]);
  });

  it("registers an internal ingress channel with no outbound adapter", () => {
    const h = setup();
    const { plugin } = h.registerChannel.mock.calls[0][0];
    expect(plugin.id).toBe("kazusa");
    expect(plugin.outbound).toBeUndefined();
    expect(plugin.config.listAccountIds({})).toEqual(["default"]);
  });

  it("keeps automatic replies private and explicitly skips outbound payloads", async () => {
    const h = setup();
    await h.dispatch();
    const { ctx, replyOptions, dispatcherOptions } =
      h.dispatchBrain.mock.calls[0][0];
    expect(replyOptions?.sourceReplyDeliveryMode).toBe("message_tool_only");
    expect(replyOptions?.runId).toBe(ctx.ProviderUpdateId);
    expect(replyOptions?.runId).toBeTruthy();
    expect(ctx.MessageSid).toBeUndefined();
    expect(ctx.AmbientTranscriptBody).toBe(ctx.BodyForAgent);
    expect(ctx.AmbientTranscriptBody).not.toContain(ctx.ProviderUpdateId);
    expect(
      dispatcherOptions.transformReplyPayload?.({ text: "Must stay private" }),
    ).toBeNull();
    await expect(
      dispatcherOptions.deliver({ text: "No recipient" }, { kind: "final" }),
    ).rejects.toThrow("no automatic outbound");
  });

  it("uses the same dispatcher for urgent steering and lets the host own fallback", async () => {
    const h = setup();
    h.api.runtime.decisions = {
      evaluate: vi.fn(async () => ({
        status: "ok" as const,
        provenance: {
          providerId: "test",
          rubricVersion: "2",
          runtimeGeneration: "1",
        },
        result: {
          answers: {
            attention_allocation: { type: "choice" as const, choice: "STEER" },
          },
        },
      })),
    } as unknown as OpenClawPluginApi["runtime"]["decisions"];
    await h.subscription.mock.calls[0][0].handle({
      sessionKey: "agent:alice:brain",
      runId: "busy",
      data: { phase: "start" },
    });
    h.dispatchBrain.mockImplementationOnce(async ({ replyOptions }) => {
      // This is also used when the active run ends before native injection.
      replyOptions?.turnAdoptionLifecycle?.onDeferred?.();
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 0 },
        deferredToActiveRun: "followup",
      };
    });
    await h.dispatch("Fire in the kitchen!");
    const { ctx, replyOptions } = h.dispatchBrain.mock.calls[0][0];
    expect(ctx.InboundEventKind).toBe("user_request");
    expect(ctx.SessionKey).toBe("agent:alice:brain");
    expect(h.stores.get("perception")?.get("alice")).toMatchObject({
      pending: [
        expect.objectContaining({
          id: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });
    await replyOptions?.turnAdoptionLifecycle?.onAdopted();
    expect(h.stores.get("perception")?.get("alice")).toMatchObject({
      pending: [],
    });
    expect(h.runEmbeddedAgent).not.toHaveBeenCalled();
    expect(h.dispatchBrain).toHaveBeenCalledTimes(1);
  });

  it("aborts dispatcher ownership on disposal without acknowledging pending input", async () => {
    const h = setup();
    h.dispatchBrain.mockImplementationOnce(async ({ replyOptions }) => {
      replyOptions?.turnAdoptionLifecycle?.onDeferred?.();
      return {
        queuedFinal: false,
        counts: { tool: 0, block: 0, final: 0 },
        deferredToActiveRun: "followup",
      };
    });
    await h.dispatch();
    const { replyOptions } = h.dispatchBrain.mock.calls[0][0];
    h.dispose.mock.calls[0][0]();
    expect(replyOptions?.abortSignal?.aborted).toBe(true);
    await expect(
      replyOptions?.turnAdoptionLifecycle?.onAdopted(),
    ).rejects.toThrow();
    expect(h.stores.get("perception")?.get("alice")).toMatchObject({
      pending: [
        expect.objectContaining({
          id: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });
  });

  it("allows native lifecycle callbacks while dispatch is pending, and returns before generation ends", async () => {
    const h = setup();
    const generation = Promise.withResolvers<void>();
    h.dispatchBrain.mockImplementationOnce(async ({ replyOptions }) => {
      const handle = h.subscription.mock.calls[0][0].handle;
      await handle({
        sessionKey: "agent:alice:brain",
        runId: "native-1",
        data: { phase: "start" },
      });
      await replyOptions?.turnAdoptionLifecycle?.onAdopted();
      await generation.promise;
      return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
    });
    await h.dispatch();
    expect(h.stores.get("perception")?.get("alice")).toMatchObject({
      brainRun: "native-1",
      pending: [],
    });
    generation.resolve();
  });

  it("resolves human sender on direct chat session when senderId is generic or missing", async () => {
    const h = setup();
    await h.dispatch("Hello Alice from Sensei", {
      sessionKey: "agent:alice:chat:direct:user:sensei",
      senderId: "user",
    });
    expect(h.dispatchBrain).toHaveBeenCalledTimes(1);
    const { ctx } = h.dispatchBrain.mock.calls[0][0];
    expect(ctx.Body).toContain("user:sensei");
  });
});
