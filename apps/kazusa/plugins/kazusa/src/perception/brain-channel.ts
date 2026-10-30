import { currentConfig } from "../current-config.ts";
import { noteShutdown } from "../shutdown.ts";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readVisibleSessionTranscriptMessageEntries } from "openclaw/plugin-sdk/session-transcript-runtime";
import type { ThinkingLevel } from "@kazusa/client";
import type { PerceptionDelivery, PerceptionDeps } from "./perception.ts";

const CHANNEL_ID = "kazusa";

/**
 * Internal ingress only: this channel is not a chat ledger or an outbound
 * transport.
 */
const BRAIN_CHANNEL: ChannelPlugin<{ accountId: string }> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "Kazusa brain",
    selectionLabel: "Kazusa brain (internal)",
    docsPath: "/plugins/kazusa",
    blurb: "In-process admission of perceived stimuli to character brains.",
    exposure: { setup: false, docs: false },
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ accountId: "default" }),
  },
  // Perception already coalesces inputs; do not add another debounce on handoff.
  defaults: { queue: { debounceMs: 0 } },
};

const brainKey = (agentId: string): string => `agent:${agentId}:brain`;

/** OpenClaw refusing work on a session a restart cut off mid-run. */
function isRestartTombstone(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "SessionRestartRecoveryTombstoneError" ||
      error.message.includes("ended during restart recovery"))
  );
}

/**
 * Clears OpenClaw's restart-recovery state on a brain session, as OpenClaw
 * itself does after a run completes. A restart that cuts off a brain run leaves
 * it tombstoned: OpenClaw cannot resume a `message_tool_only` run from this
 * channel, and refuses all later work on the session. Perception owns what
 * becomes of that input instead (see `adoptedByBrain`).
 */
async function clearRestartTombstone(
  api: OpenClawPluginApi,
  agentId: string,
): Promise<void> {
  await api.runtime.agent.session.patchSessionEntry({
    agentId,
    sessionKey: brainKey(agentId),
    preserveActivity: true,
    update: (entry) => {
      // `mainRestartRecovery` holds the tombstone; it is host-internal and
      // missing from the public SessionEntry type.
      const recovery = entry as { mainRestartRecovery?: unknown };
      if (
        recovery.mainRestartRecovery === undefined &&
        !entry.abortedLastRun &&
        entry.restartRecoveryRuns === undefined
      )
        return null;
      return Object.assign(
        { abortedLastRun: false, restartRecoveryRuns: undefined },
        { mainRestartRecovery: undefined },
      );
    },
  });
}

/**
 * Whether a hand-off reached the brain before a restart: its message is in the
 * brain transcript. Perception asks on startup instead of quarantining.
 */
export function adoptedByBrain(
  api: OpenClawPluginApi,
): NonNullable<PerceptionDeps["adopted"]> {
  return async (delivery: PerceptionDelivery): Promise<boolean> => {
    const sessionKey = brainKey(delivery.agentId);
    const sessionId = api.runtime.agent.session
      .getSessionEntry({ agentId: delivery.agentId, sessionKey })
      ?.sessionId?.trim();
    if (!sessionId) return false;
    const rows = await readVisibleSessionTranscriptMessageEntries({
      agentId: delivery.agentId,
      sessionKey,
      sessionId,
    });
    return rows.some(
      ({ message }) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(
          JSON.stringify(delivery.message).slice(1, -1),
        ),
    );
  };
}

/**
 * Sets the brain session's reasoning level to the agent's selection. OpenClaw
 * has no per-turn hook for it, and `agents.defaults.thinkingDefault` would sit
 * below any session level, so the session carries it. `undefined` clears it:
 * the model runs at OpenClaw's configured or provider default.
 */
async function applyThinking(
  api: OpenClawPluginApi,
  agentId: string,
  level: ThinkingLevel | undefined,
): Promise<void> {
  await api.runtime.agent.session.patchSessionEntry({
    agentId,
    sessionKey: brainKey(agentId),
    preserveActivity: true,
    update: (entry) =>
      entry.thinkingLevel === level ? null : { thinkingLevel: level },
  });
}

export function registerBrainChannel(
  api: OpenClawPluginApi,
  signal: AbortSignal,
  /** The effective reasoning level for this character (Models). */
  thinking?: (agentId: string) => Promise<ThinkingLevel | undefined>,
): NonNullable<PerceptionDeps["deliver"]> {
  const getConfig = () => currentConfig(api);
  api.registerChannel({ plugin: BRAIN_CHANNEL });

  const dispatch = async (
    ...[delivery, lifecycle]: Parameters<NonNullable<PerceptionDeps["deliver"]>>
  ): Promise<void> => {
    signal.throwIfAborted();
    const sessionKey = brainKey(delivery.agentId);
    if (thinking)
      await applyThinking(
        api,
        delivery.agentId,
        await thinking(delivery.agentId),
      );
    await api.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      cfg: getConfig(),
      ctx: {
        Provider: CHANNEL_ID,
        Surface: CHANNEL_ID,
        AccountId: "default",
        AgentId: delivery.agentId,
        SessionKey: sessionKey,
        From: "kazusa:perception",
        To: sessionKey,
        SenderId: "perception",
        SenderIsBot: true,
        ChatType: "direct",
        // The delivery ID is custody metadata, not an in-world message ID.
        // MessageSid is rendered into both the host room-event envelope and
        // its model context. Retain identity in runId/ownerKey and provider
        // metadata instead; Perception owns stimulus deduplication.
        ProviderUpdateId: delivery.id,
        Body: delivery.message,
        BodyForAgent: delivery.message,
        AmbientTranscriptBody: delivery.message,
        CommandAuthorized: false,
        // A routine notification is an ambient event, not a request to interrupt.
        // Native room_event admission always queues behind a busy turn, even if
        // it became busy after our idle check. Urgent input uses the configured
        // steer queue. Neither path aborts/restarts the current thought.
        InboundEventKind:
          delivery.mode === "steer" ? "user_request" : "room_event",
      },
      replyOptions: {
        runId: delivery.id,
        abortSignal: signal,
        turnAdoptionLifecycle: { ...lifecycle, abortSignal: signal },
        sourceReplyDeliveryMode: "message_tool_only",
        suppressTyping: true,
        disableBlockStreaming: true,
      },
      dispatcherOptions: {
        // The host owns the brain transcript. There is no automatic conversation
        // recipient here; speech must use send_message. Returning null records a
        // skipped payload, rather than pretending it was delivered somewhere.
        transformReplyPayload: (payload) => {
          if (payload.isError)
            api.logger.warn(`Brain dispatch: ${payload.text}`);
          return null;
        },
        deliver: async () => {
          throw new Error(
            "Kazusa brain channel has no automatic outbound delivery",
          );
        },
      },
    });
  };

  return async (delivery, lifecycle): Promise<void> => {
    try {
      await dispatch(delivery, lifecycle);
    } catch (error: unknown) {
      // The Gateway is stopping: let anything frozen on a paused clock go.
      if (error instanceof Error && error.name === "GatewayDrainingError")
        noteShutdown("draining");
      if (!isRestartTombstone(error)) throw error;
      // Nothing ran: clear the tombstone and hand the same input over again.
      api.logger.warn(
        `Brain session of ${delivery.agentId} was tombstoned by a restart; clearing it.`,
      );
      await clearRestartTombstone(api, delivery.agentId);
      await dispatch(delivery, lifecycle);
    }
  };
}
