# `send_message` — Planned Chat Writer Contract

`send_message` is not implemented yet. Context assembly already expects this
contract. The tool owns direct/group chat persistence; Perception only admits
stimuli after their ledger writes have committed. Never dispatch a character
turn in a chat ledger or ask Perception to append the chat again.

## Authorship and roles

Derive the sender's stable agent ID from the tool execution context, not an
LLM-supplied argument. Resolve the display name from character identity data.
Write one record to each participant's private view of the conversation:

- Sender's ledger: `role: "assistant"`.
- Each recipient's ledger: `role: "user"`, even when the sender is another LLM.
- Direct keys: `agent:<owner>:chat:direct:<peer-id>`.
- Group keys: `agent:<owner>:chat:group:<group-id>`. Only actual recipients
  receive a copy; membership is not permission to read another agent's memories.

Set native attribution on the copies, alongside the ordinary message fields:

```typescript
{
  role, // assistant for the sender's copy; user for a recipient's copy
  content: [{ type: "text", text }],
  timestamp: simulationTimestamp,
  __openclaw: {
    senderId: agentId,
    senderName: displayName,
    senderIdentity: {
      type: "observation",
      id: agentId,
      pluginId: "kazusa",
      accountId: null,
      senderKind: "bot",
    },
  },
}
```

These are OpenClaw's native persisted sender fields, not a custom Kazusa
metadata schema. `senderId` and `senderIdentity.id` must agree. Observation
identity is attribution, never an authorization credential. Do not invent a
human `profile` identity for a character. OpenClaw 2026.10.5's transcript sender
reader accepts `profile`, `remote`, and `observation`, but rejects `agent` even
though the broader participant type includes it. The native builder is not a
public SDK export; verify this persisted format when upgrading OpenClaw.

Do not insert `[speaker:...]` or `Name:` prefixes for attribution. Body text is
dialogue, not identity. The catalog reader projects incoming native metadata to
`item.sender.identity` and `item.sender.label`; outgoing `agentMessage` items
are self-authored in the owner's ledger and do not expose a sender projection.
Missing sender metadata renders as `unknown`, never a guess from text or the
direct-chat peer. Existing unattributed records are not silently migrated.

## Persistence and notification

- Use the public session-transcript runtime to append and publish updates. No
  custom SQLite reads/writes or transcript schema patches.
- Record native `message.timestamp` in simulation milliseconds. Preserve the
  occurrence timestamp across recipient copies and later attention admission;
  keep host envelope timestamps and session bookkeeping in real time.
- Serialize ledger appends in nondecreasing simulation-time order, including
  concurrent group senders. Equal timestamps preserve append order. Do not
  append backdated imports into a live ordered ledger: context pagination stops
  at the first older-than-window record.
- Use stable per-copy idempotency keys so retrying a partially delivered group
  message cannot duplicate successful writes. Notify Perception only after the
  corresponding recipient copy commits; `IGNORE` never erases that copy.
- Keep one text block per record, including any future media summary. This keeps
  one catalog text item equal to one chat/task message. Context assembly accepts
  native catalog display normalization and its 6,000-character item clipping,
  then budgets whole returned items without further clipping.

See [context assembly](context_engine.md) for the shared simulated-time window
and [Perception](perception.md) for attention admission. This contract does not
implement the tool or require Perception to own any transcript writes.
