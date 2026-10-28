# Kazusa Implementation Roadmap & Testing Specifications

**Current integration blocker:** Perception core/context/tests are drafted, but
its Gateway methods require bundled/trusted-official status unavailable to local
Kazusa. It is not registered; Taskman's existing wake path is preserved. Phase 4
routing descriptions below remain the target until a supported, authorized
transport is selected. See [Perception](perception.md).

This document outlines the six implementation phases of Kazusa (Phase 0 through
Phase 5), detailed engineering deliverables, and exact automated test
specifications. All plugins are built in **TypeScript under `plugins/`**
executed directly by OpenClaw at runtime with **zero build step**.

---

## Target Project Layout

```text
apps/kazusa/ (or repository root)
├── openclaw.json
├── openclaw.local.json               # Local overlay for test agents & dev settings (GIT-IGNORED)
├── package.json
├── tsconfig.json
├── plugins/                          # Direct TypeScript plugins (ZERO BUILD STEP)
│   ├── kazusa/                       # Unified simulation kernel
│   │   ├── openclaw.plugin.json
│   │   ├── package.json              # @kazusa/plugin; direct TypeScript entry
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # Composes Clock, Taskman, Perception, ContextEngine
│   │       ├── clock/                # Formula clock, OpenClaw state, tools/RPC, tests
│   │       ├── taskman/              # Task leases, automations, tools, tests
│   │       ├── context-engine/       # Context assembly, not routing
│   │       └── perception/           # Explicit text ingress and bounded attention admission
├── shared/
│   ├── wiki/                         # 1. WORLD WIKI: Canonical facts & world ground truth
│   │   ├── entities/
│   │   │   ├── places/               # Places, connections, status (replaces shared/locations/)
│   │   │   │   ├── dorm_a.md
│   │   │   │   ├── grocery_store.md
│   │   │   │   ├── school.md
│   │   │   │   └── cafe.md
│   │   │   └── characters/           # Complete 100+ character roster (active + background NPCs)
│   │   │       ├── alice.md
│   │   │       ├── bob.md
│   │   │       └── hifumi.md
│   │   ├── concepts/                 # Canonical history & town laws (e.g. history.md, town_laws.md)
│   │   └── reports/                  # Global compiled dashboards (directory, social graph)
│   └── skills/                       # Shared OpenClaw skills across all agents
│       ├── sim-heartbeat-planner/
│       │   └── SKILL.md
│       ├── sim-social-interaction/
│       │   └── SKILL.md
│       └── sim-nightly-reflection/
│           └── SKILL.md
└── workspaces/                       # Active simulated agents (active subset of world roster)
    ├── alice/
    │   ├── SOUL.md
    │   ├── IDENTITY.md               # Bio & traits
    │   ├── MEMORY.md                 # Qualitative reflections, ongoing thoughts, goals
    │   ├── memory/
    │   │   └── 2026-10-20.md         # Cold daily distilled summaries (memory-core indexed)
    │   └── wiki/                     # 2. PERSONAL WIKI: Subjective beliefs & impressions
    │       ├── entities/
    │       │   ├── characters/       # Subjective relationship cards (bob.md, clara.md)
    │       │   └── places/           # Subjective place memories (grocery_store.md)
    │       ├── concepts/             # Subjective beliefs & claims with evidence (market_vandalism.md)
    │       ├── syntheses/            # Character arc rollups
    │       └── reports/              # Personal contradiction detection & open questions
    └── bob/
        └── ...
```

---

## Phase 0: Clock & Taskman Kernel (`plugins/kazusa`)

### Deliverables

- `plugins/kazusa/src/clock/clock.ts` and
  `plugins/kazusa/src/clock/register.ts`:
  - `Clock` implementation of formula clock ($t_{\text{sim}} =
    t_{\text{anchor}} + (t_{\text{real}} - t_{\text{real,anchor}}) \times
    \text{speed}$).
  - Persistence via OpenClaw plugin state (`api.runtime.state.openKeyedStore`
    namespace `"clock"`). A restart resumes the stored simulated instant and
    intentionally does not advance time for Gateway downtime.
  - Registered tools `clock_now`, `clock_set_speed`, and `clock_advance`, with
    matching Gateway RPC endpoints. Time may only move forward.
  - Colocated tests in `plugins/kazusa/src/clock/clock.test.ts`.
- `plugins/kazusa/src/taskman/`:
  - Task state persistence directly via OpenClaw plugin state
    (`api.runtime.state.openKeyedStore` namespace `"tasks"`).
  - Dashboard-visible wake automations rebuilt from retained state on
    `cron_reconciled`; no `setTimeout` scheduler.
  - Colocated tests in `plugins/kazusa/src/taskman/taskman.test.ts`.

### Test Specifications

- **Test 0.1 (`plugins/kazusa/src/clock/clock.test.ts`)**:
  - Validates default initialization, manual advance, time stop (speed=0), and
    persistence across service restarts.
- **Test 0.2 (`plugins/kazusa/src/taskman/taskman.test.ts`)**:
  - Validates in-memory and database task store state persistence and retrieval.

---

## Phase 1: Narrative Desires (`plugins/kazusa/src/desires`)

### Deliverables

- `desires/desires.ts` (pure): state lookup, closed-form `levelsAt`,
  re-anchoring for task start/delay, `afterwards` JSON schema from the catalog,
  and the `How you feel` line. See [mathematics](mathematics.md) §1.
- `desires/register.ts`: `"desires"` store, Taskman `TaskExtension`,
  `desires.get` / `desires.configure` RPCs, and the context-engine provider.

### Test Specifications (`plugins/kazusa/src/desires/desires.test.ts`)

- **Test 1.1 (Drain)**: a `fine` desire drains at its rate and clamps at 0.
- **Test 1.2 (Effects)**: `afterwards: { satiety: "low→full" }` over 30 minutes
  reaches the `full` level at the planned end, then drains; replacing the task
  halfway leaves it halfway; the effect never overshoots its target.
- **Test 1.3 (Delay)**: `delay_task` restates effects from the current level to
  the new end; naming a desire's current state is no change.
- **Test 1.4 (Validation)**: missing `afterwards` or unknown desire/state names
  fail `start_task` without writing a lease.

---

## Phase 2: Multi-Stream Context Engine (`plugins/kazusa/src/context-engine`)

### Deliverables

- Implement the context engine within the Kazusa plugin using OpenClaw's
  `ContextEngine` interface. It assembles the single `agent:<id>:brain`
  session's context and resolves trusted skill markers. Routing/admission
  belongs to Perception, not context assembly. A separate lightweight assembly
  profile supports the tool-free `:perception` classifier.
- Current implementation assembles whole task/chat records from the last 24
  simulated hours under one budget, grouped by session; adds current simulation
  time, recent complete brain turns, and packaged skills; no active-task pull.
  Native workspace bootstrap supplies long-term memory. See
  [context-engine conventions](context_engine.md) for settings and chat naming.
- Future extensions add the **3-Tier Retrieval Pipeline**:
  1. **Tier 1 (Spatial Perception & Sensory Shock)**: Reads current place from
     `shared/wiki/entities/places/<loc>.md`. Compares against agent's
     `workspaces/<id>/wiki/entities/places/<loc>.md`. If physical state changed
     while absent (e.g. `DESTROYED` vs `OPERATIONAL`), automatically injects a
     `[Sensory Observation]` notice.
  2. Queries `WorldIndex` for co-present agents.
  3. **Tier 2 (Social Salience)**: Injects adaptive relationship cards from
     `workspaces/<id>/wiki/entities/characters/<peer>.md` (full
     `## Quick Impression` for 1-on-1; Top-3 salience ranking for crowds).
  4. **Tier 3 (Session Stream Tails)**: Tail-slices recent events from
     `agent:<id>:tasks`, `:chat:direct:*`, and `:chat:group:*` (implemented).

### Test Specifications (`plugins/kazusa/src/context-engine/context-engine.test.ts`)

- **Test 2.1 (Cross-Stream Context Assembly)**:
  - Merge task experiences/monologues and direct/group chat events in timestamp
    order for selection, then regroup by session. Verify ownership, one shared
    token budget, complete messages, a strict simulation-time cutoff (24 hours
    by default), and intact tool pairs across steering boundaries.
  - Verify simulation timestamps survive native transcript persistence and use
    the native token estimate. Do not assume transcript envelope time is
    simulation time.
  - Test the native registration contract and known skill loading separately.
- **Test 2.2 (Future Adaptive Social Graph Injection)**:
  - In a 1-on-1 session with `bob`, assert `bob.md` `## Quick Impression` is
    injected.
  - In a group session with 5 agents, assert only Top-3 highest
    familiarity/affinity impressions are injected.
- **Test 2.3 (Future Sensory Shock Perception on World State Mismatch)**:
  - Set `grocery_store.md` in World Wiki to `status: DESTROYED`.
  - Leave `alice/wiki/entities/places/grocery_store.md` as
    `status: OPERATIONAL`.
  - Run `assemble()` for Alice at `grocery_store`.
  - Assert prompt contains `[Sensory Observation]` detailing the destroyed
    store.

---

## Phase 3: Task Scheduler & Pacing Engine (`plugins/kazusa/src/taskman`)

### Deliverables

- Consolidated Tools in `plugins/kazusa/src/taskman/taskman.ts`:
  - `start_task({ type, description, duration, summary?, monologue?, metadata? })`:
    Creates an initial lease or replaces the active one in OpenClaw's plugin
    state database (`tasks`), clamps duration to `minDuration`, sets `startedAt`
    and `endAt`, and appends the transition to `agent:<agentId>:tasks`.
  - `delay_task({ additionalDuration, reason?, monologue? })`: Extends active
    task lease duration, recalculates `endAt`, updates database record, and
    dispatches delay notice to `agent:<agentId>:tasks`.
  - Both tools accept an optional one- or two-sentence in-character monologue.
    Format it below the factual summary as an italic blockquote in the native
    ledger message text, without extending OpenClaw's message schema.
- Subsystem Decoupling:
  - Taskman is strictly scoped to task lease management and pacing.
  - Location/transit routing belongs to the spatial navigation subsystem.
  - Desire satisfaction and homeostasis decay belong to the desire engine.

### Test Specifications (`plugins/kazusa/src/taskman/taskman.test.ts`)

- **Test 3.1 (Start Task & Lease Scheduling)**:
  - Call `start_task` with duration; assert database record stores `startedAt`
    and `endAt` matching clock, and sends notice to `agent:<id>:tasks`.
- **Test 3.2 (Min Duration Enforcement)**:
  - Call `start_task` with duration below `minDuration`; assert duration is
    clamped to `minDuration`.
- **Test 3.3 (Delay Task Extension)**:
  - Call `delay_task` with additional duration; assert `endAt` is extended by N
    minutes and notice is appended to `agent:<id>:tasks` with the simulated
    update timestamp, new deadline, and remaining minutes at that update.
- **Test 3.4 (Task Transition)**:
  - Replace a task with `start_task`; assert the new lease replaces the old one
    atomically and one transition notice is logged to `agent:<id>:tasks`.
- **Test 3.5 (Task Monologue)**:
  - Transitions and delays append plain-text monologues as italic blockquotes
    below their factual summaries in the same ledger message text. Omitted or
    blank monologues preserve summary-only ledger output.

---

## Phase 4: Perception and Attention Admission (Jev Decision Model)

### Deliverables

- `plugins/kazusa/src/perception/`: In-process sensory nervous system.
  - Intercepts incoming direct/group messages via `api.on("before_dispatch")`,
    persists them to the owner's subjective ledger (`agent:<id>:chat:*`) with
    `[speaker:<id>]` prefix, and registers the stimulus.
  - **Jev Decision Model Evaluation**: Calls `api.runtime.decisions.evaluate`
    using TypeSafe AI's Jev (`typesafe/jev-latest` or local Kev) to evaluate
    incoming stimuli in a single sub-100ms forward pass without output tokens.
  - **Universal Gate (Both Idle & Busy)**:
    - _Idle_: Evaluates `["WAKE", "IGNORE"]` against the character's active task
      (e.g., sleeping, reading). Casual chatter while sleeping is ignored,
      saving expensive frontier LLM turns. Wakes brain when $P(\text{WAKE}) \ge
      T_{\text{wake}}$.
    - _Busy_: Evaluates `["STEER", "QUEUE_NEXT", "IGNORE"]` with task-dependent
      hysteresis ($T_{\text{steer}} \in \{0.45, 0.75, 0.90\}$).
  - **In-Process Integration**: Tracks brain state via lifecycle events
    (`api.agent.events.registerAgentEventSubscription`), wakes idle brain via
    native cron automations, and steers ongoing turns via native `mode: "steer"`
    session queue. Completely resolves the OpenClaw 2026.10.5 Gateway RPC
    blocker.
  - **Task Deadlines**: Coalesced flag checks active task lease against
    `clock.time()`. Deadlines bypass the decision model and wake
    deterministically.
- Verbatim stimulus preservation: Admitted stimuli pass through without lossy
  generative summarization.

### Test Coverage and Verification

- Unit & state-machine coverage:
  - Sleep filtering: Routine chatter during `sleep` task evaluates to `IGNORE`;
    brain stays asleep with zero LLM turns.
  - Emergency wake: Critical alert during sleep outputs $P(\text{WAKE}) \ge
    0.85$; wakes brain immediately with raw stimulus.
  - Busy-brain hysteresis: Low-focus tasks steer easily ($T_{\text{steer}} =
    0.45$); high-focus tasks resist steering ($T_{\text{steer}} = 0.90$) and
    defer to `QUEUE_NEXT`.
  - Queue draining: Completed brain turn automatically consumes pending queued
    stimuli.
  - Task deadline re-validation: Expired lease triggers wake; delayed lease
    drops check.
  - Process restart: Retained stimuli in `"perception"` store survive and
    re-evaluate.

---

## Phase 5: Shared Behavioral Skills & Nightly Sleep Distillation

### Deliverables

1. `shared/skills/sim-heartbeat-planner/SKILL.md`: Settle $\rightarrow$ Orient
   $\rightarrow$ 3-Option Pre-Imagine $\rightarrow$ Commit cycle.
2. `shared/skills/sim-social-interaction/SKILL.md`: Natural dialogue flow, using
   eager Quick Impression, and clean conversational exit triggers.
3. `shared/skills/sim-nightly-reflection/SKILL.md`: Sleep preparation, daily
   stream consolidation into `<workspace>/memory/YYYY-MM-DD.md`, updating
   long-term goals and tomorrow's plan, and triggering `openclaw memory status`
   re-indexing.

### End-to-End Verification (`test/phase5-e2e.test.ts`)

Run a 24-hour simulation across 3 agents (`alice`, `bob`, `clara`):

- **Invariant 1 Verification**: 100% of state inspectable in Markdown files;
  zero uncommitted SQLite tables.
- **Invariant 2 Verification**: Zero hallucinated actions; every task reflected
  in `:tasks` and `MEMORY.md`.
- **Invariant 3 Verification**: All rewards settled proportionally on task
  conclusion or interrupt.
- **Nightly Distillation**: Verify `memory/YYYY-MM-DD.md` is generated and
  queryable via `memory_search`.
