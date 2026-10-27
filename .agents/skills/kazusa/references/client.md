# Kazusa client: requirements and integration

`apps/web` is the human player's in-world chat interface. It uses the Kazusa
conversation API, with shared wire schemas in `packages/client` (`@kazusa/client`).
Native WebChat sessions are not group conversations. Do not send group messages
through native `chat.send` or read UI history through native `chat.history`.

## Product and architecture decisions

- The retained `messaging` store is the canonical conversation server; `chats`
  owns membership and titles. Native agent transcripts are private projections
  for context and memory search. Humans need no dummy agent, transcript or brain.
- A send freezes its audience and commits each agent's copy before notifying
  that agent's Perception. Ignoring the stimulus does not erase the message.
  Inference happens only in `agent:<id>:brain`.
- Display `senderId` and `senderName`; mark the configured human as self.
  Native assistant/user roles do not determine UI authorship or alignment.
- The MVP has one configured human, returned by `/kazusa/chats`. Request bodies
  cannot choose a sender. End-user authentication and observer mode are deferred;
  this is a local single-player client, not a multi-user authorization system.
- Joining grants no earlier history; removal stops future sends and receipt.
  Rejoining does not reveal messages sent during the absence. Previously received
  history remains readable, filtered by each message's frozen audience.
- Any current member may rename a group, add/remove members or leave. Direct pairs
  have fixed membership. Titles are labels; conversation IDs remain stable.
- A new group is a local draft until its first message creates the conversation.
  Existing chats need only their address and text, never a repeated member list.
- Local pending, canonical acceptance and completed agent projections are distinct.
  None means noticed, read or guaranteed reply.

## API and client behavior

The Next route `app/kazusa/[...path]/route.ts` forwards the fixed API paths to the
Gateway on the same origin, including SSE. `KAZUSA_GATEWAY_URL` selects the
upstream; an optional server-only `OPENCLAW_GATEWAY_TOKEN` is forwarded without
exposing it in browser configuration. Current plugin routes use `auth: "plugin"`
with the fixed single-player identity. Authentication remains a separate deferred
requirement; the proxy is not a login system.

| Route | Contract |
| --- | --- |
| `GET /kazusa/agents` | Roster IDs, display names and optional avatars. |
| `GET /kazusa/chats` | Configured human and conversations with canonical `id`, viewer `sessionKey`, `type`, `name`, members and latest preview. |
| `GET /kazusa/messages` | `chatId`, optional sequence `before`, optional `limit`; returns `messages`, `nextCursor`, `hasMore`. |
| `POST /kazusa/send` | Stable automatic `requestId`, text and either `sessionKey` or new-chat members/title; returns canonical message and delivery status. |
| `POST /kazusa/chats/manage` | `sessionKey` plus `rename`, `add_members`, `remove_members` or `leave`. |
| `POST /kazusa/typing` | `sessionKey` and `isTyping` for the configured human. |
| `GET /kazusa/events` | Audience-filtered message, typing and chat-change events; initial connected event includes active typing. |

Messages use canonical simulation timestamps and acceptance sequences. Pagination
uses the server's `nextCursor` and `hasMore`, never timestamps or page length;
several messages may share a frozen-clock time. Each browser submission gets one
automatic UUID, retained across retries. Reconcile the optimistic bubble by
`requestId`, then use its canonical ID/sequence/time. Equal text is not a retry.

SSE carries best-effort notifications, not another durable message log.
Deduplicate by message ID, refresh history after reconnect and invalidate chat
metadata after membership/title changes. Subscription precedes the initial
snapshot so changes during that read are buffered. Slow connections close and
recover through ordinary history refresh.

## Typing means composing

An agent calls `set_typing({ sessionKey, isTyping: true })` only after deciding to
compose a reply, before drafting the text. Perception, model start and adoption
are not typing signals. Sending, abandoning composition or ending/erroring the
owning brain run clears the indicator. Matching run IDs prevent an old completion
from clearing a newer run's indicator. The extra explicit tool call is deliberate:
we cannot infer commitment to reply from private thought. A model that skips the
call can still send; do not simulate typing retroactively.

Human typing comes from composer activity, refreshes while input continues and
expires after eight seconds if the browser disappears. Agent typing lasts until
send/cancel/run completion, not a short timeout while a model is drafting.
Membership checks and audience filtering apply to both. Reconnect restores the
active snapshot; membership removal clears the affected indicators.

## Minimum backend complexity

Keep one permanent canonical record, its frozen audience and progress for actual
agent copies. Stable per-copy IDs cover a restart between separate SQLite
commits. Only unfinished work needs in-memory tracking/retry scheduling.
Perception owns attention deduplication and adoption. Do not add a settled-result
cache, fake human receipts or a second browser-delivery ledger.

History and startup currently scan retained records: simple at current volume,
but O(total history). Add a supported index only after measuring the cost.
`messaging.ts` owns policy; `http.ts` adapts it to the wire contract and uses the
installed SDK's bounded request-body reader. `register.ts` binds native storage,
transcripts, tools and lifecycle. The context renderer uses only native sender
metadata projected from `__openclaw`; the installed catalog's omission of
outgoing assistant metadata is independent of the UI's canonical sender fields.

## Validation

Run `npm test`, `npm run typecheck` and
`npx tsc --noEmit --incremental false -p apps/web/tsconfig.json`. A build that ignores
TypeScript failures is not sufficient. Unit tests cover delivery/retry, membership,
attribution, typing lifecycle, HTTP handlers and sequence pagination. The native
transcript contract test separately uses temporary OpenClaw SQLite stores.

Live verification on 2026-10-27 exercised a real Gateway/model turn: HTTP accepted a
human message, Perception admitted it to Kazusa's brain, `send_message` created an
attributed canonical reply, and SSE plus the frontend's history endpoint returned
that reply. A second send through the frontend observed the agent's actual
`set_typing` true/false events followed by its canonical reply. Real execution
exposed closed async scopes, non-JSON undefined state,
incorrect context session identity and a built-in `message` bypass that mocks had
missed. See the messaging and Perception references for their ownership fixes.
This is not full browser rendering or multi-agent group validation.

For a complete acceptance pass, use disposable state and two agents:

1. Send a unique direct message. Check one canonical record, one recipient copy,
   `__openclaw` sender, Perception intake and actual native adoption separately.
2. Send to a human/two-agent group. Check two projections/intakes and distinct
   replies in the same conversation; there must be no human agent session.
3. Freeze time and paginate multiple pages, then reconnect SSE. Check sequence
   order and convergence to the same message IDs without duplicates or gaps.
4. Remove/re-add the human around an agent-only message. The absence stays hidden;
   old received history remains readable, and removal prevents sends/management.
5. Restart after acceptance but before all projections. Retry the same submission
   ID and verify one canonical record, unchanged audience/time and no duplicate copy.
6. Observe composing true, send/cancel/end false, and no typing for an ignored input.
   Exercise busy steering and queued attention separately from idle wake.

Record message/chat IDs, audience, simulation time, copy receipts and adoption;
never log credentials. Gracefully stop the test Gateway when finished.
