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
(`api.runtime.decisions.evaluate`). Attention policy is in-process, but the
current private active-run steering adapter is not a supported SDK contract.
Do not replace it with deprecated `queueAgentHarnessMessage` or assume the
controller described by rolling upstream docs is exposed to local plugins.
See `references/perception.md` for routing and transport constraints.

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
6. **Perception (Stimulus Routing & Attention Admission with Jev Decision Model)**:
   - Evaluates incoming stimuli (chats, physical events, world notices)
     through a fast System 1 Decision Model (`api.runtime.decisions.evaluate` via
     TypeSafe AI's Jev) against the agent's current task/activity and cognitive
     state.
   - **Universal Gate (Both Idle & Busy)**: Characters are never truly inactive
     (sleep, reading, or waiting are active tasks). Even when the brain is idle,
     Jev evaluates stimuli against the ongoing activity to avoid unnecessary and
     expensive LLM brain turns (e.g. ignoring casual banter while sleeping).
   - **Multi-Stimulus Coalescing & Emergent Salience**: Rapid-fire messages
     coalesce within a short window (`coalesceWindowMs = 500ms`). Jev evaluates
     the combined bundle with recent channel context so two individually minor
     stimuli can combine into an urgent `STEER` or `WAKE` without context severance.
   - **Consolidated Queue Draining (Single-Turn Batch Presentation)**: When a busy
     brain finishes its active turn, all queued stimuli are drained in a single
     consolidated wake turn (not one-by-one ping-pong turns). The agent synthesizes
     and addresses all accumulated events in one holistic LLM thought.
   - **Quantitative Hysteresis Math**: When the brain is busy, Jev outputs
     calibrated probabilities across `STEER`, `QUEUE_NEXT`, and `IGNORE`. We
     apply task-dependent hysteresis thresholds ($T_{\text{steer}} \in \{0.45,
     0.75, 0.90\}$) so deep-focus tasks are not easily interrupted.
   - **No Generative Rewriting & Zero Prompt Injections**: Jev is a
     non-generative classifier with categorical choices. Admitted stimuli pass
     through verbatim to the `:brain` session without hallucination or distortion.
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

| State Category              | Canonical Storage Location                                                                 | Purpose & Mutation Rule                                                                                                                                                            |
| :-------------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine Working State**   | `api.runtime.state.openKeyedStore` (`"clock"`, `"tasks"`)                                  | High-frequency virtual clock state/speed and active task leases. Never store in Markdown.                                                                                          |
| **Cognitive Brain Queue**   | OpenClaw Session `agent:<id>:brain`                                                        | Single-threaded execution; Perception gates explicitly submitted stimuli before wake/steer.                                                                                        |
| **Attention Admission**     | Native keyed store `"perception"`; Decision Model `api.runtime.decisions.evaluate`; host wake/steer transport under review | Retained pending stimuli and attention decisions. Perception is strictly an attention classifier and **never writes to chat ledgers or transcripts**. Private run registries and deprecated SDK queue helpers are not the target transport contract. |
| **Stream Ledgers**          | OpenClaw Sessions `agent:<id>:tasks`, `agent:<id>:chat:direct:*`, `agent:<id>:chat:group:*` | Append-only chronological transcripts of settled/started tasks, thoughts, and chats. **Design Decision:** Egress tools (`send_message`, `start_task`) and channel adapters own transcript writes. `before_dispatch` claims messages (`{ handled: true }`) to prevent raw auto-replies and forwards stimuli to Perception without performing duplicate writes. |
| **Agent Identity & Memory** | `workspaces/<id>/{SOUL,IDENTITY,MEMORY}.md` + `memory/`                                    | Static voice/values (`SOUL.md`), bio & YAML desire parameters (`IDENTITY.md`), qualitative reflections (`MEMORY.md`), and vector-indexed daily summaries (`memory/YYYY-MM-DD.md`). |
| **Objective Canon**         | `shared/wiki/`                                                                             | Ground-truth places, character roster, world rules, and compiled global reports.                                                                                                   |
| **Subjective Beliefs**      | `workspaces/<id>/wiki/`                                                                    | Agent-specific impressions of peers/places, personal theories, syntheses, and contradiction reports.                                                                               |

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
│       ├── clock/                      # Formula clock, "clock" store, clock_* tools & RPCs
│       ├── taskman/                    # "tasks" leases, :tasks ledger, cron projection, tools
│       ├── context-engine/             # Brain context, skill resolution, assemble()
│       └── perception/                 # Text ingress, retained inbox, bounded attention admission
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
`src/index.ts` composes `Clock`, `Taskman`, `ContextEngine`, and `Perception` directly in
process. Do not introduce cross-plugin service boundaries or split these into
separate packages. Keep their internal responsibilities decoupled; callbacks and
direct references connect these modules in process.

### 3.1 `src/clock/` — Virtual Formula Clock

- Owns forward-only simulation time ($\text{sim\_time} + \Delta t \times
  \text{speed}$), lifecycle persistence in the `"clock"` keyed store, agent
  tools (`clock_now`, `clock_set_speed`, `clock_advance`), and matching
  `clock.*` Gateway RPCs.

### 3.2 `src/taskman/` — Lease State, Ledger & Wake Scheduling

- **Lease & Ledger Ownership**: Manages active leases in the `"tasks"` keyed
  store and exposes `start_task` and `delay_task`. Every task transition or
  delay appends to the native `agent:<agentId>:tasks` session transcript and
  publishes its update. Because `enqueueSystemEvent` is transient, never use it
  as a task ledger.
- **In-Character Monologues**: Transitions and delays may include a brief
  in-character `monologue`. Format it as an italic blockquote directly below the
  factual summary inside the same ledger message text rather than extending
  OpenClaw's message schema.
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
  block in OpenClaw's lane queue. This locks out `before_agent_reply`, preventing
  Perception from receiving the deadline stimulus mid-flight and eliminating the
  possibility of mid-turn steering. By targeting `"isolated"`, the cron job runs
  in its own uncontended lane, immediately fires `before_agent_reply` on schedule,
  passes the deadline stimulus to `perception.receive()`, and claims the turn
  with `{ handled: true }`. Returning `{ handled: true }` silences LLM inference
  (zero tokens used), avoids writing any prompt/reply to transcripts, and marks
  the cron run as `status: "ok"` (success) on OpenClaw's dashboard, after which
  OpenClaw deletes the ephemeral session (`deleteAfterRun: true`).
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
- Retains recent complete brain turns (`recentBrainHistory`, bounded by
  `brainMaxTokens`, default 2000; can be set to 0 for pure ledger runs) to
  guarantee tool-call/result atomicity & error recovery, in-flight steering
  boundary preservation, and reasoning continuity.
- Uses native `readSessionTranscriptCatalogPage` in newest-first pages of up to
  200 items, stopping at the simulation-time cutoff. There is no total message
  count cap. Skip undated/invalid timestamps; empty pages with a continuation
  cursor must still be followed. Ledger writers preserve simulation-time order.
- **Ledger writer contract**: Every task/chat message must contain one text
  block with all readable content and media summaries. Planned `send_message`
  writes native `__openclaw.senderId`, `senderName`, and `senderIdentity`
  metadata; see [the messaging contract](references/messaging.md). The context
  engine uses the catalog's structured sender for all incoming direct/group
  messages, native outgoing role for self, and no speaker for task records.
  Never infer authorship from text prefixes, display names, or peer keys.
- Require `runtimeContext.sessionTarget.agentId` during assembly; throw if
  absent rather than deriving ownership from a key. `register.ts` owns SDK
  lifecycle, configuration, and session I/O. `context-engine.ts` owns selection,
  rendering, and skill expansion.
- Adds current simulation time and reads task and chat records from the last 24
  simulated hours (configurable upward), selects whole messages newest-first
  under one shared remaining token budget, then groups them by session with
  chronological, timestamped entries. Accept native catalog display clipping;
  add no source quotas or further per-message clipping,
  incognito feature, or external-channel adapter.
- **Multi-Media Architecture**: Grounded preflight + on-demand inspection. Media
  processors receive the Context Engine's assembled background (location,
  identities, conversation thread) to produce situation-aware descriptions.
  Ledgers record only lightweight `[Image: <summary>]` text blocks with
  attachment references, excluding heavy raw image tokens from context assembly.
  Agents re-inspect images on demand via `view_image(path, prompt)`.
- The brain profile does not read active-task state. The task ledger supplies
  experiences and monologues; no separate `:thoughts`. A start outside the
  window/budget can be absent, which is not proof of having no task. No task
  metadata injection yet.
- Uses OpenClaw's native token estimator. Proactive compaction is disabled;
  manual/overflow recovery still delegates to OpenClaw. Windowing is not
  summarization and never deletes ledger history.
- Chat keys distinguish `agent:<id>:chat:direct:<peer-id>` from
  `agent:<id>:chat:group:<group-id>`. Read only the owner's streams.
- **Foundational & On-Demand Skills**: The context engine unconditionally loads
  the `context-conventions` skill at the top of `systemPromptAddition`,
  establishing baseline simulation time, stream section, and envelope semantics
  so that plugin code remains free of hardcoded prose. When a stimulus contains
  one or more `[kazusa:skill=<name>]` tags, the engine dynamically resolves
  additional `<name>` skills via a dedicated `SkillLoader` following OpenClaw's
  precedence hierarchy. Frontmatter is stripped using a YAML parser so the LLM
  receives only clean Markdown.
- Behavioral instructions belong in skills, not TypeScript prompt constants.
- See [context-engine conventions](references/context_engine.md) for budgets,
  timestamps, SDK lifecycle requirements, and the future messaging contract.
- Future additions extend this into the **3-Tier Retrieval Pipeline**:

1. **Tier 1 (Eager Spatial Perception & Sensory Shock)**: Diffs the current
   location in `shared/wiki/` against the agent's `workspaces/<id>/wiki/` to
   surface environmental changes or unfamiliar surroundings.
2. **Tier 2 (Eager Social Salience)**: Injects `## Quick Impression` blocks from
   the agent's Personal Wiki for all co-present characters.
3. **Tier 3 (Session Stream Tails)**: Merges recent entries from the agent's
   `:tasks`, `:chat:direct:*`, and `:chat:group:*` streams (implemented).

### 3.4 `src/perception/` — Stimulus Router & Attention Gate (Jev Decision Model)

- See [Perception](references/perception.md) for detailed mathematical rubrics,
  admission interleavings, state compilation, and test specifications.
- **Decision Model Paradigm**: Uses OpenClaw's native
  `api.runtime.decisions.evaluate({ state, questions }, { agentId, purpose: "perception" })`
  powered by TypeSafe AI's Jev (`typesafe/jev-latest`, local Kev, or ONNX).
  Evaluates categorical choices in a single forward pass (~70–200ms latency,
  zero generated output tokens, $0.042/1M input tokens).
- **Universal Gate (Both Idle & Busy Brains)**: All incoming stimuli are evaluated
  against the character's active task and cognitive state:
  - **Idle Brain**: Characters are never truly inactive (sleep, reading, and
    waiting are active tasks, defaulting to "resting" when unset). Jev evaluates
    `["WAKE", "IGNORE"]`. Ambient noise during deep sleep or meditation faces an
    elevated threshold ($T_{\text{wake}} = 0.85$ vs. $0.50$). Bundles where all
    items were already approved as `QUEUE_NEXT` during a busy turn bypass Jev
    re-evaluation and wake immediately on turn completion. Ignored stimuli
    remain in the subjective ledger without invoking an LLM turn.
  - **Busy Brain**: Evaluates `["STEER", "QUEUE_NEXT", "IGNORE"]` with calibrated
    numerical hysteresis. Deep-focus tasks require high conviction before
    interrupting:
    $$T_{\text{steer}} = \begin{cases} 0.45 & \text{low focus (waiting, lounging, resting)} \\ 0.75 & \text{medium focus (walking, shopping, casual talk)} \\ 0.90 & \text{high focus (studying, combat, deep sleep, intense conversation)} \end{cases}$$
- **Multi-Stimulus Coalescing & Emergent Salience**: Rapid arrivals coalesce
  within a brief window (`coalesceWindowMs = 500ms`). Jev evaluates the incoming
  bundle against recent channel context and currently pending items so two
  individually minor stimuli can combine into an urgent `STEER` or `WAKE`
  without context severance.
- **Consolidated Queue Draining (Single-Turn Batch Presentation)**: When the active
  brain turn completes, all eligible pending stimuli are drained in a single
  consolidated wake turn (not one-by-one ping-pong turns). All drained IDs are
  admitted simultaneously; the agent addresses all accumulated events in a single
  coherent response.
- **Verbatim Stimulus Preservation**: Because Jev is a non-generative classifier,
  admitted stimuli pass through to `:brain` verbatim. There is zero risk of prompt
  injection hijacking routing, and no generative hallucination or lossy
  summarization.
- **Zero Second-Character Sessions**: Completely eliminates the previous
  `agent:<id>:perception` chat session, tool stripping (`toolsAllow: []`), and
  JSON string parsing. Perception operates purely in-process.
- **In-Process Lifecycle & Ingress Hooks**:
  - `before_dispatch` claiming hook returns `{ handled: true }` and notifies
    Perception. Chat producers own prior ledger persistence, not this hook.
  - Brain busy/idle tracking uses native in-process agent events
    (`api.agent.events.registerAgentEventSubscription({ streams: ["lifecycle"] })`).
  - Idle brain waking uses native cron automations (`ctx.getCron().add(...)`)
    targeting `agent:<id>:brain`.
  - Ongoing turn interruptions use OpenClaw's native `mode: "steer"` session queue.
- **Task Deadlines as Stimuli & Attention Floor**: Task deadlines enter Perception as first-class
  `Stimulus` objects via ephemeral cron interception (`before_agent_reply` claiming
  with `{ handled: true }`). Because characters are never taskless and the passage of
  time cannot be undone, task deadlines possess an **attention floor of `QUEUE_NEXT`**.
  Jev can allocate `STEER` (for urgent hazards) or `QUEUE_NEXT` (for routine completion),
  but task deadlines can never be dropped into `IGNORE`. When idle, deadlines unconditionally
  trigger `WAKE`. When a character preempts or transitions tasks early (`start_task`),
  Taskman atomically replaces the cron projection; any racing stale deadline
  stimulus is validated against `task.id` and dropped silently. (Future roadmap: if an
  LLM concludes a turn without calling `start_task`/`delay_task`, Taskman will project
  regular-interval overdue cron nudges rather than forcing an OOC synthetic resting lease).
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
- **Zero Legacy Tech Debt & Greenfield Purity**: Kazusa is an unreleased, greenfield
  framework. Never introduce transitional backward-compatibility shims, dual-type
  unions (`T | LegacyT`), deprecated migration fallbacks, or temporary adapter branches.
  When an architectural contract or signature evolves (e.g., standardizing on `DecisionBatch`),
  cleanly refactor all types, call sites, and unit tests in one atomic step. Never hedge
  or leave obsolete interfaces or runtime checks in the codebase.
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
- `references/perception.md` — Read when designing stimulus routing, busy-brain
  admission, steering, deferred attention, or moving task wakes behind the gate.
- `references/phases_and_testing.md` — Read when planning milestone deliverables
  across Phases 0–5 or designing integration test suites.
