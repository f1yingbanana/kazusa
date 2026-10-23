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
│   │       └── taskman/              # Task leases, automations, tools/RPC, tests
│   │       └── context-engine/       # Phase 2: Context assembly and brain routing
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
  `ContextEngine` interface. It owns the single `agent:<id>:brain` session,
  routes all task wakes and interrupts there with steering, and resolves trusted
  skill markers before prompt assembly.
- Implements `assemble(ctx)` with the **3-Tier Retrieval Pipeline**:
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
     `agent:<id>:tasks` and `agent:<id>:thoughts`.

### Test Specifications (`plugins/kazusa/src/context-engine/context-engine.test.ts`)

- **Test 2.1 (Cross-Stream Context Assembly)**:
  - Append 5 task events to `:tasks` and 3 monologues to `:thoughts`. Run
    `assemble()`.
  - Assert prompt contains recent actions, thoughts, and location affordances in
    structured sections.
- **Test 2.2 (Adaptive Social Graph Injection)**:
  - In a 1-on-1 session with `bob`, assert `bob.md` `## Quick Impression` is
    injected.
  - In a group session with 5 agents, assert only Top-3 highest
    familiarity/affinity impressions are injected.
- **Test 2.3 (Sensory Shock Perception on World State Mismatch)**:
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
  - `start_task({ type, description, duration, summary?, metadata? })`: Creates
    an initial lease or replaces the active one in OpenClaw's plugin state
    database (`tasks`), clamps duration to `minDuration`, sets `startedAt` and
    `endAt`, and appends the transition to `agent:<agentId>:tasks`.
  - `delay_task({ additionalDuration, reason? })`: Extends active task lease
    duration, recalculates `endAt`, updates database record, and dispatches
    delay notice to `agent:<agentId>:tasks`.
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
    minutes and notice is dispatched to `agent:<id>:tasks`.
- **Test 3.4 (Task Transition)**:
  - Replace a task with `start_task`; assert the new lease replaces the old one
    atomically and one transition notice is logged to `agent:<id>:tasks`.

---

## Phase 4: Dynamic Scheduler, Interrupt Engine & Zero-LLM Encounter Gate (`plugins/kazusa/src/interrupts`)

### Deliverables

- Autonomous Pacing: Taskman maps task/transit lease durations directly to
  autonomous wake timers.
- Auto-Arrival on Transit Completion: When clock reaches
  `transit_state.arrival_iso`, automatically flips `location`, clears transit,
  and runs Encounter Gate at new location.
- `encounter-gate.ts`: Zero-LLM encounter probability roll:
  $$P(\text{bump}) = \text{clamp}\Big(\big(0.01 + 0.94 \cdot (F_{AB} / 100)^{1.5}\big) \times M_{\text{loc}} \times (1 - \text{shield}_A)(1 - \text{shield}_B),\; 0.0,\; 0.95\Big)$$
- Interrupt Handler: On encounter or incoming message:
  - Supplies active task context (elapsed time, scheduled completion,
    description).
  - Triggers immediate session wake event via
    `openclaw system event --mode now`.
  - Agent autonomously decides whether to delay, conclude, or maintain the task.

### Test Specifications (`plugins/kazusa/src/interrupts/interrupts.test.ts`)

- **Test 4.1 (Stranger 1% vs. Friend 75% Gate)**:
  - 1,000 rolls with $F=0$: assert $\approx 1\%$ encounters.
  - 1,000 rolls with $F=80$: assert $>70\%$ encounters.
- **Test 4.2 (Shopping Interrupt & Heartbeat Rescheduling)**:
  - Alice starts 25-min shopping at 14:00. Bob arrives at 14:10, triggering
    encounter.
  - Assert Alice's task is `PAUSED` with `remaining_min: 15`. Chat wraps at
    14:16; Alice resumes shopping; next heartbeat rescheduled to 14:31.
- **Test 4.3 (Commuting Together Without Pausing Arrival)**:
  - Alice and Bob start 15-min walk at 08:40. Encounter triggered at 08:42; 3
    chat turns exchanged.
  - At 08:55, assert both agents automatically arrive at `school` on time.

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
