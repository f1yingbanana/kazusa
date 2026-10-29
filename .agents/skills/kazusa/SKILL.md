---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw (`@openrp-ai/kazusa` and
  `@kazusa/plugin`). Always trigger this skill whenever designing, building,
  modifying, debugging, or testing anything in Kazusa—including the unified
  `@kazusa/plugin` (`src/clock`, `src/taskman`, `src/desires`,
  `src/context-engine`, `src/perception`), stimulus admission and routing,
  `agent:ID:brain` steer routing, `start_task`/`delay_task` leases, `clock_*`
  tools and Gateway RPCs, the 3-Tier `assemble()` retrieval pipeline, World Wiki
  (`shared/wiki/`) vs. Personal Wiki (`workspaces/ID/wiki/`) schemas, desire
  states and task effects, or OpenClaw session and cron integrations, even if
  the user only mentions a single module, tool, or character file.
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

## 0. How We Build: Simulation → Player → Prompt

This is the design method for every Kazusa feature. Work through the three
perspectives in order, and do not start from the prompt or the code:

1. **Top down: the simulation.** How would a real human do this? What do they
   notice, when do they act, what do they remember, forget, or get wrong? Then
   decide how to simulate that faithfully: what is deterministic code (time,
   levels, scheduling) and what is the character's judgment.
2. **The player.** What behavior is fun to discover? Which moments make a
   character feel alive (a remembered detail days later, a changed opinion, a
   late reply with a reason), and how are they surfaced: in chat, on the
   timeline, in the client, or only by asking?
3. **Bottom up: the agent's prompt.** What exactly does the character see on
   this turn? Make it concise and efficient: in-world wording instead of system
   jargon, nothing the character does not need right now, stable text first for
   caching, and work moved out of the prompt into code wherever judgment is not
   needed.

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
     their own genres without code modifications. Specialized subsystems map
     categories through their own settings rather than hardcoding category
     strings (Location's `location.travelCategories`; a future perception sleep
     gate).
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

| State Category                        | Canonical Storage Location                                                                           | Purpose & Mutation Rule                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine Working State**             | `api.runtime.state.openKeyedStore` (`"clock"`, `"tasks"`, `"desires"`, `"location"`, `"perception"`) | Virtual clock state/speed, active task leases, desire anchors, positions and trips (one record per character or player), and Perception's records: one inbox/custody state per character (key `<agentId>`) plus one entry per attention decision (key `<agentId>:decision:<uuid>`), uncapped. Each store belongs to one module: tasks to Taskman, stimuli and attention to Perception. Never store in Markdown.                                    |
| **Cognitive Brain Queue**             | OpenClaw Session `agent:<id>:brain`                                                                  | Single-threaded execution; Perception gates explicitly submitted stimuli before wake/steer.                                                                                                                                                                                                                                                                                                                                                        |
| **Chat Membership & Canonical Store** | `api.runtime.state.openKeyedStore` (`"chats"`, `"messaging"`)                                        | Retained stores tracking group chat memberships, titles, and canonical messages with frozen audiences. Serves human chat queries and cursor pagination via Gateway HTTP endpoints (`/kazusa/messages`, `/kazusa/chats`, `/kazusa/send`). Session-orchestration tools are denied (`tools.deny: ["group:sessions", "message"]`).                                                                                                                     |
| **Stream Ledgers**                    | OpenClaw Sessions `agent:<id>:tasks`, `agent:<id>:chat:direct:*`, `agent:<id>:chat:group:*`          | Append-only chronological transcripts of settled/started tasks, thoughts, and chats. Maintained for AI agents to feed the 3-Tier Context Engine. Egress tools (`send_message`, `start_task`) project copies to agent ledgers. Supports agent peers and human players (`user:` prefix). `before_dispatch` claims messages (`{ handled: true }`) to prevent raw auto-replies and forwards stimuli to Perception without performing duplicate writes. |
| **Agent Identity & Memory**           | `workspaces/<id>/{SOUL,IDENTITY,MEMORY}.md` + `memory/`                                              | Static voice/values (`SOUL.md`), bio (`IDENTITY.md`), qualitative reflections (`MEMORY.md`), and vector-indexed daily summaries (`memory/YYYY-MM-DD.md`). **Strict Invariant**: Never place `AGENTS.md` in character workspaces; behavior is injected purely via Skills.                                                                                                                                                                           |
| **Objective Canon**                   | `shared/wiki/`                                                                                       | Ground-truth places, character roster (including human player `user:sensei`), world rules, and compiled global reports.                                                                                                                                                                                                                                                                                                                            |
| **Subjective Beliefs**                | `workspaces/<id>/wiki/`                                                                              | Agent-specific impressions of peers/places, personal theories, syntheses, and contradiction reports.                                                                                                                                                                                                                                                                                                                                               |

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
│       ├── index.ts                    # Composes Clock, Taskman, Desires, Location, ContextEngine, Perception
│       ├── ledger.ts                   # appendLedgerEntry: strict appends to the :tasks ledger
│       ├── realtime.ts                 # Process-shared SSE broadcaster + journal seq
│       ├── timeline/                   # GET /kazusa/timeline from ledger metadata
│       ├── clock/                      # Formula clock, "clock" store, clock_* tools & RPCs
│       ├── taskman/                    # "tasks" leases, :tasks ledger, cron projection, tools
│       ├── desires/                    # "desires" anchors, task `afterwards`, desires.* RPCs, GET /kazusa/desires
│       ├── location/                   # World map, "location" store, task `where`, location.* RPCs, GET /kazusa/places|locations
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
`src/index.ts` composes `Clock`, `Taskman`, `Desires`, `Location`,
`ContextEngine`, and `Perception` directly in process. Do not introduce
cross-plugin service boundaries or split these into separate packages. Keep
their internal responsibilities decoupled; callbacks and direct references
connect these modules in process.

- **One world per process, many registrations**: OpenClaw can call `register()`
  more than once in one Gateway process. An agent turn without an unambiguous
  owner gets its own plugin instance beside the one serving HTTP, and tools,
  hooks and the context engine run on that instance. Anything that must be one
  value per world lives in a process-wide cell on `globalThis` under a
  `Symbol.for("kazusa.*")` key: the clock cell (`clock/register.ts`), the
  realtime broadcaster and journal sequence (`realtime.ts`), Taskman's cron
  automation hook (`taskman/register.ts`), the idle supervisor's tick
  (`taskman/supervisor.ts`), Messaging's conversations, active deliveries and
  queue (`messaging/register.ts`), and Perception's per-character lock
  (`perception/register.ts`). Each is injected, so tests get their own.
  Duplicate tool results, a second idle check-in, and huddles that kept a
  character after they left were all one instance not seeing the other's state.
  Per-instance state silently diverges: before this, a client pause reached only
  the HTTP instance, while the turn instance kept time running and persisted
  over it. Listeners on the shared clock are shared too, so register
  process-wide side effects once (`forwardClockOnce`). Durable state still
  belongs in keyed stores.
- **Timers keep their creator's async context**: a `setTimeout` armed inside a
  tool call runs later "inside" that call (OpenClaw then treats its work as the
  tool's). Wrap callbacks in a context captured at module load
  (`AsyncLocalStorage.snapshot()`, Perception's `outsideCallers`).
- **A paused clock freezes the world.** Perception judges and hands over nothing
  while the clock is stopped (`drainState` returns early; `resume()` runs on the
  clock's restart, from a listener owned by the first registration: a per-turn
  registration has no decision runtime). `start_task`, `delay_task`,
  `send_message` and `manage_chat` wait in `untilRunning` before acting, and the
  typing gap between bubbles waits in `sleepSim` instead of sending the rest at
  once. A turn already generating finishes its model call and then holds at its
  next tool call. Live, before this, a paused four-person meeting ran a hundred
  bubbles at one sim instant. **Stopping while paused**: `shutdownSignal()`
  (`src/shutdown.ts`, one per process) aborts on SIGINT/SIGTERM or a handoff
  refused with `GatewayDrainingError`; every frozen wait lets go, so the turn
  finishes at the paused moment (bubbles said at once) and the Gateway drains
  cleanly instead of timing out a held turn into a tombstone.
- **One speaker, one thing at a time.** A character's sends queue one after
  another (parallel tool calls in one turn included); `interrupt()` stops the
  one being said and any waiting. Live, a text started alongside a speech
  aborted the speech before a word was said.
- **Shared files resolve through `sharedDir(name)`** (`src/shared-dir.ts`):
  `shared/<name>` under the Gateway's cwd first, then relative to the source. A
  module-relative path alone breaks when OpenClaw loads a captured copy of the
  plugin (live, Location found no places and disabled itself).

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
- **Special Handling Decoupling**: Subsystems that require special handling
  (location transit, a future sleep attention gate) are not hardcoded to fixed
  strings in Taskman. Each exposes its own configuration mapping
  (`location.travelCategories` designates which categories move a character).
- **Fixed Categories vs. Freeform Semantics (Hybrid Architecture)**: Pure
  freeform strings prevent deterministic TypeScript logic from branching on
  critical mechanics (attention gate suppression, transit arrivals, desire
  settlement). Pure rigid enums destroy character expressiveness. Kazusa
  standardizes on configurable category `type` + rich natural language
  `description`.
- **Task Extensions (Desires, Location)**: Taskman knows nothing about desires
  or places. Other modules pass `TaskExtension`s to `registerTaskman`; each adds
  parameters to the task tools (a tool requires only the extension properties it
  takes) and a `prepare` hook that runs with the raw tool arguments after the
  new lease is computed. `prepare` validates without writing and returns
  `{ note?, payload?, commit }`. A thrown error fails the tool call with its
  message; only when every extension accepted do the commits run, then the lease
  is written. Notes are appended to the ledger row and tool result ("Traveling
  from … to …"); payloads merge into the row's journal payload. Desires uses
  this for `afterwards` (§3.5), Location for `where` (§3.6). `prepare` may also
  return `checkInAt`: the earliest one brings the lease's end forward (walking
  over checks in on arrival), and every `commit(task)` receives the lease as
  written. There is exactly one cron job per character; one-shot jobs delete
  themselves after running, so a job can never reschedule itself. `start_task`,
  `delay_task` and `send_message` are `catalogMode: "direct-only"`: behind Tool
  Search their parameter descriptions are invisible and models route calls
  through a generic `tool_call`.
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
  requires an explicit ID matching the owner; missing attribution is unknown.
  The native catalog projects sender identity only for `user`-role rows, so
  every chat-ledger row, the owner's own included, is written as `user`. Task
  records need no speaker. Never infer authorship from text prefixes, display
  names, or peer keys.
- Derive ownership only from the native assembly `params.sessionKey`. The
  harness may omit `runtimeContext.sessionTarget`; it is not an alternate
  source. `register.ts` owns SDK lifecycle, configuration, and session I/O.
  `context-engine.ts` owns selection, rendering, and skill expansion.
- Leads the situation message with the current simulation time; it never goes in
  `systemPromptAddition`, which is ordered stable-first (conventions, memory
  guidance, then the state-selected skill) so its prefix survives across turns
  for prompt caching. Reads task and chat records from the last 24 simulated
  hours (configurable upward), selects whole messages newest-first under one
  shared remaining token budget, then groups them by session with chronological,
  timestamped entries. Accept native catalog display clipping; add no source
  quotas or further per-message clipping, incognito feature, or external-channel
  adapter.
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
  or overdue, otherwise `task-interrupt`, plus `in-person` (last, so the stable
  prefix survives people coming and going) while someone else is where the
  character is (Location's `inCompany`); it offers speaking aloud and texting
  alike and leaves the choice to the character. Use the existing SkillLoader
  precedence and strip YAML frontmatter. Incoming text or `[kazusa:skill=...]`
  markers must never select system instructions. Perception no longer emits
  those markers.
- **How you feel**: The situation message carries Desires' one-line state
  summary (§3.5), supplied through a `feelings` provider like `awaitingReplies`.
  The context engine renders it verbatim.
- **Where you are**: Location's `whereabouts(agentId, at, evidence)` provider
  (§3.6) supplies the current place with its id and one-line `summary`, what is
  visible from it (**Around you**), the whole description when the character has
  no card for it yet, and the places on the character's mind (**Places you
  know**), each with usual travel times; or the trip in progress. `evidence` is
  the turn's prompt, so places it names come to mind. Rendered verbatim after
  Current activity. Never the whole map.
- **People are "Name `id`"** everywhere a character reads them (deliveries,
  Chats awaiting your reply, background records, Location's lines;
  `personLabel`): the name to read and say, the id to address. Names come from
  `personName` (the character's own identity, the player's config), never a
  transcript's display label, which is not trusted.
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
  **Huddles** (`kind: "huddle"`, `chat:huddle:<id>`, with a `placeId`) are
  face-to-face conversations, many at a place at once. `send_message` with
  `members` and `aloud: true` speaks to people at the sender's place (Messaging
  asks Location's `placeOf`): it speaking aloud brings the people addressed, and
  anyone they are talking with, into the speaker's huddle (groups merge; a
  merged huddle keeps `mergedInto` so replies to its old address land in the new
  one), or joins theirs, or starts one. Speaking into a huddle's address at its
  place walks over to it and leaves the speaker's other one. Walking away
  (`leavePlace`, called by Location) leaves every huddle there with a line to
  those still in it (moving to another huddle posts
  `*moves to another conversation*`); with fewer than two left it dissolves.
  Every `manage_chat` change is posted to the group in the actor's voice
  (`*adds Natsu to the chat*`), to those going before they go and those coming
  once in. A bubble may be an **action** (`{ text, type: "action" }`, third
  person, no name), kept only face to face and dropped silently in text chats;
  stored plain with its `type` for the client, read by characters as `*text*`.
  System lines are actions. `messaging.maxBubbles` (default 9) caps a send.
  `manage_chat` refuses huddles; speaking to one you are not at fails in-world.
  Humans have no brain or native agent session. Shared acceptance fans human
  messages out to agent members before Perception. The `apps/web` prototype and
  Gateway HTTP adapter still need contract/authentication alignment. Native
  WebChat group posting is unsupported. Raw session tools remain denied via
  `tools.deny: ["group:sessions", "message"]` (see Character Tool Surface in
  §4). See [messaging](references/messaging.md) for canonical storage and
  [the client reference](references/client.md) for UI requirements, current gaps
  and live acceptance tests.
- **What the model saw**: transcripts hold turns but not the assembled situation
  message. After each `assemble()` the context engine keeps the last 20 per
  character (`{ simTime, situation, inPerson, estimatedTokens }`, retained store
  `"context"`), served at `GET /kazusa/context?id=<agentId>`
  (`context-engine/http.ts`, `ContextResponseSchema`). Read it before guessing
  why a character did something.
- Behavioral instructions belong in skills, not TypeScript prompt constants.
- See [context-engine conventions](references/context_engine.md) for budgets,
  timestamps, SDK lifecycle requirements, and the messaging contract.
- Future additions extend this into the **3-Tier Retrieval Pipeline**:

1. **Tier 1 (Eager Spatial Perception & Sensory Shock)**: **Where you are**
   (implemented) gives the current place and nearby travel times. Still to come:
   diffing the current place in `shared/wiki/` against the agent's
   `workspaces/<id>/wiki/` to surface environmental changes or unfamiliar
   surroundings.
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

- **Foreseen stimuli**: a stimulus whose `timestamp` is still in the future has
  not happened: it is held in the retained inbox, never judged or delivered
  early, and the readiness timer wakes at its moment (no cron, no new timer).
  One marked `foreseen` is then confirmed once by its producer through the
  `confirm` dependency, which returns the stimulus as it actually happens (new
  text) or `undefined` to drop it unseen; Location uses this for sightings
  (§3.6). Stimuli from a `:tasks` session that are neither deadlines nor
  check-ins are delivered under "Seen around you" ("Seen while thinking" when
  steering), not as chats.
- **Sim-Time Envelope on Brain Input**: At the LLM boundary OpenClaw prefixes
  every user message with its `message.timestamp` rendered in
  `agents.defaults.userTimezone` (host zone when unset), unless the text already
  opens with a `[... YYYY-MM-DD HH:mm` stamp. Envelopes cannot be disabled.
  `formatDeliveryMessage` and the situation message lead with `[<sim time>]`;
  other assembled context carries sim timestamps, and the world config sets
  `userTimezone: "UTC"` so those stamps match `formatSimTime` (sim time is UTC).
  Without it, sim 20:36 rendered as `16:36 EDT`.
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
- **Restart recovery**: stopping the Gateway mid-turn can make OpenClaw
  tombstone the interrupted `:brain` session (`mainRestartRecovery.tombstone`),
  after which it refuses every later run there. The brain channel clears that
  recovery state (`abortedLastRun`, `restartRecoveryRuns`,
  `mainRestartRecovery`, the same fields a completed run clears) and hands the
  input over again once. On startup `recover()` reconciles each delivery still
  in custody against the brain transcript (`adoptedByBrain`): if the message is
  there the turn ran, so its stimuli are marked processed and never replayed;
  otherwise they go back to pending. Quarantine (`stopped`) is only the fallback
  when that check is unavailable.
- Follow-up batches drain only items whose `timestamp` has come (`<= now`); a
  foreseen sighting is never pulled into an earlier turn.
- Context assembly only reads and renders admitted context; it never reroutes
  input or drains a queue. Admission must happen before a run starts, not in
  `assemble()`, which may be retried.

### 3.5 `src/desires/` — Narrative Desires

- Full model and config in [mathematics](references/mathematics.md) §1.
- **State words, never numbers, at the LLM boundary**: config maps levels
  `0..100` to ordered states (default `depleted`/`low`/`fine`/`full`, each with
  a `min` and a target `level`). The brain reads one `### How you feel` line
  (`energy: fine · satiety: low · …`) and declares a required
  `afterwards: { <desire>: "<current>→<afterwards>" }` on `start_task` and
  `delay_task`, listing only desires the activity changes. Same-state pairs
  (`fine→fine`) are in the enum and silently dropped: models list them anyway,
  and refusing them cost a whole retry. Code uses only the afterwards state and
  turns it into a linear rate toward that state's `level` over the planned
  duration.
- **Catalog**: `desires.catalog: [{ name, description, drain }]`, per world,
  defaulting to `energy`, `satiety`, `social`, `stimulation`, `composure`,
  `purpose`, `expression`. `description` is the only semantic contract and is
  delivered once, as prose in the `start_task` `afterwards` description (no
  per-desire properties, which models fill like a form). An afterwards state
  equal to the current one means no change. Characters cannot add desires.
- **State**: `"desires"` keyed store, one `DesireRecord` per character (anchor,
  levels, current task effects, sparse `drain` overrides). Levels are a closed
  form of sim time: no ticks, polling, or settlement step. Desire values never
  go in Markdown or ledgers.
- **Hook**: a Taskman `TaskExtension` re-anchors on every `start_task` and
  `delay_task`: `prepare` validates `afterwards` and computes the record, and
  `commit` writes it before the lease is written.
- **RPCs**: `desires.get { agentId }` and
  `desires.configure { agentId, drain?, levels? }` (levels as numbers or state
  names), Zod-validated against the catalog.
- **Client read model (`src/desires/http.ts`)**: `GET /kazusa/desires` returns
  the catalog and every stored record in closed form; every record write (task
  `commit`, `desires.configure`) goes through one `write` that notifies
  `onChange` listeners, which broadcast SSE `desires`. Clients compute levels
  from sim time; never add a ticking push.
- **Not yet**: Jev decision-state input, threshold "pangs" as Perception
  stimuli, instant emotional jolts.

### 3.6 `src/location/` — Map, Positions, Knowledge & Judgment

- Design and phases: [location](../../../apps/kazusa/docs/location.md) (§0
  principles, §6 decision log, §7 review). Built: map, travel, mental maps,
  huddles, judged sightings; getting in is played out by characters. Deferred:
  recording world changes (memory module), overhearing.
- **Minimum controls.** Five controls make every mechanic: `where`, the graph,
  cards, one judgment ("does it happen?"), and huddles; recording world changes
  waits for the memory module. Nothing is refused by rule (only malformed calls
  and a walk longer than its activity error); what depends on circumstances is
  judged (noticing) or played out by the character (getting in), with
  descriptions as evidence. Do not add a frontmatter flag for something a
  description can say.
- **Map (`map.ts`, pure)**: World Wiki places
  (`shared/wiki/entities/places/<id>.md`): `place_id`, `name`, `aliases`,
  `summary`, `parent`, `entry_minutes`, `connections` (two-way, declared once;
  `ways`, the first is usual), optional client `map`; the body is the full
  description. A tree through `parent`; every place is somewhere to stand.
  Loaded once at registration and validated loudly; a world without places
  disables Location. `visibleFrom` = parent, children, siblings, connection
  ends.
- **Knowledge (`knowledge.ts`)**: known places are exactly the character's
  cards, `workspaces/<id>/wiki/entities/places/<place_id>.md`. **Visit loop**:
  with no card, **Where you are** shows the whole description; starting the next
  activity from that place writes a frontmatter-only stub (atomic, never
  overwriting), after which only the summary shows; the character adds what they
  remember. **Places you know**: places named (names, aliases, card aliases) in
  the turn's prompt or `MEMORY.md`, then the nearest cards, capped
  (`location.listLimit`). Fuzzy recall is the character's own `memory_search`;
  memory-core's search has no public plugin API, and the world wiki must never
  be added to `memory_search`.
- **State**: `"location"` store, one `LocationRecord` per character or player:
  `placeId`, `since`, optional `trip` (task id, destination, depart/arrive at
  the lease's end, places passed with sim times, usual minutes, and for walking
  over a `purpose`: what they came for and the minutes planned). Closed form of
  sim time (`positionAt`); no record means the `home` on the world character
  card.
- **`where` on `start_task`**: required plain string (id, name, alias, or the
  character's words for a spot where they are, kept as `spot`). A travel
  category with words that are no place says "You don't know the way to …" and
  leaves them where they are: a trip needs a route. A travel category
  (`location.travelCategories`) is a trip scaled to the task's duration; any
  other activity elsewhere walks over at the usual pace and checks in on arrival
  (`checkInAt`); an activity too short for that walk is refused with the usual
  time before any judgment ("Getting from X to Y usually takes 13 minutes, which
  doesn't fit in this 10-minute activity…"): the walk counts against the
  duration, and a check-in after the end is a hard error the model must hear.
  Planning the route is the model's job. `where` also resolves a backticked id
  inside a label (``Library `school_library` ``), the form prompts show.
  Mid-trip starts stop at the place being passed; `delay_task` moves a trip's
  arrival. Journal payloads carry `where`, `from`, `arriveAt`, `usualMinutes`,
  `spot`.
- **Judgments (`judgment.ts`)** follow Perception's decision pattern: rubric in
  `shared/skills/location-judgment/SKILL.md` frontmatter, one `choice` question,
  `api.runtime.decisions.evaluate` owned by the acting agent,
  `purpose: "location.<question>"`, likelihood words mapped to probabilities
  (`location.likelihood`) and a seeded roll; `location.fallbackLikelihood` per
  question (`notice: unlikely`). The only question is `notice`. **Getting in is
  not judged**: arriving puts the character at the door, and whether it opens is
  theirs to play out from the place (`context-conventions` says so in two
  sentences), which saves a decision call per trip. So the rules a character
  needs at the door (opening hours, locks) belong in a place's `summary`, which
  is all a known place shows. Judged by the model, entry came back `likely` for
  half of all public places (a fifth of moves failed, Airi was shut out of her
  own dorm twice), and the refusal reached the visitor before the walk.
- **Every arrival is a lease's end**: Perception's cron handler calls
  `onDeadline` → `location.settle`, which settles the arrival (sightings both
  ways) and returns the arrival line ("You've arrived at … You came here for …")
  that Perception adds to the deadline check-in.
- **The place is physical only; conversations are huddles** (Messaging). After
  every move Location's `moved` handles what changed for others: leaving takes
  the mover out of the place's huddles (`leavePlace`) and is seen, without a
  judgment, by anyone who had noticed them; arriving is a sighting both ways
  (`arrive`: the arriver notices each group there; `comes`: each occupant
  notices the arriver); and every future crossing of the new plan with others'
  (`encounters.ts`) is a `cross` sighting, or a `meet` where two walking toward
  each other on one connection meet partway (solved from both stretches; the
  pass-pass crossing near it is suppressed). Head-on walkers always meet.
- **Sightings** are `foreseen` stimuli in the observer's `:tasks` session, id
  `sighting|<kind>|<subject>|<place>|<at>`, held until their moment. Location's
  `confirm` re-checks positions, expands the subject to their whole huddle there
  (one judgment per group, its first member standing for it), judges `notice`,
  writes the sighting to the observer's ledger (`location.noticed`), and returns
  its text, naming the group and its huddle address ("You see Airi
  `kurimura-airi` and Natsu `yutori-natsu`, talking (chat:huddle:…), here."). A
  standing observer adds standing people to their record's `noticed`, which a
  move clears. Someone passing through (either side mid-trip) is still sighted,
  judged, delivered and kept in the ledger, so "I saw you zoom by" works, but
  never enters `noticed`, which means who is here now. Noticing is one-way.
- **With you** lists noticed people and your own huddle's members there, with
  their activity and huddle; `inCompany` (in a huddle, or someone noticed here)
  selects the `in-person` skill. Noted for optimization: busy places mean many
  `notice` judgments, uncapped for now. Overhearing is a later feature.
- **RPC** operator `location.place`; **read models** `GET /kazusa/places`,
  `GET /kazusa/locations`; **SSE** `location` on every record write (place,
  trip start, arrival, `noticed` change) and `journal` for each confirmed
  sighting (`location.noticed`; the timeline reads it back from the observer's
  `:tasks` ledger metadata like any task row).
- **Known gap**: a lease started before Location existed has no `where`, so its
  holder is treated as at `home` until their next `start_task`.

## 4. Engineering & Zero-Build Conventions

- **Character Tool Surface (`openclaw.json` `tools`)**: characters get an
  explicit `tools.allow` list, never a profile: `start_task`, `delay_task`,
  `send_message`, `list_chats`, `manage_chat`, `memory_search`, `memory_get`,
  `read`, `edit`, `write` (`MEMORY.md` and the personal wiki), `view_image`.
  `tools.deny` keeps `group:sessions` and `message`, and adds `apply_patch`
  because allowing `write` implicitly enables it. `tools.toolSearch: false`:
  with a dozen tools, Tool Search's three control tools cost more than they
  save, and models route calls through its generic `tool_call`.
  `tools.codeMode.enabled: false` for the same reason: models whose catalog
  prefers code mode (GLM-5.3-flash) otherwise get every tool behind one `exec`,
  and live Airi looped `exec("return \"NO_REPLY\"")` for five minutes, holding a
  Gateway stop open. `clock_*` stay registered for operators but are not allowed
  for characters. Everything a roleplaying character must not reach is excluded
  by omission: shell, web, browser, UI, nodes/computer, Gateway/plugin
  management, media generation, goals, `ask_user`, and `session_status` (whose
  presence also adds a "use `session_status` for the exact time" line to the
  system prompt). A deployment widens the surface in its own `openclaw.json`
  (`tools.allow`, or per character `agents.entries.<id>.tools.allow`); a tool
  from a new plugin is unavailable until allowed there.
- **Time Shown to Characters**: one format everywhere, `formatSimTime` in
  brackets. Every assembled user message (the background message, deliveries,
  the situation message) opens with `[<sim time>]`, which stops OpenClaw from
  adding its own envelope stamp; check-ins carry no extra stamp.
  `agents.defaults.userTimezone: "UTC"` covers anything the host still stamps.
  OpenClaw's retired `agents.defaults.envelopeTimestamp`/`envelopeElapsed` keys
  are rejected by 2026.10.5. **Known gap**: the system prompt's
  `## Temporal Context` (`Current date: <real date>`, `Time zone: UTC`) is built
  from `Date.now()` with no config, hook or context-engine override (the
  `before_prompt_build` `systemPrompt` result replaces the whole prompt). The
  conventions skill tells characters that date is not their world's; removing it
  needs an upstream option.

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
  - User turns are stamped with host wall time at the LLM boundary (§3.4),
    including the host's own retry notes ("The previous attempt did not produce
    a user-visible answer…"); live, Natsu took that stamp for 2:42 am. The
    conventions skill tells characters such stamps are not their time.
  - A bare `catch {}` around SDK reads hides these failures. Log a warning.
  - A Gateway stopped mid-turn tombstones the brain session (§3.4). Ctrl+C
    drains running turns for up to 315 s, bounded by provider timeouts (a hung
    model call holds it to the end).
- **Live runs**: keep the sim clock at 1x or paused and `clock.advance` to just
  past the next lease end once every brain is idle; at x60 a model turn costs
  half a sim hour and check-ins land far too late. Read turns from
  `.state/agents/<id>/agent/openclaw-agent.sqlite` (`transcript_events`) and
  prompts from `GET /kazusa/context`; `openclaw proxy run` breaks model calls
  and the cache trace redacts. Operating notes and findings:
  [location live run](../../../apps/kazusa/docs/location-live-run.md).
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
- `references/mathematics.md` — Read when implementing or tuning desires
  (states, drain, task effects, rendering), task lease rules, or encounter
  probability rolls.
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
- [`apps/kazusa/docs/location.md`](../../../apps/kazusa/docs/location.md) — Read
  when working on the map, positions, travel, huddles or encounters.
