import {
  generateSecureUuid,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  appendSessionTranscriptMessageByIdentityStrict,
  publishSessionTranscriptUpdateByIdentity,
} from "openclaw/plugin-sdk/session-transcript-runtime";

/**
 * Passive per-character ledgers written outside a chat. Every ledger is
 * character-facing narrative, replayed into the character's and the decision
 * model's context; observer-only records belong in a keyed store instead.
 */
const LEDGERS = {
  tasks: "Tasks",
} as const;

export type LedgerStream = keyof typeof LEDGERS;

/**
 * Append one narrative row to `agent:<agentId>:<stream>`, carrying structured
 * journal metadata (`{ kind, payload }`) for the timeline.
 */
export async function appendLedgerEntry(
  api: OpenClawPluginApi,
  entry: {
    readonly agentId: string;
    readonly stream: LedgerStream;
    readonly text: string;
    readonly timestamp: number;
    readonly metadata?: unknown;
  },
): Promise<void> {
  const { agentId, stream, text, timestamp, metadata } = entry;
  const sessionKey = `agent:${agentId}:${stream}`;
  const now = Date.now();
  const ledger = await api.runtime.agent.session.patchSessionEntry({
    agentId,
    sessionKey,
    fallbackEntry: {
      sessionId: "",
      updatedAt: now,
      displayName: LEDGERS[stream],
    },
    update: (current) =>
      current.sessionId?.trim()
        ? null
        : { sessionId: generateSecureUuid(), updatedAt: now },
  });
  const sessionId = ledger?.sessionId?.trim();
  if (!sessionId) {
    throw new Error(`Could not initialize ledger ${sessionKey}.`);
  }
  const identity = { agentId, sessionKey, sessionId };
  // A ledger needs an append, without loading its history into a
  // SessionManager. The identity helper owns the write transaction; notify
  // transcript subscribers only after it returns a committed message ID.
  //
  // Writers often run inside the character's :brain turn (task tools). The
  // lenient append inherits that turn's writer claim and OpenClaw refuses it
  // for this other session ("session writer claim changed before transcript
  // persistence"). The strict append fences against this ledger's own session.
  const appended = await appendSessionTranscriptMessageByIdentityStrict({
    ...identity,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      // Character experience uses simulation time. Native entry/envelope
      // bookkeeping remains wall-clock for OpenClaw's lifecycle machinery.
      timestamp,
      ...(metadata ? { __openclaw: { kazusa: metadata } } : {}),
    },
  });
  if (appended.kind !== "result") {
    throw new Error(`Ledger append ${appended.kind}: ${sessionKey}.`);
  }
  await publishSessionTranscriptUpdateByIdentity({
    ...identity,
    update: { messageId: appended.result.messageId },
  });
}
