import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerBrainChannel } from "./brain-channel.ts";
import type { PerceptionDelivery } from "./perception.ts";

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

function setup(dispatch: ReturnType<typeof vi.fn>) {
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
    deliver: registerBrainChannel(api, new AbortController().signal),
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
});
