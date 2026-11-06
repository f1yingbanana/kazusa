# Messaging — Conversations and Delivery

`src/messaging/` implements `send_message`, `create_group`, `talk`,
`list_chats`, `manage_chat` and `set_typing`, registered by the unified plugin.
Messaging owns conversation routing metadata and direct/group chat persistence;
Perception only admits stimuli after their ledger writes have committed. Never
dispatch a character turn in a chat ledger or ask Perception to append the chat
again. All character inference belongs to `agent:<id>:brain`; private monologue
or final brain prose never substitutes for `send_message`.

## Authorship and roles

Derive the sender's stable agent ID from the tool execution context, not an
LLM-supplied argument. Resolve the display name from character identity data.
Write one record to each participant's private view of the conversation:

- Every copy, the sender's own included: `role: "user"`. OpenClaw's catalog
  projects `senderIdentity` only for user-role rows, so an assistant-role self
  copy would read back unattributed.
- Direct keys: `agent:<owner>:chat:direct:<peer-id>`.
- Group keys: `agent:<owner>:chat:group:<group-id>`. Membership is resolved when
  a send is accepted. Each current member receives a private copy; membership
  never permits reading another agent's memories or backfilling older dialogue.
- Huddle keys: `agent:<owner>:chat:huddle:<id>`, a face-to-face conversation at
  one place (`kind: "huddle"`, id `huddle:<id>`, `placeId`). `talk({ members })`
  turns to people at the sender's place (checked through the `placeOf`
  dependency), one person's move at a time; huddles never merge (live, merging
  grew one to 17 people). To people in another huddle the speaker walks over to
  it; to some of the speaker's own, a side conversation splits off and the rest
  get `*turns to talk with …*`; to people in none, they join the speaker's, or
  one starts. People in two huddles at once are refused. Older merged huddles
  keep `mergedInto`, so replies to an old address land in the new one. Speaking
  into a huddle's address at its place walks over to it and takes the speaker
  out of their other one. `leavePlace` (called by Location on every move)
  removes the mover with a `*leaves, heading toward …*` line to those still in
  it; moving to another huddle posts `*moves to another conversation*`. A huddle
  with fewer than two left dissolves. Same frozen-audience rule; `manage_chat`
  only `leave`s a huddle: `*steps back from the conversation*`, still at the
  place. See `apps/kazusa/docs/location.md` §4.6.

Authorship is the `senderIdentity`, never the role. The same rule applies to
direct and group chats:

| Actual speaker | Alice's native ledger         | Bob's native ledger          |
| -------------- | ----------------------------- | ---------------------------- |
| Alice          | `user`, sender `alice` (self) | `user`, sender `alice`       |
| Bob            | `user`, sender `bob`          | `user`, sender `bob` (self)  |
| Human Sensei   | `user`, sender `user:sensei`  | `user`, sender `user:sensei` |

The human row describes the required group projection; current WebChat ingress
only reaches the owner of its selected session. Native roles are a persistence
adapter detail. The production chat UI should render stable sender identities
and mark the viewer's own messages as self; it should not choose one character
as the group's universal assistant. Context assembly already renders each
character's private view as attributed dialogue, not a shared execution session.

Set native attribution on the copies, alongside the ordinary message fields:

```typescript
{
  role: "user", // every copy; the sender is identified by senderIdentity
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
not identity. Context rendering uses only `__openclaw.senderIdentity.id`, as
exposed by the native catalog's `item.sender.identity.id`, for **both** native
roles. `(self)` requires that explicit ID to match the ledger owner. Missing
metadata renders `unknown`; role, peer address and display name are never
fallback evidence. Task records need no speaker.

**Installed SDK limitation:** OpenClaw 2026.10.5 persists outgoing metadata but
omits it from assistant catalog items. Those records currently render `unknown`.
The native transcript contract test covers this omission. Keep the bounded
catalog reader; do not add full-history scans or role inference to conceal it.
Complete outgoing attribution needs a native bounded read exposing the stored
metadata (or an upstream catalog fix). Human sends use `senderKind: "human"`;
agent sends use `"bot"`.

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

`send_message` takes a required `sessionKey` and `messages`: it only ever says
something somewhere. The caller supplies its own full key or the `chat:...`
shorthand; the registry resolves the current members. Starting a chat is its own
tool: `create_group({ members, title? })` for a text group (one other member is
the canonical direct pair, and its title is ignored), `talk({ members })` for a
conversation in person; each returns the address. A direct chat needs neither:
`chat:direct:<id>` works on first contact. An optional target was left out on
41% of follow-up sends, and the either/or rule can't be stated in a tool schema
(2026-11-05). `messages` holds 1 to `messaging.maxBubbles` (default 9) bubbles,
each up to 4,000 characters: a string (speech) or
`{ text, type: "speech" | "action" }`. An action is done, not said, in third
person without the sender's name; it is kept only in a place conversation (aloud
or a `chat:huddle:` address) and silently dropped in text chats. The canonical
message stores the plain text and `type`; agent ledgers, deliveries and
`said`/`unsaid` read it as `*text*`, and the client gets `type: "action"`. Face
to face every bubble is split on `*…*` (those segments are actions, the rest
speech, asterisks stripped), so gestures typed inline or inside an action arrive
typed; text chats keep speech as typed. System lines (leaving, moving to another
conversation, `manage_chat` changes) are actions too. Media is future work. The
human HTTP send keeps a single `text` per request. Absent stored titles are
`null`, not `undefined`, so retained records satisfy the native JSON state
contract.

Direct chat identity is derived from its sorted pair. The adapter generates a
fresh server-owned UUID for every send, independent of the provider's reusable
tool-call IDs. A new group or huddle gets a random 10-character id
(`newChatId`), short enough to copy into every reply; each `create_group` makes
a new group. Titles are labels, not identities; changing a title never changes a
key.

`list_chats({ query? })` returns only the caller's current memberships with its
own session keys, titles, and member IDs. It reads routing metadata, not
transcripts. Agents can use a known context header or result key directly;
lookup is needed only when choosing an unknown or ambiguous chat. Agent-facing
conventions call `chat:...` keys chat addresses while the API retains native
`sessionKey` terminology. All native session-orchestration tools are denied via
`tools.deny: ["group:sessions", "message"]` (`sessions_list`,
`sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`) in
`openclaw.json`, on top of an explicit character `tools.allow` list. The
built-in `message` tool is also denied: its native delivery mirror bypasses
Kazusa canonical acceptance and cannot substitute for `send_message`. Native
`memory_search` (with `sources: ["memory", "sessions"]`) indexes past session
transcripts and handles cross-session recall safely without exposing raw session
manipulation tools to roleplay characters.

`manage_chat` requires a group `sessionKey` and one action:

- `rename` with `title`.
- `add_members` or `remove_members` with only the affected `members`.
- `leave` with no additional fields.

Any current member may manage a group. Direct chats have fixed membership. Each
change is announced in the group as a message from the actor
(`*adds Natsu to the chat*`, `*removes …*`, `*leaves the chat*`,
`*renames the chat to "…"*`): for those going, before they go; for those coming,
once they are in. A replayed change is not announced twice. Changes affect
future sends. A removed member keeps its prior private ledger but cannot
discover, manage, or submit new messages to the group. Joining creates an empty
native session view and never copies earlier dialogue. An accepted message still
finishes delivery to its original recipients after removal; replaying that
receipt is not acceptance of a new message.

The retained native `chats` keyed store owns only shared routing metadata:
conversation ID, kind, members, group title, creation fingerprint, and pending
native session projection. OpenClaw sessions remain each character's private
ledger; neither native participant identity nor sidebar grouping defines this
shared membership. Title changes project `displayName` with `preserveActivity`
so renaming does not pretend a new message arrived. Failed projections remain
pending and retry after restart. Removed members' old views remain unchanged. A
creation whose first delivery acceptance fails may leave discoverable empty
routing metadata; an internal retry with the retained request ID reuses it.
Re-executing the tool starts a new send. There is no cross-store atomic
transaction.

## Human player integration (`user:`)

Human players (such as Sensei) participate directly in the Kivotos simulation
without consuming agent runner processes or brain sessions:

- **Namespace & Addressing**: Human IDs use the `user:` prefix (e.g.
  `user:sensei` or `user:abc123`). Validated by
  `PARTICIPANT_ID = z.string().regex(/^(?:user:)?[a-z0-9][a-z0-9_-]*$/)`. Direct
  chats use the session key `agent:<agentId>:chat:direct:user:<userId>` (e.g.
  `agent:kazusa-kyouyama:chat:direct:user:sensei`).
- **Configuration**: For the single-user MVP, the active human identity is
  configured in `openclaw.json` under `plugins.entries.kazusa.config.user`
  (`id: "user:sensei"`, `name: "Sensei"`), declared in `openclaw.plugin.json`.
- **Human delivery**: Humans belong to the canonical message's frozen
  `audience`. `copies` contains actual agent projections only; there are no fake
  settled human copies, human agent directories or human brains. Human history
  is read from the canonical store, filtered by acceptance-time audience.
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
  Do not post human messages into native WebChat group sessions, even when the
  human is a member. Use the Kazusa conversation ingress after client wiring is
  validated; native WebChat remains a direct-chat development bridge.
- **Wiki Grounding**: Canonical human character data is documented in the World
  Wiki (`shared/wiki/entities/characters/sensei.md` with
  `is_simulated_agent: false`), while characters track their subjective
  relationship cards in their Personal Wiki
  (`workspaces/<id>/wiki/entities/characters/sensei.md` with
  `peer_id: "user:sensei"`, `name: "Sensei"`, `relation_type: "mentor"`, and
  concise `summary`).

### Human conversations and the custom client

Human sends must use the same acceptance and agent fan-out policy as agent
speech. `Messaging.send()` supports human participant IDs and writes each agent
copy before notifying that agent's Perception. It never creates a human brain.
The HTTP adapter exposes `/kazusa/chats`, `/kazusa/messages`, `/kazusa/send`,
`/kazusa/chats/manage`, `/kazusa/agents`, `/kazusa/typing` and `/kazusa/events`.
These are Kazusa routes, not native `chat.send`. Wire schemas are shared through
`@kazusa/client`; the backend binds the configured single human. See
[the client reference](client.md) for typing, sequence pagination and live
verification. End-user authentication is deferred.

Native WebChat's claimed-dispatch fallback may persist a human message with
wall-clock time and native input identity after the Perception hook runs. It
bypasses canonical acceptance and does not fan out to other group members.
Changing the frontend while retaining native `chat.send` does not fix this.

### Design decision: canonical server and private agent projections

The retained native `messaging` keyed store is the **canonical conversation
server**. Each accepted message is stored once, permanently, keyed by its stable
message ID. It records text, sender ID/name, conversation ID, simulation time,
acceptance sequence, frozen `audience`, and agent-copy progress. There is no TTL
or deletion on delivery completion. The separate retained `chats` store owns
current membership and titles. There is no additional `messages` namespace,
custom SQLite schema, or second canonical message database.

Each native `agent:<id>:chat:*` transcript is that character's private **client
projection**, retained for context assembly and native session-memory search. It
contains only messages that character was entitled to receive. Human clients
read the same canonical history filtered by frozen audience; they do not read
another character's private session. Joining grants no backfill, leaving stops
future receipt, and previously received history remains readable. Removal does
not cancel delivery of already accepted messages.

Projection checkpoints live on the canonical record. Only unfinished work stays
in RAM; replay reads the permanent message by ID and keeps its original audience
and time. This removes the separate settled-result cache. Humans need neither
projection checkpoints nor synthetic native receipts. A message's existence
means accepted, not necessarily projected, noticed or answered.

Tradeoff: canonical text plus agent transcripts consumes extra disk space, and
cross-store appends still need small recovery checkpoints. In return, history
and retry identity have one source of truth, human groups need no dummy agent,
and clients can resynchronize without merging private ledgers. Startup and
current human history queries scan the retained store; history is then filtered
and paginated by acceptance sequence. This is O(total retained messages), not an
indexed range query. Add an actual supported index only when measured volume
requires it; do not query `msg:...` keys that the writer never saves.

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
They do not promise a read receipt, an immediate reply, or exactly-once
thinking. No settled-result cache is needed; durable message lookup handles
internal delivery retries.

The retained native `messaging` store records intent before any append and
tracks session identity, committed message ID, publication, and attention
notification for each copy. The model supplies no request ID: the adapter
creates a fresh server-owned UUID inside each tool execution, scoped again to
the sender. Provider tool-call IDs are correlation metadata and may repeat
within one brain session; never use them for durable deduplication. Re-executing
the tool accepts a new send, even with identical text or a reused call ID. This
avoids rejecting valid speech and requiring another model call. A host replay
after acceptance persists but before its result is recorded can therefore
duplicate a send; this is an accepted tradeoff, not an exactly-once invocation
guarantee.

Delivery retries run automatically from retained state without another agent
call. They reuse the accepted message, timestamp, frozen audience and per-copy
native idempotency keys, including across membership edits, partial failures and
restarts. Exact-session appends reject a rebound ledger instead of silently
writing into a replacement session.

A single write queue serializes membership edits and send acceptance, then
orders copies by acceptance. A failed copy blocks later writes to that ledger
while other ledgers continue. Active deliveries are pruned from memory upon
settlement (`isDeliverySettled`). The service resumes retained work at startup
and retries pending work without invoking an LLM. Disposal cancels retries and
guards further writes.

Internal retries consult the retained message even after hundreds of newer sends
and across restarts. Conflicting payloads under the same internal request ID are
rejected. Client message events fire on new canonical acceptance, not on an
internal retry. They are best-effort invalidations; clients recover missed
events by reading history rather than requiring another durable event-delivery
log.

After a recipient copy commits, messaging publishes its native transcript update
and directly submits its unchanged text, stable sender ID, message ID, and
original timestamp to `perception.receive()`. It never dispatches a turn to a
chat session or routes its own notification back through `before_dispatch`.
Notifications run outside the write queue and are not awaited by the sending
tool: recipient turns can themselves send messages without deadlocking. The
owning instance's `api.lifecycle.runInBackgroundContext` clears caller context,
and `runDetachedWebhookWork` reserves notification work before the HTTP/tool
owner returns (`src/background-work.ts`). Retry timers use the same pair. A bare
webhook helper does not clear Gateway caller authority. Perception independently
owns the delayed coalescer and full brain dispatch scopes; a bare
fire-and-forget promise can inherit a closed host scope even in this entirely
local system.

`delivered` confirms all required agent ledger copies committed; `pending`
confirms retained intent with incomplete ledger delivery. Neither is an
attention or reply receipt. Attention delivery is retried with the same stimulus
ID; Perception owns its existing deduplication and adoption policy. There is no
cross-store transaction or claim of exactly-once brain execution. `IGNORE` keeps
the chat record.

**Read receipts** are the one attention fact a sender sees. A recipient copy's
`readAt` is the sim time its brain was shown the message: Perception's `onRead`
fires when a delivery is adopted (after any `response_latency` wait, or when a
deferred message is picked up) and when `recover()` finds a handoff the brain
already took. `markRead` stamps the copies and emits SSE `read`. In a text chat
every unread copy up to the newest message shown is read, as opening a chat
shows everything above it. Face to face the wait is short, and only the lines
taken in count (the client says "observed"): a line let go unheard, stale or
tuned out, isn't heard later. Ignored, waiting and offstage messages stay
unread. A steer carried back by an interrupted send is read when the next model
call starts on it, so a text in the chat being typed into is read seconds after
it arrives. Humans have no copies, so no receipts. `clientMessage` projects
`receipts: [{ id, readAt? }]`, one per recipient copy.

## Paced speech (outbox)

A person types bubble by bubble, and can be cut off. Each bubble in `messages`
becomes its own canonical message with
`requestId = messagingId([toolRequestId, index])`, so history, ordering, frozen
audiences, ledger copies and notifications are unchanged per bubble.

- **Pacing.** Every bubble, the first included, takes its time to compose before
  it is sent: thinking is not typing. `composingMs(text, medium, rates, pace)`
  (`messaging/composing.ts`) sums each character's time per writing system
  (`messaging.rates.typing` and `.speaking`), counted as graphemes, so an emoji
  is one key. Typed on a phone every key counts, spaces and punctuation too:
  letters 3/s (36 words a minute, Palin et al. 2019), Chinese characters and
  kanji 0.75/s (a reading, then a pick), kana 1.5/s, Hangul blocks 1.2/s; the
  last three are estimates from small studies. Said aloud only what is
  pronounced takes time (letters 12/s, han 5/s, kana 8/s, hangul 7/s). A sticker
  takes 1.5 s to pick; an action takes no time. No cap: a long message takes
  long. Jev judges the pace once per send (`pace`, 0.6-1.6) for texts and speech
  alike. The wait is on the simulation clock: wall time is the remaining sim
  time divided by speed, re-checked at most every 250ms. A paused clock
  (speed 0) holds the bubble until it runs again; the shutdown signal lets the
  rest go at once. The system agent and recovered plans send at once.
- **Typing indicator.** Set only while a bubble is being typed or said, in that
  bubble's chat, with `mode: "typing" | "speaking"`; the send, or anything that
  stops it, clears it. Reading a message or thinking about a reply sets nothing:
  read receipts and the brain's status show those. A character's indicator has
  no expiry; a player's lapses after 8 s unless the composer renews it.
- **Face to face** (a huddle), every spoken line also waits for the huddle's
  floor; actions never do. A steer that stops a line mid-way commits what was
  heard of it, ending in "—"; a text stopped while being typed is never sent.
  See [floor](floor.md).
- **Blocking tool.** `send_message` returns only after the last bubble or an
  interruption, so the brain stays busy and new stimuli are judged by
  `attention_allocation` with the current speech in Jev's state. The time it
  waits is not thinking, so it costs nothing of the run's time limit.
- **Interruption.** A steer for a speaker goes to
  `Messaging.interrupt(agentId, { message, atPause })`, which aborts the outbox
  and keeps the message on the speech under way. Unsent bubbles are dropped and
  never reach any ledger; a text being typed is never sent. The result reports
  `{ status: "interrupted", said, unsaid, meanwhile }`, and the tool's reply is
  the usual JSON followed by `meanwhile` as its own text, read as a delivery is.
  Perception marks it read when the next model call starts and adopts it when
  one completes; a run that ends first (a limit, a failure) leaves it waiting
  for the next turn. Handing the steer to the host instead, after the abort,
  lost a race: the abort returned the tool, the next model call started, and the
  steer landed only after the next send (live, 1-11 minutes of typing blind).
  With `atPause`, a line being said aloud is finished first (`yielding`), then
  the send stops.
- **On screen.** A text arriving in the chat a send is typing into is seen as it
  arrives: Perception steers it without asking Jev, so the send stops and the
  turn decides whether to send the rest. Nothing is sent by default.
- **A send begins** (`speaking` dependency): Perception takes back a steer still
  waiting for the host, and it rides on this send instead, before a word is
  typed.
- **Crash recovery.** The plan is retained in the `outbox` store at the start of
  the call and deleted when it completes or is interrupted. On startup,
  `resume()` sends every bubble of a surviving plan immediately; bubbles that
  were already sent are replays of their stable IDs. Re-executing the tool is
  instead a new send with a new server-owned identity.
- **One outbox per character.** A new `send_message` from the same character
  aborts an older one still pacing.

## Stickers

A sticker is a picture of the sender from their own sticker set, sent as a
bubble of its own: `{ "sticker": "maid-laughing" }` beside speech and actions in
`messages`. In this kind of roleplay it adds imagery to a chat rather than
copying how often a real person sends one, so the wording asks for good taste: a
sticker marks a change of mood and doesn't repeat the last one, unless a strong
feeling deserves the emphasis. That is a hint only. Code never rejects a
repeated mood or limits how many a send has, and a world overrides the wording
in its own `kazusa-tools#send_message.messages.sticker`.

**Files.** `workspaces/<id>/stickers/<name>.<webp|png|gif|jpg|avif>`, raster
only, about 256 px square with a transparent background. A name is lowercase
words joined by `-`: `[<outfit>-]<mood>`, such as `laughing` or `maid-laughing`.
The mood comes first from a shared vocabulary (neutral, happy, laughing,
excited, smug, shy, flustered, sheepish, surprised, confused, worried, sad,
crying, annoyed, angry, determined, thinking, sleepy), or another plain word
where none fits. Each name is distinct, so there is no `-2`. The optional
`stickers/stickers.json` adds what the files can't say:

```json
{
  "outfits": { "maid": "a black-and-white maid dress and headband" },
  "stickers": {
    "maid-laughing": { "look": "laughing with eyes squeezed shut" }
  }
}
```

- `outfits` describes each outfit other than the character's usual clothes
  (those in `IDENTITY.md`) once. A name's first word is an outfit only when
  `outfits` declares it, so `eyes-closed` stays a mood.
- `look` starts with the mood and says what the face does. Without it the mood
  word stands alone. A sticker missing from `stickers` still works.

**Sending.** `src/stickers/` reads a character's set from disk each time its
tools are built, so an edit applies from the next turn. The set becomes an
`enum` of names on the sticker bubble, and the outfit list fills the wording's
`{data}`. A character without stickers has no sticker bubble at all, so nothing
tempts it. `send_message` resolves the name before pacing: the retained bubble
is `{ type: "sticker", text, sticker: { name, v } }`, where `text` is what
everyone reads, frozen at send, and `v` is the file's mtime in base 36.

**What everyone reads.** `text` is `<Name>, <look or mood>[, in <outfit>]`, for
example "Aris, laughing with eyes squeezed shut, in a black-and-white maid dress
and headband". Ledgers, notifications and Jev read it as
`[type=sticker] <text>`. Nobody makes a vision call. Like an action in a text
chat, a sticker in a huddle or said `aloud` is dropped, because it is a phone
thing.

**Client.** `ChatMessage` carries `type: "sticker"`, `text` as alt text and
`sticker: { name, url }`. The url is
`/kazusa/sticker?id=<sender>&name=<name>&v=<v>` and is served from the workspace
like an avatar, cached forever. Replacing a file changes `v` only for later
messages; old ones load whatever the name holds now. The chat shows the image
without a bubble at about 128 px, and the chat list previews it as "Sticker".
The player can't send stickers yet.

**Importing.** `scripts/stickers.mjs` stages a set from a MediaWiki gallery and
places a labelled set into a workspace:

- Blue Archive expression portraits are full-body pictures where only the face
  changes. `stage` finds the face from where the expressions differ and crops
  one square for the whole set.
- Genshin Impact's "Paimon's Paintings" are stickers already; `stage` trims and
  resizes them.
- Labelling is by eye from the staged contact sheet. `place` writes the files
  and `stickers.json`.

See [context assembly](context_engine.md) for the shared simulated-time window
and [Perception](perception.md) for attention admission. The always-loaded
`context-conventions` agent skill teaches discovery, both send forms, group
management, and retry behavior.

`conversations.ts` defines tool schemas and conversation addressing;
`messaging.ts` owns membership and the retained delivery state machine;
`register.ts` binds those policies to native state, session, transcript,
identity, lifecycle, and tool-context APIs. `http.ts` serves the configured
human through the shared client contract. `set_typing` explicitly signals
composition; native lifecycle events only clear it, never infer it from
thinking.
