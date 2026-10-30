# Kazusa Client ↔ Backend Contract

## Contents

1. Why the client doesn't use the native Gateway
2. Transport and conventions
3. Routes: existing and proposed
4. Live updates (SSE)
5. Frontmatter and structured-data rules
6. The world journal
7. Capability matrix
8. Backend work, in priority order

---

## 1. Why the client doesn't use the native Gateway

OpenClaw's Gateway exposes a typed WebSocket control plane: `sessions.list`,
`sessions.preview`, `chat.history`, `cron.*`, `agent`/`chat`/`presence`/
`tick`/`cron` events, plus plugin-registered RPCs such as our `clock.*`. It
would technically be possible to build the UI on it. We don't, for these
reasons:

| Concern      | Native Gateway WS                                                                                                                                                     | Plugin read model (`/kazusa/*`)                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Auth         | Device identity, signed `connect.challenge`, pairing. An authenticated client is trusted at **full Gateway scope** (agents, config, exec). Can't go to a browser.     | `registerHttpRoute({ auth: "plugin" })`, with the token held server-side by the Next proxy. Narrow, read-mostly surface.                 |
| Data meaning | Native transcripts are agents' **private prose projections** (OpenClaw roles, catalog clipping, prose monologues). `client.md` already forbids `chat.history` for UI. | Canonical stores: `messaging`, `chats`, `tasks`, `clock`, and the new `journal`, with sim time, sender attribution and frozen audiences. |
| Events       | Not replayed. `agent` streams are raw model deltas. That's noisy at 300 agents and leaks model internals.                                                             | Curated, sequenced events with gap recovery through history endpoints.                                                                   |
| Coupling     | Tied to OpenClaw protocol and schema versions.                                                                                                                        | Our Zod contracts in `@kazusa/client`.                                                                                                   |

The plugin runs **inside** the Gateway process and has in-process SDK access:
keyed stores, `readSessionTranscriptCatalogPage`, cron, agent lifecycle event
subscriptions, and Decision Model results. So "reading OpenClaw via the Gateway"
means the plugin reads it and adapts it into our contract. If an operator signal
is ever needed in the UI (health, the next cron wake), add a plugin route that
reads it in-process. Don't open a WebSocket from the proxy.

The existing `clock.*` Gateway RPCs stay for CLI and operator use. The client
gets the same `Clock` module through HTTP (§3).

## 2. Transport and conventions

- Requests flow browser → `app/kazusa/[...path]/route.ts` (fixed `ROUTES`
  allowlist; same-origin check on POST; `OPENCLAW_GATEWAY_TOKEN` forwarded
  server-side) → plugin route.
- **Every new route is added to the proxy allowlist in the same change.**
- Plugin routes use `match: "exact"` with **query parameters, not path
  parameters** (`/kazusa/character?id=alice`). This fits the exact-match
  registration and the proxy's fixed map.
- Each plugin module that serves UI owns an `http.ts` adapter. Domain logic
  stays in the module (`messaging.ts`, `taskman.ts`, …). The adapter only
  validates input with Zod, calls the domain, and returns `satisfies`-typed wire
  objects.
- Caller identity comes from plugin config (`user`), never from request bodies.
  This follows the existing single-player rule.
- **Time:** wire timestamps are epoch-ms **simulation** time. Internal ISO
  strings (`ActiveTask.startedAt`) are converted in the adapter.
- **Actions:** a `ChatMessage` may carry `type: "action"` (absent means speech):
  something the sender does where they are, in third person without their name,
  with plain `text`. Render it as narration ("Kazusa sets the textbook on the
  desk"), not a bubble. System lines (joining, leaving, renaming) arrive the
  same way.
- **Ordering and paging:** server sequences (`sequence` for messages, `seq` for
  journal) with `nextCursor` + `hasMore`. Never page by timestamp or page
  length.
- **Errors:** `{ error: string }` with an appropriate status, matching the
  existing `sendJson` behavior.
- **Greenfield rule:** when a contract changes (for example `/kazusa/agents` →
  `/kazusa/characters`), refactor the plugin, the schemas, the proxy and the web
  app in one atomic change. No aliases or dual shapes.

## 3. Routes

### Existing (messaging; authoritative spec in `kazusa/references/client.md`)

| Route                                                                   | Notes for this client                             |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `GET /kazusa/agents`                                                    | **Replaced** by `/kazusa/characters` in Phase 1   |
| `GET /kazusa/chats`                                                     | Player's chats ("Mine")                           |
| `GET /kazusa/messages`                                                  | Player-audience history                           |
| `POST /kazusa/send`, `POST /kazusa/chats/manage`, `POST /kazusa/typing` | Unchanged                                         |
| `GET /kazusa/events`                                                    | Gains `?scope=`; `player` is the current behavior |

### Proposed: Phase 1 (unblocks the first draft)

| Route                            | Response (schemas in `@kazusa/client`)                                                                                                                                                                  | Backed by                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /kazusa/world`              | `{ user, serverNow, clock: { simTime, speed, updatedAt }, capabilities: Record<Domain, "live" \| "unavailable">, world: { title, accent?, summary? } }`                                                 | `clock` store; plugin config; `shared/wiki/world.md` frontmatter                                   |
| `POST /kazusa/clock`             | Body: `{ action: "set_speed", speed }` \| `{ action: "advance", minutes }`. Returns the new `clock`                                                                                                     | Same `Clock` module as the `clock.*` RPCs                                                          |
| `GET /kazusa/characters`         | `{ characters: CharacterSummary[] }`. All characters in one response at ≤ ~1000; add paging only once measured                                                                                          | Roster config + World Wiki character frontmatter + `tasks` store + Perception brain state + typing |
| `GET /kazusa/character?id=`      | `CharacterDetail` = summary + profile frontmatter fields + `bodyMarkdown`                                                                                                                               | IDENTITY.md + World Wiki card (frontmatter + body)                                                 |
| `GET /kazusa/timeline`           | Params: `before?` \| `after?`, `limit`, `actors?`, `kinds?`, `chats?`. Returns `{ events: JournalEvent[], nextCursor?, hasMore }` (`before` pages newest-first; `after` returns ascending for catch-up) | `journal` store                                                                                    |
| `GET /kazusa/timeline/histogram` | Params: `from`, `to`, `bucketMinutes`, same filters. Returns `{ buckets: { start, counts: Record<JournalKind, number> }[] }`                                                                            | `journal` store                                                                                    |
| `GET /kazusa/observe/chats`      | Params: `query?`, `member?`. Returns all canonical chats with members and latest preview                                                                                                                | `chats` + `messaging` stores, audience-agnostic                                                    |
| `GET /kazusa/observe/messages`   | Same shape as `/kazusa/messages`, any chat                                                                                                                                                              | `messaging` store                                                                                  |

### Built: desires

| Route                 | Response                                                                                                                                                                   | Backed by                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /kazusa/desires` | `DesiresResponse = { config: { states, initial, catalog }, records: Record<characterId, DesireRecord> }`. Characters with no record are still in `initial` and don't drain | `"desires"` store + `desires` plugin config (`src/desires/http.ts`) |

Records are the plugin's closed form (`anchorAt`, `levels`, `effects?`,
`drain`), never precomputed levels: a level is a pure function of the record and
sim time, so the client recomputes it from `useSimNow()` and nothing polls. A
record changes only on `start_task`/`delay_task` and `desires.configure`, each
pushed as SSE `desires`. The timeline route skips reading chat ledgers when
`kinds` excludes `message.sent` (the client default).

### Built: models

| Route                   | Request / response                                                                                                                                                                                                                                                               | Backed by                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /kazusa/models`    | Optional `agentId` and `refresh=1` query parameters. Returns `{ agentId?, overrides?: { model?, thinking? }, current?, configured?, thinking?, models, providers }`. `current` and `thinking` are effective choices; `configured` is the native primary for the requested scope. `models` omits rows with `supportsTools: false`, so a stored `current` may be absent from it. | Gateway `models.list` (`view: "default"`, requested agent or first agent for world requests), config shortlists, and `"models"` store |
| `POST /kazusa/model`    | `{ agentId?, ref: string \| null }` → `{ agentId?, current? }`. `null` clears this scope's choice. 404 for unknown agents or refs outside the target catalog; 409 for unavailable models.                                                                                        | `"models"` store, key `world` or `agent:<id>`: `{ model?, thinking? }`                                                                |
| `POST /kazusa/thinking` | `{ agentId?, level: ThinkingLevel \| null }` → `{ agentId?, thinking? }`. `null` clears this scope's choice. 404 for unknown agents; 409 for a level the effective model lacks, or an effective model outside the target catalog.                                                | Same record                                                                                                                           |

All three routes register with `auth: "gateway"` (the Gateway checks the bearer
token) because they dispatch `models.list` as the caller through
`gateway-method-runtime`, which the manifest allows with
`contracts.gatewayMethodDispatch: ["authenticated-request"]`.

Each field resolves independently: **agent choice → world choice → native
OpenClaw default**. Omit `agentId` to read or change world defaults. An agent
record contains only explicit choices; clearing either field inherits the world
value again, and clearing a world field returns to native defaults. `overrides`
appears only on agent reads so a future UI can distinguish inherited values from
explicit choices. For example:

```text
GET  /kazusa/models?agentId=airi-kurimura
POST /kazusa/model     { "agentId": "airi-kurimura", "ref": "venice/qwen3-235b-a22b-thinking-2507" }
POST /kazusa/thinking  { "agentId": "airi-kurimura", "level": "high" }
POST /kazusa/model     { "agentId": "airi-kurimura", "ref": null }
```

Agent requests use that agent's catalog, credentials, and model policy, and
merge its configured shortlist with the world shortlist. Writes are serialized
per scope across plugin registrations so concurrent model/thinking updates do
not overwrite each other. The existing Next proxy already forwards these paths,
query parameters, and bodies. The frontend sets world defaults in Settings →
Models and per-agent choices in the inspector's Model section, which reads
`overrides` to tell inherited values from explicit ones.

The catalog is discovered by the provider plugins (OpenRouter and Venice list
their models themselves), so the world config only pins a shortlist in
`agents.defaults.models` (shown as "Pinned", with its `alias` as the display
name). OpenClaw only prepares the catalogs of providers that a config model ref
names, so each provider needs at least one pinned model before its other models
appear (`venice/zai-org-glm-4.7` pins Venice). `decisionModel` is not part of
this route. The domain is live-only: there is no mock catalog, and the picker
hides without a Gateway.

#### OpenClaw limitation: the pick does not live in `openclaw.json`

OpenClaw reloads every plugin when a configured model ref changes. Its reload
planner treats `agents.defaults.model.primary` (and `agents.entries.<id>.model`)
as provider-auth relevant, so a switch retires and re-registers Kazusa, the
provider plugins and the rest, each waiting out a 5 s drain, twice: about 10 s
of stalled requests and brief 401s, measured 2026-10-29. `/model -g`,
`/model -a`, `openclaw models set` and `config.patch` all write the same paths.
Per-session overrides (`/model -s`, `sessions.patch`) avoid the reload but would
have to follow every session of every character.

So Kazusa keeps the choices in its own `"models"` store and applies them to the
one session where character turns reach a model, `agent:<id>:brain` (Perception
handles cron wakes and other sessions without a model call):

- Model: the `before_model_resolve` hook resolves the brain session's agent and
  returns its effective `providerOverride` / `modelOverride`
  (`src/models/register.ts`). It needs
  `plugins.entries.kazusa.hooks.allowConversationAccess`.
- Reasoning: OpenClaw has no per-turn hook for it, so the brain channel writes
  the target agent's effective `thinkingLevel` onto its brain session before
  each dispatch (`registerBrainChannel`). Without a world or agent choice,
  clearing the session field restores OpenClaw's configured/provider default. A
  level the model lacks is remapped by OpenClaw to its nearest one.

Consequences to design around:

- OpenClaw's own surfaces (`openclaw models status`, the Control UI default)
  still show `configured`. Settings → Models names it when they differ.
- A turn already running finishes on the old model and level.
- `openclaw.json` is never written by these routes. Editing a native primary
  only affects agents without an agent or world model choice.
- Each `ModelOption` carries the model's own `thinkingLevels` (OpenClaw's
  `/think` ladder minus `ultra`, a harness mode rather than an effort; provider
  labels: Z.AI calls `low` "on") and its `thinkingDefault`. Do not set
  `agents.defaults.thinkingDefault`: `models.list` folds it into every model's
  `thinkingDefault` and caches that until a refresh.

`CharacterSummary` (draft):

```ts
{
  id: string;                         // "alice" | "user:you" | NPC character_id
  name: string;
  kind: "agent" | "player" | "npc";   // agent = has workspace + roster entry
  isSystemAgent?: boolean;             // current native system-agent selection; render as ADMIN, never infer from identity prose
  avatarUrl?: string;                 // IDENTITY.md avatarUrl, else /kazusa/avatar?id=… for <workspace>/avatar.<ext>
  occupation?: string;
  affiliation?: string;
  aliases: string[];
  status?: {                          // absent for npc
    task?: { id: string; type: string; description: string; startedAt: number; endAt: number };
    brain: "idle" | "thinking" | "unknown";
    composingIn: string[];            // chatIds
    queued: number;                   // pending admitted stimuli
  };
}
```

**Observer gating.** `/kazusa/observe/*` and `scope=observer` are gated by
plugin config `observer.enabled`. It defaults to `true`, because this is a local
single-player client and observation is the product. Real authorization stays
deferred, as in `client.md`. Observed reads never mutate membership and never
emit typing.

## 4. Live updates (SSE)

`GET /kazusa/events?scope=player|observer`:

| Event                        | Scope                                    | Payload                                                    | Client handling                                                                                          |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `connected`                  | both                                     | `{ typing[], journalSeq?, statuses? }`                     | Seed live store. If `journalSeq` > last seen, catch up with `timeline?after=`                            |
| `message`, `typing`, `chats` | player: audience-filtered; observer: all | Existing shapes                                            | Existing handlers                                                                                        |
| `desires`                    | observer                                 | `{ characterId, record: DesireRecord }` (full replacement) | `desireStore.set` unless the held record has a later `anchorAt`; `connected` refetches `/kazusa/desires` |
| `journal`                    | observer                                 | `JournalEvent` (with `seq`)                                | Append to the timeline tail; detect gaps → catch up                                                      |
| `status`                     | observer                                 | `{ characterId, status }` (full replacement for that id)   | Live store per-id update                                                                                 |
| `clock`                      | both                                     | `{ simTime, speed, updatedAt }`                            | Re-anchor interpolation                                                                                  |

Rules (the same as messaging):

- Subscribe before taking the snapshot, and buffer until the snapshot is sent.
- Heartbeats keep the connection open. Slow consumers are closed and recover
  through history.
- SSE is notification only. The journal and stores are the durable record.
- Transient states (thinking, composing, queued) are `status` deltas and are
  **never** journaled.

## 5. Frontmatter and structured-data rules

**In the plugin:**

1. Use one shared reader for all Markdown documents, for example
   `src/markdown/frontmatter.ts`:
   `readFrontmatter<T>(text, schema: z.ZodType<T>) → { data: T; body: string }`.
   - Build it on a maintained front-matter parser rather than hand-written
     delimiter regexes.
   - Validate with a Zod schema per document type (`IdentityFrontmatter`,
     `WorldCharacterFrontmatter`, `PlaceFrontmatter`, `RelationshipFrontmatter`,
     `BeliefFrontmatter`, `WorldFrontmatter`).
   - Today the delimiter regex is duplicated in `messaging/register.ts` (×2),
     `context-engine/skill-loader.ts` and `context-engine/decision-sources.ts`.
     Consolidate these when the first read-model route lands.
2. HTTP adapters return frontmatter fields as typed JSON, and the body only as
   `bodyMarkdown` to be rendered verbatim.
3. Never extract data from bodies: no regex over `## Quick Impression`,
   `**Open Threads**`, `[HARD_BLOCK]` lines, or the `:tasks` ledger's italic
   monologue blockquote.

**In the web app:**

- The client renders `bodyMarkdown` with a Markdown renderer and never mines it.
- It never reads workspace or wiki files.

**Schema-change proposals.** The UI will need these fields. Each one moves
body-only data into frontmatter. When a proposal is implemented, update
`kazusa/references/file_schemas.md` in the same change.

| Document                     | Proposed frontmatter                                                                                                                     | Needed by                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `shared/wiki/world.md` (new) | `title`, `summary`, optional `accent` (hex)                                                                                              | Top bar, theming (D1)      |
| World Wiki places            | `parent` (place_id or region id) for the tree; optional `map: { x, y }` for the future map                                               | World view tree, later map |
| World Wiki characters        | Already structured (`name`, `aliases`, `affiliation`, `role`, `personality_traits`, `is_simulated_agent`). Add optional `avatar`         | Roster, profile            |
| Relationship cards           | `quick_impression: string`, `open_threads: string[]` (currently body-only)                                                               | Social view (later)        |
| `MEMORY.md`                  | Frontmatter `goals: string[]`, `plan: { kind: "hard_block" \| "soft_goal"; start?; end?; place?; text }[]` (currently tagged body lines) | Agenda section (later)     |
| Task transitions             | No file change. Monologue, summary and reason are structured fields in journal payloads (§6)                                             | Timeline thought lines     |

## 6. The world journal

A new plugin module, `src/journal/`. It is an append-only, retained keyed store
that serves as the single sequenced, structured, cross-agent log of what
happened.

**Why it's needed.** Ledgers (`:tasks`, `:chat:*`) are per-agent private prose
projections, built for context assembly. The Timeline needs one structured,
sequenced, filterable log across every character. This is the same split as
messaging: a canonical record for clients, with projections for agents.

**Record (draft):**

```ts
{
  seq: number;              // monotonic, assigned at append
  simTime: number;          // epoch ms, from the clock at the mutation
  kind: JournalKind;        // discriminant
  actors: string[];         // character ids involved (filter key)
  chatId?: string;
  placeId?: string;
  payload: ...;             // kind-specific, Zod discriminated union on `kind`
}
```

**First-draft kinds and producers:**

| Kind                                                     | Producer (same code path that writes the ledger)             | Payload                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `task.started`                                           | Taskman `start_task`                                         | `{ taskId, type, description, duration, endAt, summary?, monologue?, replacedTaskId? }`      |
| `task.delayed`                                           | Taskman `delay_task`                                         | `{ taskId, additionalMinutes, endAt, reason?, monologue? }`                                  |
| `message.sent`                                           | Messaging canonical acceptance                               | `{ messageId, sequence, senderId, preview }`, with `actors` = sender + audience              |
| `chat.created` / `chat.renamed` / `chat.members_changed` | Messaging chat management                                    | `{ title?, added?, removed? }`                                                               |
| `clock.changed`                                          | Clock `set_speed` / `advance`                                | `{ speed?, advancedMinutes? }`                                                               |
| `attention.decided`                                      | Perception, per decision (entry in the `"perception"` store) | `{ question, action, source, delayMs, choice?, latencyScore?, note?, stimulusIds, taskId? }` |

**Planned kinds** (registered when their backends exist): `location.moved`,
`encounter`, `relationship.changed`, `reflection.written`.

**Where history comes from:** `GET /kazusa/timeline` reads `:tasks` rows'
structured `__openclaw.kazusa = { kind, payload }` with
`readVisibleSessionTranscriptMessageEntries` (the catalog reader drops
`__openclaw`), chat rows from the catalog, and attention decisions from the
`"perception"` store. Ledger text is never parsed (D4). Rows without metadata
are skipped.

**Invariants:**

- The journal is observation-only. No simulation code reads it. The current task
  still comes from `tasks`, and messages from `messaging`. This keeps it from
  becoming a second source of truth.
- Append happens in the same operation that commits the canonical change. It's
  either written with it or retried with the same idempotency key, so the
  journal never shows something the store doesn't have.
- Producers emit structured fields only. The journal never stores rendered prose
  to be parsed later.
- An index from actor to seq supports `actors=` filtering without full scans.
  Measure before adding more indexes, as with messaging history.
- Retention is permanent, like canonical messages.

## 7. Capability matrix (today → first draft)

| Domain                       | Today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Needed for live                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `clock`                      | Store + RPCs built; no HTTP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `/kazusa/world`, `POST /kazusa/clock`, SSE `clock`                       |
| `characters`                 | `/kazusa/agents` (id, name, avatar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `/kazusa/characters`, `/kazusa/character`                                |
| `status`                     | `tasks` store built; typing built; brain busy/idle tracked inside Perception (drafted)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Perception exposes read-only brain state + change callback; SSE `status` |
| `chats`                      | Built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                        |
| `observe`                    | Audience-filtered only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `/kazusa/observe/*`, `scope=observer`                                    |
| `timeline`                   | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/journal/` + routes + SSE `journal`                                  |
| `places`                     | Built: `GET /kazusa/places` (tree order, `PlacesResponse`); wired to the World tree, place inspector and palette                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                        |
| `location`                   | Built: `GET /kazusa/locations` (closed-form `LocationRecord`s, homes included); SSE `location` (`{ characterId, record }`, one per record write); `location.noticed` journal events (observer's `:tasks` ledger, plus SSE `journal`); trips in `task.started` payloads (`where`, `from`, `arriveAt`, `usualMinutes`); in-person conversations are chats of type `huddle` (`chat:huddle:<id>`), many per place; `POST /kazusa/move` (`MovePayload` → `MoveResponse`) moves the player straight to a place; `SendPayload.aloud` speaks face to face | Client wiring (in-person thread style)                                   |
| `desires`                    | Built: `/kazusa/desires`, SSE `desires`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                        |
| `models`                     | Built: `GET /kazusa/models`, `POST /kazusa/model`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                        |
| `relationships`, `attention` | Schema only / drafted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | See the roadmap                                                          |

Until a domain is live, the client serves it from the mock source when mocks are
enabled, with visible `Mock` tags (D10).

## 8. Backend work, in priority order

1. `/kazusa/world` + `POST /kazusa/clock` + SSE `clock`. Smallest change,
   unblocks the top bar.
2. Shared `readFrontmatter` + `/kazusa/characters` + `/kazusa/character`,
   replacing `/kazusa/agents` atomically.
3. Perception brain-state exposure + SSE `status`.
4. `src/journal/` with Taskman, Messaging and Clock producers, plus the
   `/kazusa/timeline` routes.
5. `/kazusa/observe/*` + `scope=observer`.
6. `shared/wiki/world.md` and the place `parent` frontmatter, then
   `/kazusa/places` for the World tree.
