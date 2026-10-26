import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { PerceptionDeps } from "./perception.ts";

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

export function registerBrainChannel(
  api: OpenClawPluginApi,
  signal: AbortSignal,
): NonNullable<PerceptionDeps["deliver"]> {
  api.registerChannel({ plugin: BRAIN_CHANNEL });

  return async (delivery, lifecycle): Promise<void> => {
    signal.throwIfAborted();
    const sessionKey = `agent:${delivery.agentId}:brain`;
    await api.runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      cfg: api.config,
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
        MessageSid: delivery.id,
        Body: delivery.message,
        BodyForAgent: delivery.message,
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
}
