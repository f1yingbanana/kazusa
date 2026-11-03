import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerBrainChannel } from "./brain-channel.ts";
import type { PerceptionDelivery } from "./perception.ts";
import type { ThinkingLevel } from "@kazusa/client";

const delivery: PerceptionDelivery = {
  id: "d1",
  agentId: "alice",
  mode: "followup",
  message: "[Wed 2026-10-28 10:14] Incoming chats: …",
  ids: ["a"],
  keys: ["a"],
};

/** The host's lifecycle callbacks; unused by the channel's own logic. */
const lifecycle = { onAdopted: async () => {} } as unknown as Parameters<
  ReturnType<typeof registerBrainChannel>
>[1];

function setup(
  dispatch: ReturnType<typeof vi.fn>,
  selection: Parameters<typeof registerBrainChannel>[2] = {},
) {
  const patchSessionEntry = vi.fn(
    async (params: { update: (entry: Record<string, unknown>) => unknown }) => {
      patches.push(
        params.update({
          sessionId: "s1",
          abortedLastRun: true,
          mainRestartRecovery: { tombstone: { at: 1 } },
        }),
      );
      return null;
    },
  );
  const patches: unknown[] = [];
  // This partial host test double cannot satisfy the entire SDK structurally.
  const api = {
    registerChannel: vi.fn(),
    logger: { warn: vi.fn() },
    config: {},
    runtime: {
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: dispatch },
      },
      agent: { session: { patchSessionEntry } },
    },
  } as unknown as OpenClawPluginApi;
  Object.assign(api, {
    runtime: { ...api.runtime, config: { current: () => api.config } },
  });
  return {
    deliver: registerBrainChannel(api, new AbortController().signal, selection),
    patchSessionEntry,
    patches,
  };
}

describe("brain channel", () => {
  it("clears a restart tombstone and hands the input over again", async () => {
    // Live: a Gateway stopped mid-turn tombstoned brain sessions, and every
    // later handoff was refused until the session was reset by hand.
    const tombstone = Object.assign(
      new Error(
        'Session "agent:alice:brain" ended during restart recovery. Use /new or /reset to start a replacement session.',
      ),
      { name: "SessionRestartRecoveryTombstoneError" },
    );
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(tombstone)
      .mockResolvedValueOnce(undefined);
    const h = setup(dispatch);
    await h.deliver(delivery, lifecycle);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(h.patchSessionEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "alice",
        sessionKey: "agent:alice:brain",
      }),
    );
    expect(h.patches).toEqual([
      {
        abortedLastRun: false,
        restartRecoveryRuns: undefined,
        mainRestartRecovery: undefined,
      },
    ]);
  });

  it("leaves other failures to Perception", async () => {
    const dispatch = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const h = setup(dispatch);
    await expect(h.deliver(delivery, lifecycle)).rejects.toThrow("offline");
    expect(h.patchSessionEntry).not.toHaveBeenCalled();
  });

  it("applies and clears thinking on the delivering agent's own brain", async () => {
    const thinking = vi.fn(
      async (agentId: string): Promise<ThinkingLevel | undefined> =>
        agentId === "alice" ? "high" : undefined,
    );
    const h = setup(vi.fn().mockResolvedValue(undefined), { thinking });
    await h.deliver(delivery, lifecycle);
    await h.deliver({ ...delivery, agentId: "bob" }, lifecycle);
    expect(thinking.mock.calls).toEqual([["alice"], ["bob"]]);
    expect(h.patchSessionEntry.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({
        agentId: "alice",
        sessionKey: "agent:alice:brain",
        preserveActivity: true,
      }),
      expect.objectContaining({
        agentId: "bob",
        sessionKey: "agent:bob:brain",
        preserveActivity: true,
      }),
    ]);
    expect(h.patches).toEqual([{ thinkingLevel: "high" }, null]);
    // A previously explicit level is removed when the effective choice clears.
    const update = h.patchSessionEntry.mock.calls[1]?.[0].update;
    expect(update?.({ thinkingLevel: "high" })).toEqual({
      thinkingLevel: undefined,
    });
  });

  it("puts the chosen model on the session before a new turn, not a steer", async () => {
    // Live: with the model swapped only per turn, OpenClaw refused 98% of
    // steers, since the session still named the configured primary.
    const model = vi.fn(async () => "venice/mimo-flash");
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const h = setup(dispatch, { model });
    await h.deliver({ ...delivery, mode: "steer" }, lifecycle);
    expect(model).not.toHaveBeenCalled();
    await h.deliver(delivery, lifecycle);
    const update = h.patchSessionEntry.mock.calls[0]?.[0].update;
    expect(
      update?.({ sessionId: "s1", model: "glm-5.3-flash", contextTokens: 9 }),
    ).toEqual({
      providerOverride: "venice",
      modelOverride: "mimo-flash",
      modelOverrideSource: "user",
      modelOverrideRouteResolution: "resolved",
      model: undefined,
      contextTokens: undefined,
      updatedAt: expect.any(Number),
    });
    expect(
      update?.({
        sessionId: "s1",
        providerOverride: "venice",
        modelOverride: "mimo-flash",
        modelOverrideSource: "user",
        modelOverrideRouteResolution: "resolved",
      }),
    ).toBeNull();
  });

  it("clears a model it set once the choice goes back to the default", async () => {
    const h = setup(vi.fn().mockResolvedValue(undefined), {
      model: async () => undefined,
    });
    await h.deliver(delivery, lifecycle);
    const update = h.patchSessionEntry.mock.calls[0]?.[0].update;
    expect(update?.({ sessionId: "s1" })).toBeNull();
    expect(
      update?.({ providerOverride: "venice", modelOverride: "mimo-flash" }),
    ).toEqual({
      providerOverride: undefined,
      modelOverride: undefined,
      modelOverrideSource: undefined,
      modelOverrideRouteResolution: undefined,
    });
  });

  it("sends a steer as system input, so it expects no reply either", async () => {
    // Live: a user_request steer expects a reply; a room_event turn doesn't,
    // and OpenClaw refused every steer into one (reply_expectation_mismatch).
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const h = setup(dispatch);
    await h.deliver({ ...delivery, mode: "steer" }, lifecycle);
    await h.deliver(delivery, lifecycle);
    const [steer, followup] = dispatch.mock.calls.map(
      ([params]) => (params as { ctx: Record<string, unknown> }).ctx,
    );
    expect(steer).toMatchObject({
      InboundEventKind: "user_request",
      InputProvenance: { kind: "internal_system", sourceChannel: "kazusa" },
    });
    expect(followup.InboundEventKind).toBe("room_event");
    expect(followup).not.toHaveProperty("InputProvenance");
  });

  it("aborts a steer Perception takes back", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const h = setup(dispatch);
    const custody = new AbortController();
    await h.deliver(
      { ...delivery, mode: "steer" },
      { ...lifecycle, abortSignal: custody.signal },
    );
    const { replyOptions } = dispatch.mock.calls[0]?.[0] as {
      replyOptions: {
        abortSignal: AbortSignal;
        turnAdoptionLifecycle: { abortSignal: AbortSignal };
      };
    };
    custody.abort();
    expect(replyOptions.abortSignal.aborted).toBe(true);
    expect(replyOptions.turnAdoptionLifecycle.abortSignal.aborted).toBe(true);
  });
});
