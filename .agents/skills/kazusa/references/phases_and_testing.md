# Kazusa Implementation Roadmap & Testing Specifications

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
│   │       ├── index.ts              # Builds Clock and injects it into Taskman
│   │       ├── clock/                # Formula clock, OpenClaw state, tools/RPC, tests
│   │       ├── taskman/              # Task leases, automations, tools, tests
│   │       ├── context-engine/       # Context assembly, not routing
│   │       └── perception/           # PLANNED: stimulus routing and attention admission
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
    │   ├── IDENTITY.md               # Traits & desire decay configuration
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

## Phase 1: Desire & Homeostasis Engine (`plugins/kazusa/src/homeostasis`)

### Deliverables

- `plugins/kazusa/src/homeostasis/desires.ts`:
  - `syncAndDecayDesires(agentWorkspaceDir, clock)`: Computes time delta $\Delta
    t_{\text{hours}}$, applies decay formula with circadian $M_{\text{tod}}$,
    tracks `sleep_debt_min`, computes squared urgency $U_d$, maps to D2A natural
    language rubric, and updates `MEMORY.md`.
  - `applyActivityDesireDeltas(agentWorkspaceDir, deltas, fractionCompleted)`:
    Rewards completed tasks scaled by actual elapsed time, clamping deltas to
    `[-3.0, +3.0]`.

### Test Specifications (`plugins/kazusa/src/homeostasis/desires.test.ts`)

- **Test 1.1 (In-Place `MEMORY.md` Decay & Qualitative Rendering)**:
  - Advance `SimClock` by 5 hours for `alice`, run `syncAndDecayDesires()`.
  - Read `alice/MEMORY.md` as plain text; verify both YAML float values and
    `## Current State & Desires` natural-language bullets updated accurately.
- **Test 1.2 (Sleep Debt Accumulation)**:
  - Advance clock across 18 waking hours; verify `sleep_debt_min` accumulates in
    frontmatter and appends `"carrying 45 minutes of lingering sleep debt"` to
    the rendered text.

---

## Phase 2: Multi-Stream Context Engine (`plugins/kazusa/src/context-engine`)

### Deliverables

- Implement the context engine within the Kazusa plugin using OpenClaw's
  `ContextEngine` interface. It assembles the single `agent:<id>:brain`
  session's context and resolves trusted skill markers. Routing/admission
  belongs to planned Perception, not context assembly.
- Current implementation assembles whole task/chat records from the last 24
  simulated hours under one budget, grouped by session; adds current simulation
  time, recent complete brain turns, and packaged skills; no active-task pull.
  Native workspace bootstrap supplies long-term memory. See
  [context-engine conventions](context_engine.md) for settings and chat naming.
- Future extensions add the **3-Tier Retrieval Pipeline**:
  1. Calls `syncAndDecayDesires()`.
  2. **Tier 1 (Spatial Perception & Sensory Shock)**: Reads current place from
     `shared/wiki/entities/places/<loc>.md`. Compares against agent's
     `workspaces/<id>/wiki/entities/places/<loc>.md`. If physical state changed
     while absent (e.g. `DESTROYED` vs `OPERATIONAL`), automatically injects a
     `[Sensory Observation]` notice.
  3. Queries `WorldIndex` for co-present agents.
  4. **Tier 2 (Social Salience)**: Injects adaptive relationship cards from
     `workspaces/<id>/wiki/entities/characters/<peer>.md` (full
     `## Quick Impression` for 1-on-1; Top-3 salience ranking for crowds).
  5. **Tier 3 (Session Stream Tails)**: Tail-slices recent events from
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

## Phase 4: Perception and Attention Admission (Design Only)

### Deliverables

- `plugins/kazusa/src/perception/`: separate responsibility inside the unified
  plugin. Classify chat, physical encounter, world-event, and task-due stimuli;
  route records to their appropriate ledgers and admitted input to `:brain`.
- Secondary pending-stimulus queue: inspect brain busy/idle state, then decide
  wake, steer/distraction, or defer. Drain eligible pending input at appropriate
  lifecycle boundaries. Preserve original simulation occurrence timestamps.
- Taskman submits task-due stimuli rather than owning brain routing, while
  retaining native cron scheduling. Revalidate deferred deadlines before
  delivery. No Perception code exists yet.
- Keep spatial encounter generation/navigation outside Taskman. Perception
  receives such stimuli; it does not auto-pause tasks or manufacture outcomes.
- See [Perception design](perception.md) for native integration constraints and
  open admission/fairness decisions.

### Future Test Specifications

- Busy vs. idle admission; meaningful distraction vs. deferred attention;
  completion/error recovery; single brain ordering across different chats.
- No duplicate admission on retries, no stale task-due stimulus after a
  transition/delay, and bounded progress during stimulus bursts.
- Shopping interruption: elapsed/remaining time is inferable from timestamped
  ledger entries. The lease stays unchanged unless the character calls
  `delay_task` or `start_task`; no automatic `PAUSED` state.
- Physical encounters differ from chat messages and respect perceptibility.
  Spatial arrival updates remain the navigation subsystem's responsibility.

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
