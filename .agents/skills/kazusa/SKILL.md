---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw (`@openrp-ai/kazusa` and
  `@kazusa/plugin`). Always trigger this skill whenever designing, building,
  modifying, debugging, or testing anything in Kazusa—including the unified
  `@kazusa/plugin` (`src/clock`, `src/taskman`, `src/context-engine`,
  `src/perception`), stimulus admission and routing, `agent:ID:brain` steer
  routing, `start_task`/`delay_task` leases, `clock_*` tools and Gateway RPCs,
  the 3-Tier `assemble()` retrieval pipeline, World Wiki (`shared/wiki/`) vs.
  Personal Wiki (`workspaces/ID/wiki/`) schemas, desire homeostasis math, or
  OpenClaw session and cron integrations, even if the user only mentions a
  single module, tool, or character file.
---

# Kazusa: Real-time multi-agent AI world simulator framework for role-play

**Perception implementation status:** Uses OpenClaw's native Decision Model API
(`api.runtime.decisions.evaluate`). Attention policy is in-process. Brain
handoff uses the public channel reply dispatcher and native turn-adoption
lifecycle. Detached host work owns the coalescing wait and full dispatch
lifetime. Do not use deprecated `queueAgentHarnessMessage` or private controller
imports. See `references/perception.md` for routing and transport constraints.

Kazusa is a real-time, multi-agent society simulation framework built natively
on the **OpenClaw** runtime. Each character is an autonomous OpenClaw agent with
distinct personality traits, homeostatic desires, short- and long-term goals,
subjective beliefs, and an objective physical location in a shared world.

## 1. Core Architectural Pillars

Classical generative-agent simulations poll every agent on a fixed clock tick,
causing runaway token costs, multi-session race conditions, and ungrounded
hallucinations. Kazusa addresses these through six architectural pillars:

1. **Single-Threaded Consciousness (`agent:<id>:brain` with `steer` Queue)**:
   - All admitted stimuli for a character target one OpenClaw execution session:
     `agent:<id>:brain`. Chat and task sessions are ledgers, not competing
     places to think.
   - Steering makes an admitted distraction visible inside an ongoing turn. It
     invites reassessment, not automatic abandonment of earlier intentions.
2. **Variable-Horizon Task Leases (Never Idle, Zero Fixed Polling)**:
   - Characters never poll on fixed intervals and are never idle (sleep,
     waiting, and reflection are tasks too).
   - Agents commit to a task of duration $D$ via `start_task` (or adjust it via
     `delay_task`), which replaces any prior lease, logs the transition to
     `agent:<id>:tasks`, and schedules a wake-up at $t_{\text{now}} + D$ unless
     pre-empted by an interrupt.
   - **Configurable Task Categories (`taskman.categories`)**: Every task
     declares a category `type` chosen from the allowed categories configured in
     Taskman (defaulting to `sleeping`, `traveling`, `eating`, `studying`,
     `working`, `socializing`, `having fun`, `miscellaneous`), paired with
     freeform natural language in `description`. Categories are injected
     dynamically into the `start_task` tool schema so worlds/games can define
     their own genres without code modifications. Future specialized subsystems
     (e.g. perception sleep gates or spatial travel routing) will map through
     their own configurable settings rather than hardcoding category strings.
   - **Top-Down Human Simulation Planning**: Avoids rigid Stanford-style "plan
     the day at dawn" routines. Real humans plan opportunistically through
     temporal orientation on waking/cold-start, anchoring to institutional fixed
     blocks (`[HARD_BLOCK]`), recording social promises made in conversation
     into day plans, and rolling reassessments at natural task completion
     boundaries.
3. **Dual-Wiki Epistemology (Objective World vs. Subjective Beliefs)**:
   - **World Wiki (`shared/wiki/`)** stores objective canon facts (locations,
     connections, character roster, public rules).
   - **Personal Wiki (`workspaces/<agent_id>/wiki/`)** stores what a specific
     character believes, remembers, and feels about peers, places, and concepts,
     preventing omniscient context leakage.
4. **Tool-Grounded State ("Prose is Never a Fact")**:
   - Narrative prose never mutates simulation state. Locations, task leases, and
     social transitions change only when the agent invokes deterministic tools
     (`start_task`, `delay_task`, `send_message`).
5. **Deterministic Math in Code, Semantics in the LLM**:
   - Code executes in `< 1 ms` at zero token cost: virtual formula clock
     ($\text{sim\_time} + \Delta t \times \text{speed}$), passive desire decay,
     sleep detection, presence tracking, and encounter probability rolls.
   - The LLM handles qualitative reasoning: deducing goals from feelings,
     estimating travel durations from terrain descriptions, imagining candidate
     actions, and evaluating emotional outcomes.
6. **Perception (Stimulus Routing & Attention Admission with Jev Decision
   Model)**:
   - Evaluates incoming stimuli (chats, physical events, world notices) through
     a fast System 1 Decision Model (`api.runtime.decisions.evaluate` via
     TypeSafe AI's Jev) against the agent's current task/activity and cognitive
     state.
   - **Universal Gate (Both Idle & Busy)**: Characters are never truly inactive
     (sleep, reading, or waiting are active tasks). Even when the brain is idle,
     Jev evaluates stimuli against the ongoing activity to avoid unnecessary and
     expensive LLM brain turns (e.g. ignoring casual banter while sleeping).
   - **Multi-Stimulus Coalescing & Emergent Salience**: Rapid-fire messages
     coalesce within a short window (`coalesceWindowMs = 500ms`). Jev evaluates
     the combined bundle with recent channel context so two individually minor
     stimuli can combine into an urgent `STEER` or `WAKE` without context
     severance.
   - **Consolidated Queue Draining (Single-Turn Batch Presentation)**: When a
     busy brain finishes its active turn, all queued stimuli are drained in a
     single consolidated wake turn (not one-by-one ping-pong turns). The agent
     synthesizes and addresses all accumulated events in one holistic LLM
     thought.
   - **Context-Aware Semantic Admission (Zero Numeric Thresholds)**: When the
     brain is busy, Jev classifies stimuli categorically across `STEER`,
     `QUEUE_NEXT`, `DEFER`, and `IGNORE` (or `WAKE` vs. `DEFER` vs. `IGNORE`
     when idle). Decision policies rely on contextual understanding of the
     ongoing activity description and relationship stakes, not arbitrary
     probability or wake thresholds.
   - **Human Reply Timing ("checking the phone")**: An idle `WAKE` also carries
     a `response_latency` score that delays the wake by simulated minutes.
     `DEFER` holds a stimulus until the current activity ends (deadline or
     replacement). Whichever comes first makes the character "pick up the
     phone", and every approved waiting stimulus is delivered in that one turn.
     Task check-ins therefore arrive bundled with the messages a character set
     aside while busy. See `references/perception.md` §12.
   - **Paced, Interruptible Speech**: `send_message` takes an array of chat
     bubbles and delivers them one by one at simulated typing speed while the
     tool call stays open. A `STEER` aborts the rest; unsent bubbles never reach
     any ledger, and the tool result tells the brain what was and was not said.
     See `references/messaging.md` (Paced speech).
   - **No Generative Rewriting & Zero Prompt Injections**: Jev is a
     non-generative classifier with categorical choices. Admitted stimuli pass
     through verbatim to the `:brain` session without hallucination or
     distortion.
   - **Single-Threaded Consciousness Without Ghost Sessions**: Eliminates the
     previous `agent:<id>:perception` chat session. Perception runs entirely
     in-process as a fast (<100ms) decision gate.
   - Owns this routing policy, not Taskman or the context engine. Task deadlines
     bypass classification and wait while the brain is busy. A pending deadline
     means “check the current SQLite-backed task”, not “finish an old task”.

## 2. State Storage & Repository Layout

High-frequency machine state is strictly separated from qualitative Markdown
files so `<workspace>/MEMORY.md` never suffers from mechanical diff churn or
file-parsing overhead.

| State Category                        | Canonical Storage Location                                                                  | Purpose & Mutation Rule                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------------ | :------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine Working State**             | `api.runtime.state.openKeyedStore` (`"clock"`, `"tasks"`, `"perception"`)                   | Virtual clock state/speed, active task leases, and Perception's records: one inbox/custody state per character (key `<agentId>`) plus one entry per attention decision (key `<agentId>:decision:<uuid>`), uncapped. Each store belongs to one module: tasks to Taskman, stimuli and attention to Perception. Never store in Markdown.                                                                                                              |
| **Cognitive Brain Queue**             | OpenClaw Session `agent:<id>:brain`                                                         | Single-threaded execution; Perception gates explicitly submitted stimuli before wake/steer.                                                                                                                                                                                                                                                                                                                                                        |
| **Chat Membership & Canonical Store** | `api.runtime.state.openKeyedStore` (`"chats"`, `"messaging"`)                               | Retained stores tracking group chat memberships, titles, and canonical messages with frozen audiences. Serves human chat queries and cursor pagination via Gateway HTTP endpoints (`/kazusa/messages`, `/kazusa/chats`, `/kazusa/send`). Session-orchestration tools are denied (`tools.deny: ["group:sessions", "message"]`).                                                                                                                     |
| **Stream Ledgers**                    | OpenClaw Sessions `agent:<id>:tasks`, `agent:<id>:chat:direct:*`, `agent:<id>:chat:group:*` | Append-only chronological transcripts of settled/started tasks, thoughts, and chats. Maintained for AI agents to feed the 3-Tier Context Engine. Egress tools (`send_message`, `start_task`) project copies to agent ledgers. Supports agent peers and human players (`user:` prefix). `before_dispatch` claims messages (`{ handled: true }`) to prevent raw auto-replies and forwards stimuli to Perception without performing duplicate writes. |
| **Agent Identity & Memory**           | `workspaces/<id>/{SOUL,IDENTITY,MEMORY}.md` + `memory/`                                     | Static voice/values (`SOUL.md`), bio & YAML desire parameters (`IDENTITY.md`), qualitative reflections (`MEMORY.md`), and vector-indexed daily summaries (`memory/YYYY-MM-DD.md`). **Strict Invariant**: Never place `AGENTS.md` in character workspaces; behavior is injected purely via Skills.                                                                                                                                                  |
| **Objective Canon**                   | `shared/wiki/`                                                                              | Ground-truth places, character roster (including human player `user:sensei`), world rules, and compiled global reports.                                                                                                                                                                                                                                                                                                                            |
| **Subjective Beliefs**                | `workspaces/<id>/wiki/`                                                                     | Agent-specific impressions of peers/places, personal theories, syntheses, and contradiction reports.                                                                                                                                                                                                                                                                                                                                               |

### Directory Map (`apps/kazusa/`)

```text
apps/kazusa/
├── openclaw.json                       # Framework config (plugins.load.paths: ["./plugins/kazusa"])
├── openclaw.local.json                 # Git-ignored local dev/test agent overlay
├── package.json                        # @openrp-ai/kazusa
├── plugins/kazusa/                     # @kazusa/plugin — unified zero-build TypeScript plugin
│   ├── openclaw.plugin.json
│   ├── package.json                    # "openclaw": { "extensions": ["./src/index.ts"] }
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Composes Clock, Taskman, ContextEngine, Perception
│       ├── ledger.ts                   # appendLedgerEntry: strict appends to the :tasks ledger
│       ├── realtime.ts                 # Process-shared SSE broadcaster + journal seq
│       ├── timeline/                   # GET /kazusa/timeline from ledger metadata
│       ├── clock/                      # Formula clock, "clock" store, clock_* tools & RPCs
│       ├── taskman/                    # "tasks" leases, :tasks ledger, cron projection, tools
│       ├── context-engine/             # Brain context, skill resolution, assemble()
│       ├── perception/                 # Text ingress, retained inbox, bounded attention admission
│       └── messaging/                  # Chat discovery/management, attributed ledgers, retained delivery
├── shared/
│   ├── wiki/                           # WORLD WIKI (objective truth)
│   │   ├── entities/{places,characters}/<id>.md
│   │   ├── concepts/<topic>.md
│   │   └── reports/
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral workflows resolved via kazusa:skill markers
├── workspaces/<agent_id>/              # Per-agent workspace
│   ├── SOUL.md | IDENTITY.md | MEMORY.md
│   ├── memory/YYYY-MM-DD.md
│   └── wiki/                           # PERSONAL WIKI (subjective beliefs)
│       ├── entities/{characters,places}/<id>.md
│       ├── concepts/<id>.md | syntheses/ | reports/
└── .state/                             # Underlying SQLite backing for OpenClaw keyed stores

```

## 3. Unified Plugin Architecture & Module Boundaries

`plugins/kazusa` (`@kazusa/plugin`) is a single native OpenClaw plugin whose
`src/index.ts` composes `Clock`, `Taskman`, `ContextEngine`, and `Perception`
directly in process. Do not introduce cross-plugin service boundaries or split
these into separate packages. Keep their internal responsibilities decoupled;
callbacks and direct references connect these modules in process.

- **One world per process, many registrations**: OpenClaw can call `register()`
  more than once in one Gateway process. An agent turn without an unambiguous
  owner gets its own plugin instance beside the one serving HTTP, and tools,
  hooks and the context engine run on that instance. Anything that must be one
  value per world lives in a process-wide cell on `globalThis` under a
  `Symbol.for("kazusa.*")` key: the clock cell (`clock/register.ts`), the
  realtime broadcaster and journal sequence (`realtime.ts`), and Taskman's cron
  automation hook (`taskman/register.ts`). Per-instance state silently diverges:
  before this, a client pause reached only the HTTP instance, while the turn
  instance kept time running and persisted over it. Listeners on the shared
  clock are shared too, so register process-wide side effects once
  (`forwardClockOnce`). Durable state still belongs in keyed stores.

### 3.1 `src/clock/` — Virtual Formula Clock

- Owns forward-only simulation time ($\text{sim\_time} + \Delta t \times
  \text{speed}$), lifecycle persistence in the `"clock"` keyed store, agent
  tools (`clock_now`, `clock_set_speed`, `clock_advance`), and matching
  `clock.*` Gateway RPCs.
- Every `Clock` built by `registerClock` wraps the same process-wide `ClockCell`
  (time, anchor, speed, init promise, listeners). A speed change or advance from
  any instance is seen by all, and each change notifies every listener (Taskman
  cron reconciliation, client SSE) exactly once.

### 3.2 `src/taskman/` — Lease State, Ledger & Wake Scheduling

- **Lease & Ledger Ownership**: Manages active leases in the `"tasks"` keyed
  store and exposes `start_task` and `delay_task`. Every task transition or
  delay appends to the native `agent:<agentId>:tasks` session transcript and
  publishes its update. Because `enqueueSystemEvent` is transient, never use it
  as a task ledger.
- **Configurable Task Categories (`taskman.categories`)**: Categories default to
  `TASK_CATEGORIES` (`sleeping`, `traveling`, `eating`, `studying`, `working`,
  `socializing`, `having fun`, `miscellaneous`) but can be customized per-world
  via `plugins.entries.kazusa.config.taskman.categories`. Taskman binds these
  directly to the `start_task` tool parameter schema
  (`enum: config.categories`), allowing different simulation genres to supply
  custom activity palettes to the LLM.
- **Future Special Handling Decoupling**: Subsystems that require special
  handling (e.g. sleep attention suppression or location transit routing) are
  not hardcoded to fixed strings in Taskman. When implemented, those subsystems
  will expose their own configuration mapping (e.g. designating which configured
  category maps to sleep or travel).
- **Fixed Categories vs. Freeform Semantics (Hybrid Architecture)**: Pure
  freeform strings prevent deterministic TypeScript logic from branching on
  critical mechanics (attention gate suppression, transit arrivals, desire
  settlement). Pure rigid enums destroy character expressiveness. Kazusa
  standardizes on configurable category `type` + rich natural language
  `description`.
- **Desire Homeostasis Integration**: Task execution directly interfaces with
  the homeostatic desire math (`references/mathematics.md`). Settlement ratio
  $\text{Ratio} = \text{clamp}(\Delta t_{\text{elapsed}} /
  t_{\text{planned\_min}},\; 0.0,\; 1.0)$ scales desire rewards $\Delta
  D_{\text{awarded}} = \Delta D_{\text{target}} \times \text{Ratio}$ upon
  completion.
- **In-Character Monologues**: Transitions and delays may include a brief
  in-character `monologue`. Format it as an italic blockquote directly below the
  factual summary inside the same ledger message text rather than extending
  OpenClaw's message schema.
- **Ledger Writes (`src/ledger.ts`)**: All ledger rows go through
  `appendLedgerEntry`, which uses
  `appendSessionTranscriptMessageByIdentityStrict`. Task tools run inside the
  character's `:brain` turn; the lenient
  `appendSessionTranscriptMessageByIdentity` inherits that turn's writer claim
  and OpenClaw refuses it for another session ("session writer claim changed
  before transcript persistence"). Every row carries its journal event as
  `__openclaw.kazusa = { kind, payload }`; the text is narrative only and is
  never parsed back.
- **Simulation Timestamps**: Set native ledger `message.timestamp` from the
  clock at the task mutation. Delay entries include the new due time and
  remaining simulated minutes. Keep OpenClaw bookkeeping timestamps real-time.
- **Cron Automation Projection**: Projects each agent's next wake into OpenClaw
  automations using `declarationKey = agentId` so normal task transitions
  atomically upsert a single dashboard-visible one-shot `agentTurn` job.
  **Design Decision (Ephemeral Isolated Session)**: Taskman configures
  `sessionTarget: "isolated"` (ephemeral `cron:<jobId>` session) rather than
  `session:agent:<id>:brain`. In OpenClaw, `withCronSessionPreparation` enforces
  single-threaded session lane serialization (`beginSessionWorkAdmission` on
  `resolveSessionLane(sessionKey)`). If a cron job directly targets `:brain`, an
  active (busy thinking) brain run holds the lane lock, forcing the cron job to
  block in OpenClaw's lane queue. This locks out `before_agent_reply`,
  preventing Perception from receiving the deadline stimulus mid-flight and
  eliminating the possibility of mid-turn steering. By targeting `"isolated"`,
  the cron job runs in its own uncontended lane, immediately fires
  `before_agent_reply` on schedule, passes the deadline stimulus to
  `perception.receive()`, and claims the turn with `{ handled: true }`.
  Returning `{ handled: true }` silences LLM inference (zero tokens used),
  avoids writing any prompt/reply to transcripts, and marks the cron run as
  `status: "ok"` (success) on OpenClaw's dashboard, after which OpenClaw deletes
  the ephemeral session (`deleteAfterRun: true`).
- **Cron Ownership**: Other plugins declare cron jobs too (memory-core's
  dreaming promotion). Taskman only lists, clears or reconciles jobs whose
  `declarationKey` is a configured character id. Pausing (speed 0) clears those
  jobs; resuming recomputes each `at` from the lease's remaining sim time.
- **Cross-Instance Automation**: Only the instance that receives
  `cron_reconciled` can write jobs, but task tools and cron wakes may run on
  another instance. The `synchronize` hook and the readiness flag that gates
  cron runs live in the process-wide `kazusa.taskman.automation` cell.
- In the target design, Perception owns brain admission and selects cognitive
  skill markers. The existing Taskman wake marker is transitional.
- **Strict Boundary**: Taskman schedules wakes and owns task state/ledgers. It
  never injects prompts, reads skill files, or interprets interrupts.

### 3.3 `src/context-engine/` — Brain Context & `assemble()` Pipeline

- Registered through `api.registerContextEngine("kazusa", ...)`. Perception
  explicitly targets `:brain`; OpenClaw 2026.10.5 ignores `session.mainKey` and
  keeps its default session at `main`. Never run character turns in chat
  ledgers.
- Reuses native workspace injection for `SOUL.md`, `IDENTITY.md`, and
  `MEMORY.md`; `memory/` remains tool-recalled archive, subject to OpenClaw's
  native new/reset note-loading behavior.
- **Strict Invariant: No `AGENTS.md` in Character Workspaces**: Never create or
  copy `AGENTS.md` into character workspaces (`workspaces/<agent_id>/`). In
  OpenClaw, any `AGENTS.md` in an agent's workspace is statically injected into
  the system prompt. In Kazusa, all behavioral logic (time conventions, task
  lifecycle, interrupt protocols) is injected dynamically by the Context Engine
  via shared skills (`shared/skills/*`). Placing `AGENTS.md` in character
  workspaces causes duplicate instructions, prompt drift across characters, and
  token bloat. Character workspaces must strictly contain only identity
  (`SOUL.md`, `IDENTITY.md`), qualitative memory (`MEMORY.md`), and subjective
  wiki entries (`wiki/`).
- Retains recent complete brain turns (`recentBrainHistory`, bounded by
  `brainMaxTokens`, default 2000; can be set to 0 for pure ledger runs) to
  guarantee tool-call/result atomicity & error recovery, in-flight steering
  boundary preservation, and reasoning continuity.
- Uses native `readSessionTranscriptCatalogPage` in newest-first pages of up to
  200 items, stopping at the simulation-time cutoff. There is no total message
  count cap. Skip undated/invalid timestamps; empty pages with a continuation
  cursor must still be followed. Ledger writers preserve simulation-time order.
- **Ledger writer contract**: Every task/chat message must contain one text
  block with all readable content and media summaries. `send_message` writes
  native `__openclaw.senderId`, `senderName`, and `senderIdentity` metadata; see
  [the messaging contract](references/messaging.md). The context engine uses
  only sender metadata projected from `__openclaw` for every chat record. Self
  requires an explicit ID matching the owner; missing attribution is unknown,
  including outgoing records omitted by the installed catalog. Task records need
  no speaker. Never infer authorship from text prefixes, display names, or peer
  keys.
- Derive ownership only from the native assembly `params.sessionKey`. The
  harness may omit `runtimeContext.sessionTarget`; it is not an alternate
  source. `register.ts` owns SDK lifecycle, configuration, and session I/O.
  `context-engine.ts` owns selection, rendering, and skill expansion.
- Adds current simulation time and reads task and chat records from the last 24
  simulated hours (configurable upward), selects whole messages newest-first
  under one shared remaining token budget, then groups them by session with
  chronological, timestamped entries. Accept native catalog display clipping;
  add no source quotas or further per-message clipping, incognito feature, or
  external-channel adapter.
- **Multi-Media Architecture**: Grounded preflight + on-demand inspection. Media
  processors receive the Context Engine's assembled background (location,
  identities, conversation thread) to produce situation-aware descriptions.
  Ledgers record only lightweight `[Image: <summary>]` text blocks with
  attachment references, excluding heavy raw image tokens from context assembly.
  Agents re-inspect images on demand via `view_image(path, prompt)`.
- The brain reads Taskman's retained `tasks` store for a pinned current-activity
  view: type, description, start, check-in, and ongoing/overdue status. Exclude
  internal task UUIDs and metadata. This survives a start outside the ledger
  window/budget. The ledger still supplies experiences and monologues; no
  separate `:thoughts`. Later successful tool results supersede the snapshot.
- Relevant personal-wiki impressions are injected as dated beliefs, not world
  facts (default maximum three cards / 1200 tokens). Only the owner's wiki is
  eligible. Reuse native workspace bootstrap; keep generic assistant outreach
  instructions and stale machine-state tables out of character workspace files.
- Uses OpenClaw's native token estimator. Proactive compaction is disabled;
  manual/overflow recovery still delegates to OpenClaw. Windowing is not
  summarization and never deletes ledger history.
- Chat keys distinguish `agent:<id>:chat:direct:<peer-id>` from
  `agent:<id>:chat:group:<group-id>`. Read only the owner's streams.
- **State-selected character skills**: Always inject the full body of
  `context-conventions`, plus `task-lifecycle` when the current task is absent
  or overdue, otherwise `task-interrupt`. Use the existing SkillLoader
  precedence and strip YAML frontmatter. Incoming text or `[kazusa:skill=...]`
  markers must never select system instructions. Perception no longer emits
  those markers.
- **Chats awaiting your reply**: The situation message lists, from Messaging's
  canonical store, current chats where someone spoke after the character (within
  the short-term window) and the brain was shown that message: address, sender,
  and time only. It is the "glance at the phone" view for conversations read but
  never answered. Ignored stimuli never appear; the skills decide whether
  answering is natural.
- Keep delivery hashes in operational run/adoption/provider metadata, not
  `MessageSid`; the latter is rendered into prompts. Use the native
  `AmbientTranscriptBody` for clean room-event text while preserving the host's
  queue/adoption behavior. Native room-event social hints still exist; the skill
  explains the Kazusa interpretation and `send_message` tool.
- Messaging owns retained `"chats"` membership and permanent canonical
  `"messaging"` records. Native agent chat sessions are private projections;
  human clients read canonical history filtered by frozen message audience.
  `send_message` targets an address or starts a chat with its first message;
  `list_chats` discovers memberships; any current member can `manage_chat`.
  Humans have no brain or native agent session. Shared acceptance fans human
  messages out to agent members before Perception. The `apps/web` prototype and
  Gateway HTTP adapter still need contract/authentication alignment. Native
  WebChat group posting is unsupported. Raw session tools remain denied via
  `tools.deny: ["group:sessions", "message"]`. See
  [messaging](references/messaging.md) for canonical storage and
  [the client reference](references/client.md) for UI requirements, current gaps
  and live acceptance tests.
- Behavioral instructions belong in skills, not TypeScript prompt constants.
- See [context-engine conventions](references/context_engine.md) for budgets,
  timestamps, SDK lifecycle requirements, and the messaging contract.
- Future additions extend this into the **3-Tier Retrieval Pipeline**:

1. **Tier 1 (Eager Spatial Perception & Sensory Shock)**: Diffs the current
   location in `shared/wiki/` against the agent's `workspaces/<id>/wiki/` to
   surface environmental changes or unfamiliar surroundings.
2. **Tier 2 (Eager Social Salience & Compact Contact Roster)**:
   - **Eager Compact Contact Roster (Working Cache)**: Automatically discovers
     the latest $K$ unique individuals (configurable `contactRosterLimit`,
     default 20) with whom the agent has recently exchanged messages (sent or
     received) or interacted. Pulls each peer's relationship card from the
     character's Personal Wiki
     (`workspaces/<id>/wiki/entities/characters/<peer_id>.md`) to extract
     display name, handle, relationship type, short summary, and direct chat
     address (`- Name (@handle, relation): summary [chat:direct:<peer_id>]`). At
     ~150 tokens for 20 contacts, this eliminates redundant
     `wiki_search`/`list_chats` tool round-trips, grounds spontaneous social
     agency, and prevents hallucinations.
   - **Active Peer Impressions**: Eagerly injects full `## Quick Impression`
     blocks from the Personal Wiki for the active interlocutor in direct chats
     and Top-3 salient co-present characters in groups/crowds. Deep historical
     interaction logs remain lazy (Tier 3 cognitive retrieval).
3. **Tier 3 (Session Stream Tails)**: Merges recent entries from the agent's
   `:tasks`, `:chat:direct:*`, and `:chat:group:*` streams (implemented). The
   decision model's context reads `:tasks` too, so every ledger row reaches a
   prompt. Observer-only records (attention decisions) live in keyed stores,
   never in a ledger.

### 3.4 `src/perception/` — Stimulus Router & Attention Gate (Jev Decision Model)

- See [Perception](references/perception.md) for detailed mathematical rubrics,
  admission interleavings, state compilation, and test specifications.
- **Decision Model Paradigm**: Uses OpenClaw's native
  `api.runtime.decisions.evaluate({ state, questions }, { agentId, purpose: "perception" })`
  powered by TypeSafe AI's Jev (`typesafe/jev-latest`, local Kev, or ONNX).
  Evaluates categorical choices in a single forward pass (~70–200ms latency,
  zero generated output tokens, $0.042/1M input tokens).
- **Universal Gate (Both Idle & Busy Brains)**: All incoming stimuli are
  evaluated against the character's active task and cognitive state:
  - **Idle Brain**: Characters are never truly inactive (sleep, reading, and
    waiting are active tasks, defaulting to "resting" when unset). Jev evaluates
    `["WAKE", "DEFER", "IGNORE"]` plus a `response_latency` score in one batch.
    `WAKE` waits the scored simulated delay (zero wakes now); `DEFER` waits for
    the current task to end. Bundles where all items were already approved
    during a busy turn bypass Jev re-evaluation once ready. `IGNORE` is final:
    the stimulus stays in the subjective ledger but never reaches the brain or
    its "Chats awaiting your reply" view. Anything the character might still
    answer later is `DEFER`.
  - **Busy Brain**: Evaluates `["STEER", "QUEUE_NEXT", "DEFER", "IGNORE"]`
    semantically based on the current activity, relationship stakes, and any
    speech the character is still delivering. High-focus or delicate tasks (e.g.
    studying, deep sleep, serious conversations) naturally demand high
    situational urgency to steer, while routine stimuli are queued for the next
    turn (`QUEUE_NEXT`), set aside until the activity ends (`DEFER`), or
    ignored. `STEER` also interrupts an in-progress `send_message`.
- **Multi-Stimulus Coalescing & Emergent Salience**: Rapid arrivals coalesce
  within a brief window (`coalesceWindowMs = 500ms`). Jev evaluates the incoming
  bundle against recent channel context and currently pending items so two
  individually minor stimuli can combine into an urgent `STEER` or `WAKE`
  without context severance.
- **Consolidated Queue Draining (Single-Turn Batch Presentation)**: When the
  active brain turn completes, all eligible pending stimuli are drained in a
  single consolidated wake turn (not one-by-one ping-pong turns). All drained
  IDs are admitted simultaneously; the agent addresses all accumulated events in
  a single coherent response.
- **Verbatim Stimulus Preservation**: Because Jev is a non-generative
  classifier, admitted stimuli pass through to `:brain` verbatim. There is zero
  risk of prompt injection hijacking routing, and no generative hallucination or
  lossy summarization.
- **Zero Second-Character Sessions**: Completely eliminates the previous
  `agent:<id>:perception` chat session, tool stripping (`toolsAllow: []`), and
  JSON string parsing. Perception operates purely in-process.
- **Decision Recording**: Every attention decision is recorded with its question
  (`wake_decision` / `attention_allocation`), action, `source` (`model`,
  `automatic` for deadlines and idle check-ins on an idle brain, or `fallback`
  with a `note` when the model was unavailable or gave an unusable answer),
  model `choice`, `latencyScore`, `delayMs`, stimulus ids, task id, and sim and
  wall time (`PerceptionDecisionRecord`). It goes to:
  - its own entry in the `"perception"` store, key `<agentId>:decision:<uuid>`,
    uncapped and restart-safe. This is the one durable copy; the timeline reads
    it through `perception.decisions()`. `recover()` and anything else walking
    that store must skip decision keys.
  - one `Perception <agent>: …` Gateway log line;
  - an `attention.decided` SSE journal event (`onDecision` in
    `perception/register.ts`).

  A failed write is logged and never fails routing. Decisions stay out of
  ledgers on purpose: every ledger is replayed into a prompt, and attention
  mechanics ("noticed after 94s", "queued, not steered") must never reach a
  character or the decision model. They stay out of the `"tasks"` store because
  stimuli aren't tasks. Before this existed, a delayed approval lived only on
  the pending item's `until` and vanished on delivery, so "why didn't they
  reply?" was unanswerable. `entries()` loads the whole namespace, so add
  pruning or a per-character read if history grows large.

- **Sim-Time Envelope on Brain Input**: At the LLM boundary OpenClaw prefixes
  every user turn with its wall-clock write time in the host timezone (e.g.
  `[Tue 2026-10-27 21:26 EDT]`), unless the text already opens with a
  `[... YYYY-MM-DD HH:mm` stamp. `formatDeliveryMessage` therefore leads every
  delivery with `[<sim time>]`, so characters never see the operator's clock.
- **Known Gap: Shutdown Mid-Turn**: An adopted delivery leaves custody once the
  brain turn starts. If the Gateway stops during that turn, the stimulus is
  neither answered nor re-queued (interrupted handoffs are deliberately not
  replayed blindly). Recovering it needs an explicit design.
- **In-Process Lifecycle & Ingress Hooks**:
  - `before_dispatch` claiming hook returns `{ handled: true }` and notifies
    Perception. Chat producers own prior ledger persistence, not this hook.
  - Brain busy/idle tracking uses native in-process agent events
    (`api.agent.events.registerAgentEventSubscription({ streams: ["lifecycle"] })`).
  - Brain handoff uses `dispatchReplyWithBufferedBlockDispatcher` through the
    internal Kazusa channel, targeting `agent:<id>:brain`. Routine input uses
    `room_event`; urgent steering uses `user_request`. Only `onAdopted` confirms
    adoption. Detached scopes cover delayed work and the full model/tool run.
- **Task Deadlines as Stimuli & Attention Floor**: Task deadlines enter
  Perception as first-class `Stimulus` objects via ephemeral cron interception
  (`before_agent_reply` claiming with `{ handled: true }`). Because characters
  are never taskless and the passage of time cannot be undone, task deadlines
  possess an **attention floor of `QUEUE_NEXT`**. Jev can allocate `STEER` (for
  urgent hazards) or `QUEUE_NEXT` (for routine completion), but task deadlines
  can never be dropped into `IGNORE`. When idle, deadlines unconditionally
  trigger `WAKE`. When a character preempts or transitions tasks early
  (`start_task`), Taskman atomically replaces the cron projection; any racing
  stale deadline stimulus is validated against `task.id` and dropped silently.
  (Future roadmap: if an LLM concludes a turn without calling
  `start_task`/`delay_task`, Taskman will project a unified 60-real-second
  taskless/overdue state scan rather than forcing an OOC synthetic resting
  lease). This scan is proposed, not implemented; see
  [the concrete design](../../../apps/kazusa/docs/brain-context.md).
- Context assembly only reads and renders admitted context; it never reroutes
  input or drains a queue. Admission must happen before a run starts, not in
  `assemble()`, which may be retried.

## 4. Engineering & Zero-Build Conventions

- **Zero-Build Jiti Execution**: OpenClaw runs `./src/index.ts` directly via its
  runtime TypeScript loader. Never add a build step (`tsc --build`, `tsup`, or
  `npm run build` artifacts); code edits take effect on the next event.
- **Zod Boundary Validation & Strict Types**: Validate all plugin configurations
  (scoped under `plugins.entries.kazusa.config.<module>.*`) and Gateway RPC
  inputs with **Zod** schemas. Never use `any`, hand-rolled `typeof` chains, or
  unverified `as unknown as T` casts.
- **Zero Legacy Tech Debt & Greenfield Purity**: Kazusa is an unreleased,
  greenfield framework. Never introduce transitional backward-compatibility
  shims, dual-type unions (`T | LegacyT`), deprecated migration fallbacks, or
  temporary adapter branches. When an architectural contract or signature
  evolves (e.g., standardizing on `DecisionBatch`), cleanly refactor all types,
  call sites, and unit tests in one atomic step. Never hedge or leave obsolete
  interfaces or runtime checks in the codebase.
- **OpenClaw Runtime Pitfalls (verified live on 2026.10.5, 2026-10-27)**:
  - The plugin may be registered several times per process (§3).
  - Inside an agent run, write another session's transcript only with the strict
    append (§3.2).
  - `readSessionTranscriptCatalogPage` items have no `__openclaw`/raw field.
    Read structured ledger metadata with
    `readVisibleSessionTranscriptMessageEntries` (needs the session id from the
    session entry). Catalog pages remain right for chat text and sender
    attribution.
  - User turns are stamped with host wall time at the LLM boundary (§3.4).
  - A bare `catch {}` around SDK reads hides these failures. Log a warning.
- **Atomic Markdown Writes**: When mutating Markdown files, always write to a
  temporary file in the same directory and atomically `rename(tmp, target)` so
  concurrent reads never see partial writes.
- **Colocated Vitest Suite**: Place unit tests alongside their implementation in
  `src/**/*.test.ts` (keep test-only in-memory stores inside `*.test.ts`, never
  in production files). Verify changes with:
- `npm test` (`vitest run`)
- `npm run typecheck` (`tsc --noEmit`)
- Targeted `prettier --check` and `eslint` for touched files. Root `format` and
  `lint` scripts rewrite files; avoid them in a dirty worktree.

## 5. Reference Documentation

Load these reference files on demand when working on their specific subsystem:

- `references/file_schemas.md` — Read when implementing Markdown/YAML parsers or
  creating/modifying `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, World Wiki, or
  Personal Wiki files.
- `references/mathematics.md` — Read when implementing or tuning passive desire
  decay, circadian $M_{\text{tod}}$ multipliers, squared urgency rankings, sleep
  debt, task settlement ratios, or encounter probability rolls.
- `references/primitives_mapping.md` — Read when wiring OpenClaw sessions
  (`:brain`, `:tasks`, `:chat:*`), cron automations, `assemble()` hooks, or
  `memory-core` vector indexing.
- `references/context_engine.md` — Read when modifying context assembly, session
  naming, memory layers, budgets, or future chat producers.
- `references/messaging.md` — Read when implementing `send_message`, sender
  attribution, or direct/group ledger writes.
- `references/client.md` — Read when reviewing or building `apps/web`, human
  chat APIs, authentication, live updates, or end-to-end messaging tests. The
  client's overall architecture (shell, views, registries, read-model routes,
  world journal) lives in the separate `kazusa-client` skill.
- `references/perception.md` — Read when designing stimulus routing, busy-brain
  admission, steering, deferred attention, or moving task wakes behind the gate.
- `references/phases_and_testing.md` — Read when planning milestone deliverables
  across Phases 0–5 or designing integration test suites.
