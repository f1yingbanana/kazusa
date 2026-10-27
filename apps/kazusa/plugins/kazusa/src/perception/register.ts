import { createHash, randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import type { DecisionContextAssembler } from "../context-engine/decision-context.ts";
import { Perception } from "./perception.ts";
import { registerBrainChannel } from "./brain-channel.ts";

const LIFECYCLE = z.object({
  phase: z.enum(["start", "end", "error"]),
  aborted: z.boolean().optional(),
  stopReason: z.string().optional(),
});

export function registerPerception(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "time" | "init">;
    readonly assembleDecisionContext?: DecisionContextAssembler;
  },
): Perception {
  const lifetime = new AbortController();
  const perception = new Perception({
    api,
    clock: deps.clock,
    assertCurrent: () => lifetime.signal.throwIfAborted(),
    deliver: registerBrainChannel(api, lifetime.signal),
    assembleDecisionContext: deps.assembleDecisionContext,
  });
  // =========================================================================
  // 1. LIFECYCLE: onDispose (Generational Isolation & Teardown)
  // WHAT OPENCLAW DOES:
  // Fires when the plugin is unloaded, reloaded, or the Gateway daemon terminates.
  // WHAT KAZUSA DOES:
  // Aborts the lifetime AbortController and disposes Perception, canceling in-flight
  // debounce timers, serial task queues, and decision timeouts.
  // DESIGN FIT:
  // Guarantees clean generational boundaries during config updates and hot reloads,
  // preventing phantom background tasks or duplicate handoffs from stale instances.
  // =========================================================================
  api.lifecycle.onDispose?.(() => {
    lifetime.abort();
    perception.dispose();
  });

  // =========================================================================
  // 2. INGRESS HOOK: before_dispatch (Attention Admission & Claiming)
  // WHAT OPENCLAW DOES:
  // Fires when an inbound message arrives from any channel adapter (Discord,
  // Telegram, WhatsApp, Web, etc.) before default session dispatch.
  // WHAT KAZUSA DOES:
  // Intercepts all incoming messages to character chat sessions (`agent:<id>:chat:...`),
  // stamps in-world simulation time from Clock, builds a deterministic SHA-256 deduplication ID,
  // and routes the stimulus into `perception.receive()`. Returns `{ handled: true }` to claim
  // the event and suppress OpenClaw's default unmanaged LLM auto-reply.
  // DESIGN FIT:
  // Acts as the sensory boundary of the character's mind. External chatter never
  // directly invokes inference; instead, stimuli are queued into the Attention Gate
  // for Jev to evaluate against the character's ongoing task and active thoughts.
  // =========================================================================
  api.on("before_dispatch", async (event, ctx) => {
    const sessionKey = ctx.sessionKey ?? event.sessionKey ?? "";
    const owner = parseAgentSessionKey(sessionKey);
    if (!owner?.rest.startsWith("chat:")) return;
    try {
      let sender = ctx.senderId ?? event.senderId;
      if (!sender || sender === "unknown" || sender === "user") {
        if (owner.rest.startsWith("chat:direct:")) {
          const directPeer = owner.rest.slice("chat:direct:".length);
          if (directPeer) sender = directPeer;
        } else if (api.pluginConfig && "user" in api.pluginConfig) {
          const configuredUser = api.pluginConfig.user as { id?: string } | undefined;
          if (configuredUser?.id) sender = configuredUser.id;
        }
      }
      sender = sender ?? "unknown";
      if (sender === owner.agentId) return { handled: true };
      const text = event.content || event.body;
      if (!text) {
        api.logger.warn(
          "Perception: empty/media-only input needs a producer text summary",
        );
        return { handled: true };
      }
      // Native hook timestamps are wall-clock, not simulation time. Future
      // send_message producers call receive() with their captured sim timestamp.
      // A native source ID is scoped to its provider/account/conversation.
      const sourceId = event.messageId ?? ctx.messageId ?? randomUUID();
      const id = createHash("sha256")
        .update(
          JSON.stringify([
            event.channel ?? ctx.channelId,
            ctx.accountId,
            sessionKey,
            sourceId,
          ]),
        )
        .digest("hex");
      await perception.receive(owner.agentId, {
        id,
        sessionKey,
        sender,
        text,
        timestamp: deps.clock.time(),
      });
    } catch (error) {
      api.logger.warn(
        `Perception ingress retained or rejected: ${String(error)}`,
      );
    }
    return { handled: true };
  });

  // =========================================================================
  // 3. SECURITY & ROUTING HOOK: before_agent_run (Single Brain Constraint)
  // WHAT OPENCLAW DOES:
  // Fires immediately before an agent turn executes on any session key.
  // WHAT KAZUSA DOES:
  // Blocks execution (`outcome: "block"`) on any session other than `agent:<id>:brain`.
  // Cron jobs are exempted so scheduled background heartbeats can reach `before_agent_reply`.
  // DESIGN FIT:
  // Enforces the core Kazusa architecture: a character possesses a single unified
  // consciousness (`agent:<id>:brain`). Direct chat ledger sessions are passive storage;
  // characters perceive incoming chat events and speak exclusively via explicit messaging tools.
  // =========================================================================
  api.on("before_agent_run", (_event, ctx) => {
    // Task cron sessions only reach the claiming hook below, never inference.
    if (ctx.trigger === "cron" || ctx.jobId) return;
    const owner = parseAgentSessionKey(ctx.sessionKey ?? "");
    if (
      owner?.rest !== "brain" ||
      (ctx.agentId && owner.agentId !== ctx.agentId)
    ) {
      return {
        outcome: "block",
        reason: "Kazusa character turns require agent:<id>:brain",
      };
    }
  });

  // =========================================================================
  // 4. REAL-TIME EVENT STREAM: agent.events (Cognitive State Tracking)
  // WHAT OPENCLAW DOES:
  // Emits real-time lifecycle event notifications (`phase: "start" | "end" | "error"`).
  // WHAT KAZUSA DOES:
  // - On "start": Transitions Perception to Busy mode, recording `state.brainRun`.
  //   Incoming stimuli will now be classified by Jev as STEER (interrupt) vs QUEUE_NEXT vs IGNORE.
  // - On "end" / "error" / "aborted": Transitions Perception back to Idle mode.
  //   Automatically triggers a single consolidated batch drain of all queued stimuli
  //   accumulated while the brain was thinking, without redundant Jev re-evaluations.
  // DESIGN FIT:
  // Synchronizes physical brain thinking states with attention gating without polling.
  // =========================================================================
  api.agent.events.registerAgentEventSubscription({
    id: "perception",
    streams: ["lifecycle"],
    async handle(event) {
      const owner = parseAgentSessionKey(event.sessionKey ?? "");
      const data = LIFECYCLE.safeParse(event.data);
      if (!owner || !data.success || owner.rest !== "brain") return;

      if (data.data.phase === "start") {
        try {
          await perception.started(owner.agentId, event.runId);
        } catch (err: unknown) {
          api.logger.warn(`Perception started error: ${String(err)}`);
        }
      } else {
        try {
          await perception.ended(
            owner.agentId,
            event.runId,
            data.data.phase === "error" ||
              data.data.aborted === true ||
              data.data.stopReason === "aborted",
          );
        } catch (err: unknown) {
          api.logger.warn(`Perception ended error: ${String(err)}`);
        }
      }
    },
  });

  // =========================================================================
  // 5. TURN CONTEXT & DEADLINE HOOK: before_agent_reply
  // WHAT OPENCLAW DOES:
  // Fires right before prompt compilation and generation for an admitted agent turn.
  // WHAT KAZUSA DOES:
  // - Dual purpose:
  //   1. Cron Triggers (Task Heartbeat): Compares the character's active task lease
  //      in Taskman against simulated clock time. If the task has expired, calls
  //      `perception.deadline(agentId)` to enqueue a task completion stimulus and claims the turn.
  //   2. Brain Sessions (Attended Thought Tracking): Captures `event.cleanedBody` via
  //      `perception.attending(owner.agentId, event.cleanedBody)`.
  // DESIGN FIT:
  // Gives Jev awareness of the brain's active thoughts (`brainContext`) so it can make
  // informed interrupt/defer decisions when new stimuli arrive while the brain is busy.
  // =========================================================================
  api.on("before_agent_reply", async (event, ctx) => {
    if (ctx.trigger === "cron" || ctx.jobId) {
      try {
        await deps.clock.init();
        if (ctx.agentId) await perception.deadline(ctx.agentId);
      } catch (error) {
        api.logger.warn(`Perception deadline: ${String(error)}`);
      }
      return { handled: true };
    }
    const owner = parseAgentSessionKey(ctx.sessionKey ?? "");
    if (
      owner?.rest !== "brain" ||
      (ctx.agentId && ctx.agentId !== owner.agentId)
    ) {
      return { handled: true };
    }
    await perception.attending(owner.agentId, event.cleanedBody);
  });

  // =========================================================================
  // 6. STARTUP RECOVERY: gateway_start (State Reconciliation)
  // WHAT OPENCLAW DOES:
  // Fires once after all plugins and Gateway services have completed startup.
  // WHAT KAZUSA DOES:
  // Initializes Clock state and calls `perception.recover()`. Identifies unconfirmed
  // deliveries or interrupted turns from a prior crash/restart and safely resets
  // locks so characters can resume thinking without duplicate tool execution.
  // DESIGN FIT:
  // Provides crash resilience and zero state loss across Gateway restarts.
  // =========================================================================
  api.on("gateway_start", async () => {
    if (lifetime.signal.aborted) return;
    try {
      await deps.clock.init();
      if (lifetime.signal.aborted) return;
      await perception.recover();
    } catch (error) {
      if (lifetime.signal.aborted) return;
      throw error;
    }
  });
  return perception;
}
