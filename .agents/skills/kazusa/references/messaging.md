# Messaging — Conversations and Delivery

`src/messaging/` implements `send_message`, `list_chats`, and `manage_chat`,
registered by the unified plugin. Messaging owns conversation routing metadata
and direct/group chat persistence; Perception only admits stimuli after their
ledger writes have committed. Never dispatch a character turn in a chat ledger
or ask Perception to append the chat again. All character inference belongs to
`agent:<id>:brain`; private monologue or final brain prose never substitutes for
`send_message`.

## Authorship and roles

Derive the sender's stable agent ID from the tool execution context, not an
LLM-supplied argument. Resolve the display name from character identity data.
Write one record to each participant's private view of the conversation:

- Sender's ledger: `role: "assistant"`.
- Each recipient's ledger: `role: "user"`, even when the sender is another LLM.
- Direct keys: `agent:<owner>:chat:direct:<peer-id>`.
- Group keys: `agent:<owner>:chat:group:<group-id>`. Membership is resolved when
  a send is accepted. Each current member receives a private copy; membership
  never permits reading another agent's memories or backfilling older dialogue.

Roles describe a record relative to its **agent ledger owner**, not whether the
speaker is a human or an LLM. The same rule applies to direct and group chats:

| Actual speaker | Alice's native ledger       | Bob's native ledger         |
| -------------- | --------------------------- | --------------------------- |
| Alice          | `assistant`, self           | `user`, sender `alice`      |
| Bob            | `user`, sender `bob`         | `assistant`, self           |
| Human Sensei   | `user`, sender `user:sensei` | `user`, sender `user:sensei` |

The human row describes the required group projection; current WebChat ingress
only reaches the owner of its selected session. Native roles are a persistence
adapter detail. The production chat UI should render stable sender identities
and mark the viewer's own messages as self; it should not choose one character
as the group's universal assistant. Context assembly already renders each
character's private view as attributed dialogue, not a shared execution session.

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

## Installed SDK and migration boundary

The current dependency is OpenClaw `2026.10.5`. Messaging uses a version-2 tool
context so the host must supply `assertInvocationCurrent`, and passes its
post-acceptance delivery lifetime through transcript `preparation.source`. Do
not reintroduce the deprecated `beforeFreshMessageCommit` option.

This SDK exposes the guarded runtime `patchSessionEntry`, but does not export
`prepareSessionEntryPatch` or `applySessionEntryPatch`. The rolling
[session-entry migration guide](https://docs.openclaw.ai/plugins/sdk-migration/how-to-migrate#prepare-session-entry-changes)
deprecates `patchSessionEntry`. When upgrading OpenClaw, migrate ledger creation
to the injected `prepareSessionEntryPatch` with `prepare` and host `authority`;
do not declare a missing runtime method or add a legacy fallback. Availability
in the installed SDK is distinct from conformance to the latest rolling docs.

## Conversation tools and routing metadata

`send_message` has two mutually exclusive targeting forms:

- Existing chat: `sessionKey`, `text`. The caller supplies only its own full key
  or `chat:direct:...` / `chat:group:...` shorthand. The registry resolves the
  current members; do not require them again alongside the key.
- Start a chat and send its first message: `members` (other configured agent
  IDs), optional `title`, and `text`. The sender is included automatically. One
  other member without a title reuses the canonical direct pair; otherwise
  create a group. A title allows a two-person group. Text is limited to 32,000
  characters; media is future work.

The result includes the caller's `sessionKey` for later sends. Direct chat
identity is derived from its sorted pair. Group identity is opaque and derived
from the sender and an internal delivery ID. The adapter derives that ID from
the brain session UUID and host tool-call ID. Replaying the same host invocation
does not create another group; a fresh model call does, even with identical
arguments. Titles are labels, not identities; changing a title never changes a
key.

`list_chats({ query? })` returns only the caller's current memberships with its
own session keys, titles, and member IDs. It reads routing metadata, not
transcripts. Agents can use a known context header or result key directly;
lookup is needed only when choosing an unknown or ambiguous chat. Agent-facing
conventions call `chat:...` keys chat addresses while the API retains native
`sessionKey` terminology. All native session-orchestration tools are denied
via `tools.deny: ["group:sessions"]` (`sessions_list`, `sessions_history`,
`sessions_send`, `sessions_spawn`, `session_status`) in `openclaw.json`.
Native `memory_search` (with `sources: ["memory", "sessions"]`) indexes past
session transcripts and handles cross-session recall safely without exposing raw
session manipulation tools to roleplay characters.

`manage_chat` requires a group `sessionKey` and one action:

- `rename` with `title`.
- `add_members` or `remove_members` with only the affected `members`.
- `leave` with no additional fields.

Any current member may manage a group. Direct chats have fixed membership.
Changes affect future sends. A removed member keeps its prior private ledger but
cannot discover, manage, or submit new messages to the group. Joining creates an
empty native session view and never copies earlier dialogue. An accepted message
still finishes delivery to its original recipients after removal; replaying that
receipt is not acceptance of a new message.

The retained native `chats` keyed store owns only shared routing metadata:
conversation ID, kind, members, group title, creation fingerprint, and pending
native session projection. OpenClaw sessions remain each character's private
ledger; neither native participant identity nor sidebar grouping defines this
shared membership. Title changes project `displayName` with `preserveActivity`
so renaming does not pretend a new message arrived. Failed projections remain
pending and retry after restart. Removed members' old views remain unchanged. A
creation whose first delivery acceptance fails may leave discoverable empty
routing metadata; replaying the same host invocation reuses it. There is no
cross-store atomic transaction.

## Human player integration (`user:`)

Human players (such as Sensei) participate directly in the Kivotos simulation
without consuming agent runner processes or brain sessions:

- **Namespace & Addressing**: Human IDs use the `user:` prefix (e.g. `user:sensei`
  or `user:abc123`). Validated by `PARTICIPANT_ID = z.string().regex(/^(?:user:)?[a-z0-9][a-z0-9_-]*$/)`.
  Direct chats use the session key `agent:<agentId>:chat:direct:user:<userId>`
  (e.g. `agent:kazusa:chat:direct:user:sensei`).
- **Configuration**: For the single-user MVP, the active human identity is configured
  in `openclaw.json` under `plugins.entries.kazusa.config.user` (`id: "user:sensei"`,
  `name: "Sensei"`), declared in `openclaw.plugin.json`.
- **Zero-Waste Delivery**: When an agent sends a message to a human user, the
  sender's private ledger appends the outgoing assistant turn. In `send()`, copies
  for human recipients (`isUser(agentId)`) are marked pre-settled (`messageId: id,
  published: true, notified: true`). `projectChats()` skips human members, and
  neither native agent session initialization nor brain waking is attempted for
  the human.
- **Development WebChat Bridge**: The default WebChat is not the production UI.
  For development, a human can use a character's direct ledger session
  (`agent:<agentId>:chat:direct:user:<userId>`). The current `before_dispatch`
  hook claims the event, resolves a sender from the native input or peer/config
  fallback, and sends a simulation-timestamped stimulus to that owner's
  Perception. Generic input into `chat:direct:bob` can therefore be attributed
  to Bob; this development-only limitation is currently accepted.
- **Current Group Limitation**: Outgoing agent messages support human members,
  but native human ingress reaches only the selected session owner. It does not
  apply Kazusa group membership checks or copy the input to the other members.
  Pre-settled human copies are not evidence of a shared human group inbox.
- **Wiki Grounding**: Canonical human character data is documented in the World Wiki
  (`shared/wiki/entities/characters/sensei.md` with `is_simulated_agent: false`),
  while characters track their subjective relationship cards in their Personal Wiki
  (`workspaces/<id>/wiki/entities/characters/sensei.md` with `peer_id: "user:sensei"`,
  `name: "Sensei"`, `relation_type: "mentor"`, and concise `summary`).

### Production human conversations & Gateway HTTP Ingress

A human sends **to the conversation**, not to an arbitrarily selected member's
private session. The production ingress resolves the trusted human identity,
validates membership, captures simulation time and the current audience, and
uses the same message acceptance and fan-out policy as agent speech. Each agent
recipient gets an attributed private transcript copy before Perception is
notified. Humans have no brain to wake, no OpenClaw agent directory, and no
native agent session. A group message from Sensei to Alice and Bob reaches both
characters' private transcripts and triggers their Perception intake.

The plugin exposes standard Gateway HTTP routes (`api.registerHttpRoute`):
- `GET /kazusa/chats?userId=user:<id>`: Discovers all direct and group chats
  where `user:<id>` is currently a member.
- `GET /kazusa/messages?chatId=<chatId>&userId=user:<id>&cursor=<seq>&limit=<n>`:
  Returns subjective, cursor-paginated chat history where `audience.includes(userId)`.
  Uses OpenClaw's retained store (`entriesInKeyRange`) with sortable keys
  (`msg:${chatId}:${paddedSequence}`) for $O(\log N)$ SQLite-backed range scans.
  Joining grants no historical backfill; leaving cuts off future messages.
- `POST /kazusa/send`: Ingress endpoint for humans to send messages
  (`{ sender: "user:<id>", sessionKey: "<chatId>", text: "..." }`). Directly
  invokes `messaging.send()`, saving the canonical delivery, projecting copies
  to agent members, and waking their brains via `perception.receive()`.
- `POST /kazusa/chats/manage`: Manages group chat membership and titles
  (`{ userId: "user:<id>", sessionKey: "<chatId>", action: "add_members" | "remove_members" | "rename" | "leave", ... }`).

### Frontend Client Requirements

The dedicated frontend acts as the player's in-world smartphone (e.g., MomoTalk):
1. **API Ingress**: Communicates exclusively through the Gateway HTTP endpoints
   above (`/kazusa/chats`, `/kazusa/messages`, `/kazusa/send`). It must **never**
   attempt to send directly to an individual agent's native OpenClaw session or
   read an arbitrary member's ledger.
2. **Subjective Timeline & Audience Boundary**: The client queries chat history
   using `GET /kazusa/messages?userId=user:<id>&chatId=<chatId>`, displaying only
   dialogue transmitted while the user was in the room.
3. **Simulation Clock Synchronization**: The client synchronizes with the virtual
   simulation clock (`GET /kazusa/clock/time`) to format message timestamps in
   in-world time rather than host wall-clock time.
4. **Attributed Multi-Party Chat UI**: Renders messages with distinct sender cards
   and avatars, marking the human's messages as self and displaying agent peers
   by their canonical character names. It does not force an LLM "assistant" vs
   human "user" dichotomy.
5. **Real-Time Updates**: Polls or listens for incoming messages on active chats
   so incoming agent replies appear live as they are committed.

### Storage Architecture: Dual-Layered Messaging

1. **Canonical Retained Store (`api.runtime.state.openKeyedStore` with `retention: "retained"`)**:
   - Stores each canonical `MessageDelivery` once in SQLite under namespace `"messages"`.
   - Keys are sortable: `msg:${chatId}:${paddedSequence}` (e.g. `msg:group:afterschool:0000000042`).
   - Every delivery records its frozen `audience: readonly string[]`, `timestamp`, `sequence`,
     `sender`, and `params.text`.
   - Supports efficient cursor pagination via `entriesInKeyRange` with `limit` and `order: "desc" | "asc"`.
2. **Native Subjective Transcripts (`agent:<id>:chat:*`)**:
   - Maintained exclusively for AI agents to feed their LLM prompt assembly pipeline
     in the 3-Tier Context Engine.
   - Humans have no native transcripts; their subjective view is generated on demand
     by filtering the canonical store on `audience.includes(userId)`.

## Tool and delivery lifecycle

The tool requires the execution context's `agentId` and matching brain session.
Display names use the configured native identity, then the character's
`IDENTITY.md` YAML `name`, then the stable ID. Arguments cannot supply
authorship.

Agent-to-agent delivery is local. Recovery exists because acceptance, native
recipient transcript writes, and Perception intake are separate commits, not
because the simulation needs a remote messaging transport. A process restart or
plugin reload can interrupt those steps. An append can commit before its receipt
is saved, so retrying must reuse its identity instead of adding the text again.
Likewise, a committed record may still need its attention notification. Stable
IDs, retained unfinished work, and frozen audiences address those concrete gaps.
They do not promise a read receipt, an immediate reply, or exactly-once thinking.
The settled-result cache is an implementation choice, not a design requirement.

The retained native `messaging` store records intent before any append and
tracks session identity, committed message ID, publication, and attention
notification for each copy. The model supplies no request ID: the adapter hashes
the host's brain session UUID and tool-call ID into an internal `requestId`,
scoped again to the sender. Require both host IDs rather than inventing a random
fallback. Host replays reuse the original message, timestamp, and frozen
audience, including after membership edits. Changing arguments under that same
invocation is rejected. A fresh model call is a new message; identical text is
not sufficient evidence of a retry. Delivery retries run automatically from
retained state without another agent call. Per-copy native idempotency keys
survive partial failures and restarts. Exact-session appends reject a rebound
ledger instead of silently writing into a replacement session.

A single write queue serializes membership edits and send acceptance, then
orders copies by acceptance. A failed copy blocks later writes to that ledger
while other ledgers continue. Active deliveries are pruned from memory upon
settlement (`isDeliverySettled`). The service resumes retained work at startup
and retries pending work without invoking an LLM. Disposal cancels retries and
guards further writes.

**Current replay limitation:** `recentResults` retains only the last 200 settled
outcomes. `send()` does not look up evicted receipts in the retained store, so
an old replay can be accepted again with a new timestamp and current audience.
This violates the stable-replay contract above. The recommended simplification
is durable receipt lookup instead of the extra settled-result cache; the code
has not yet been changed. Retained records and startup loading are also not
bounded by this cache limit.

After a recipient copy commits, messaging publishes its native transcript update
and directly submits its unchanged text, stable sender ID, message ID, and
original timestamp to `perception.receive()`. It never dispatches a turn to a
chat session or routes its own notification back through `before_dispatch`.
Notifications run outside the write queue and are not awaited by the sending
tool: recipient turns can themselves send messages without deadlocking.

`delivered` confirms all ledger copies committed; `pending` confirms retained
intent with incomplete ledger delivery. Neither is an attention or reply
receipt. Attention delivery is retried with the same stimulus ID; Perception
owns its existing deduplication and adoption policy. There is no cross-store
transaction or claim of exactly-once brain execution. `IGNORE` keeps the chat
record.

See [context assembly](context_engine.md) for the shared simulated-time window
and [Perception](perception.md) for attention admission. The always-loaded
`context-conventions` agent skill teaches discovery, both send forms, group
management, and retry behavior.

`conversations.ts` defines tool schemas and conversation addressing;
`messaging.ts` owns membership and the retained delivery state machine;
`register.ts` binds those policies to native state, session, transcript,
identity, lifecycle, and tool-context APIs.
