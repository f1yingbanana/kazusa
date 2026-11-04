import { beginBrainRun, brainRunLimits } from "./run-limits.ts";
import { currentConfig } from "../current-config.ts";
import { noteShutdown } from "../shutdown.ts";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readVisibleSessionTranscriptMessageEntries } from "openclaw/plugin-sdk/session-transcript-runtime";
import { applyModelOverrideToSessionEntry } from "openclaw/plugin-sdk/model-session-runtime";
import type { ThinkingLevel } from "@kazusa/client";
import { splitModelRef } from "../models/selection.ts";
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

/**
 * Puts the character's chat model on the brain session, as `/model` would.
 * `before_model_resolve` swaps the model for each turn, but OpenClaw checks a
 * steer against the session's own model: while the two differed, it refused
 * nearly every steer (`tool_authority_mismatch`, `runtime_rejected`). Only
 * before a new turn, so a steer meets the model of the turn it joins.
 */
async function applyModel(
  api: OpenClawPluginApi,
  agentId: string,
  ref: string | undefined,
): Promise<void> {
  const selection = ref ? splitModelRef(ref) : undefined;
  await api.runtime.agent.session.patchSessionEntry({
    agentId,
    sessionKey: brainKey(agentId),
    preserveActivity: true,
    update: (entry) => {
      // No choice: OpenClaw's configured primary, with nothing on the session.
      if (!selection)
        return entry.modelOverride || entry.providerOverride
          ? {
              providerOverride: undefined,
              modelOverride: undefined,
              modelOverrideSource: undefined,
              modelOverrideRouteResolution: undefined,
            }
          : null;
      const next = { ...entry };
      if (
        !applyModelOverrideToSessionEntry({
          entry: next,
          selection,
          preserveAuthProfileOverride: true,
        }).updated
      )
        return null;
      // A patch merges, so a field the override removed goes as undefined.
      const changed = new Set([...Object.keys(entry), ...Object.keys(next)]);
      return Object.fromEntries(
        [...changed]
          .filter(
            (key) =>
              entry[key as keyof typeof entry] !==
              next[key as keyof typeof next],
          )
          .map((key) => [key, next[key as keyof typeof next]]),
      );
    },
  });
}

export function registerBrainChannel(
  api: OpenClawPluginApi,
  signal: AbortSignal,
  /** This character's effective choices (Models). */
  selection: {
    readonly thinking?: (agentId: string) => Promise<ThinkingLevel | undefined>;
    /** `provider/model`; absent or undefined: the configured primary. */
    readonly model?: (agentId: string) => Promise<string | undefined>;
  } = {},
): NonNullable<PerceptionDeps["deliver"]> {
  const getConfig = () => currentConfig(api);
  api.registerChannel({ plugin: BRAIN_CHANNEL });

  const dispatch = async (
    ...[delivery, lifecycle]: Parameters<NonNullable<PerceptionDeps["deliver"]>>
  ): Promise<void> => {
    signal.throwIfAborted();
    const sessionKey = brainKey(delivery.agentId);
    const { thinking, model } = selection;
    if (thinking)
      await applyThinking(
        api,
        delivery.agentId,
        await thinking(delivery.agentId),
      );
    if (model && delivery.mode === "followup")
      await applyModel(api, delivery.agentId, await model(delivery.agentId));
    const budget = beginBrainRun(api, delivery.agentId, delivery.id, signal);
    // Perception takes back a steer the running turn refused (`ended`).
    const abortSignal = lifecycle.abortSignal
      ? AbortSignal.any([budget.signal, lifecycle.abortSignal])
      : budget.signal;
    try {
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
          // A turn from `room_event` needs no reply (speech is send_message),
          // and OpenClaw refuses a steer that expects otherwise
          // (`reply_expectation_mismatch`): a `user_request` does, unless it is
          // system input. Live, that refused every steer into such a turn.
          ...(delivery.mode === "steer"
            ? {
                InputProvenance: {
                  kind: "internal_system" as const,
                  sourceChannel: CHANNEL_ID,
                },
              }
            : {}),
        },
        replyOptions: {
          runId: delivery.id,
          abortSignal,
          // Run limits own how long a brain thinks; the host's default turn
          // timeout would otherwise end it first.
          timeoutOverrideSeconds: brainRunLimits(api, delivery.agentId)
            .maxRunSeconds,
          turnAdoptionLifecycle: { ...lifecycle, abortSignal },
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
    } finally {
      budget.dispose();
    }
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
