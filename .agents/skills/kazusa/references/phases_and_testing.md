# Kazusa Implementation Roadmap & Testing Specifications

This document outlines the six implementation phases of Kazusa (Phase 0 through
Phase 5), detailed engineering deliverables, and exact automated test
specifications.

---

## Target Project Layout

```text
apps/kazusa/ (or repository root)
├── openclaw.json
├── package.json
├── tsconfig.json
├── shared/
│   ├── locations/                    # Shared objective world facts
│   │   ├── dorm_a.md
│   │   ├── grocery_store.md
│   │   ├── school.md
│   │   └── cafe.md
│   └── skills/                       # Shared OpenClaw skills
│       ├── sim-heartbeat-planner/
│       │   └── SKILL.md
│       ├── sim-social-interaction/
│       │   └── SKILL.md
│       └── sim-nightly-reflection/
│           └── SKILL.md
├── workspaces/                       # Per-agent OpenClaw workspaces (no AGENTS.md)
│   ├── alice/
│   │   ├── SOUL.md
│   │   ├── IDENTITY.md               # Traits & desire decay configuration
│   │   ├── MEMORY.md                 # Single source of truth hot state
│   │   └── memory/
│   │       ├── 2026-10-20.md         # Cold daily distilled summaries
│   │       └── relationships/
│   │           ├── bob.md            # Impression & interaction log
│   │           └── clara.md
│   └── bob/
│       └── ...
├── packages/
│   └── sim-file-state/               # Phase 0 & 1: Parser, atomic file locks, clock & desire math
│       ├── src/
│       │   ├── clock.ts
│       │   ├── frontmatter.ts        # Atomic YAML frontmatter + Markdown reader/writer
│       │   ├── world-index.ts        # In-memory location presence index derived from files
│       │   └── desires.ts            # Passive decay math & D2A qualitative rubric renderer
│       └── test/
│           ├── phase0-files.test.ts
│           └── phase1-desires.test.ts
└── plugins/
    ├── sim-context-engine/           # Phase 2: Custom ContextEngine (plugins.slots.contextEngine)
    │   ├── openclaw.plugin.json
    │   ├── index.ts                  # Merges actions, thoughts, chat tails, location & social graph
    │   └── test/
    │       └── phase2-context.test.ts
    └── sim-harness/                  # Phase 3 & 4: Simulation tools, scheduler & interrupt hooks
        ├── openclaw.plugin.json
        ├── src/
        │   ├── tasks-and-transit.ts  # Task leases, LLM transit judgment, pause/resume hooks
        │   ├── social-tools.ts       # conclude_conversation & relationship file updates
        │   ├── scheduler-wake.ts     # Dynamic heartbeat pacing & session wake triggers
        │   ├── encounter-gate.ts     # Zero-LLM encounter probability roll
        │   └── index.ts
        └── test/
            ├── phase3-tasks.test.ts
            └── phase4-interrupts.test.ts
```

---

## Phase 0: Markdown Frontmatter Engine, File Schemas & In-Memory World Index (`packages/sim-file-state`)

### Deliverables

- `frontmatter.ts`: Atomic YAML frontmatter + Markdown reader/writer using
  write-then-rename (`writeFile(tmp) -> rename(tmp, target)`) to prevent file
  corruption during concurrent operations.
- `clock.ts`: `SimClock` interface supporting both wall-clock time and
  accelerated simulation time.
- `world-index.ts`: In-memory presence cache
  `{ agentId -> { location, transit_state, active_task } }` updated by file
  watchers on `MEMORY.md`. Provides `getAgentsAtLocation(locationId)`.

### Test Specifications (`packages/sim-file-state/test/phase0-files.test.ts`)

- **Test 0.1 (Round-Trip Frontmatter + Body Preservation)**:
  - Parse `MEMORY.md`, mutate `desires.hunger` and `active_task.status`,
    re-serialize atomically.
  - Assert `## Long-Term Goals` and `## Today's Plan` Markdown sections remain
    byte-for-byte identical.
- **Test 0.2 (Derived World Index Accuracy)**:
  - Update `alice/MEMORY.md` and `bob/MEMORY.md` to `location: "grocery_store"`.
  - Assert `worldIndex.getAgentsAtLocation("grocery_store")` returns
    `["alice", "bob"]` with zero database tables.

---

## Phase 1: Desire & Homeostasis Engine (`packages/sim-file-state`)

### Deliverables

- `desires.ts`:
  - `syncAndDecayDesires(agentWorkspaceDir, clock)`: Computes time delta $\Delta
    t_{\text{hours}}$, applies decay formula with circadian $M_{\text{tod}}$,
    tracks `sleep_debt_min`, computes squared urgency $U_d$, maps to D2A natural
    language rubric, and updates `MEMORY.md`.
  - `applyActivityDesireDeltas(agentWorkspaceDir, deltas, fractionCompleted)`:
    Rewards completed tasks scaled by actual elapsed time, clamping deltas to
    `[-3.0, +3.0]`.

### Test Specifications (`packages/sim-file-state/test/phase1-desires.test.ts`)

- **Test 1.1 (In-Place `MEMORY.md` Decay & Qualitative Rendering)**:
  - Advance `SimClock` by 5 hours for `alice`, run `syncAndDecayDesires()`.
  - Read `alice/MEMORY.md` as plain text; verify both YAML float values and
    `## Current State & Desires` natural-language bullets updated accurately.
- **Test 1.2 (Sleep Debt Accumulation)**:
  - Advance clock across 18 waking hours; verify `sleep_debt_min` accumulates in
    frontmatter and appends `"carrying 45 minutes of lingering sleep debt"` to
    the rendered text.

---

## Phase 2: Custom Multi-Stream Context Engine (`plugins/sim-context-engine`)

### Deliverables

- Implement `api.registerContextEngine("sim-context-engine", ...)` using the
  OpenClaw `ContextEngine` interface.
- Implements `assemble(ctx)`:
  1. Calls `syncAndDecayDesires()`.
  2. Injects current `shared/locations/<loc>.md` setting facts and reachable
     connections.
  3. Queries `WorldIndex` for present agents.
  4. Injects adaptive relationship cards (full `## Quick Impression` for 1-on-1
     chats; Top-3 salience ranking for groups/crowded areas).
  5. Tail-slices recent events from `agent:<id>:actions` and
     `agent:<id>:thoughts`.

### Test Specifications (`plugins/sim-context-engine/test/phase2-context.test.ts`)

- **Test 2.1 (Cross-Stream Context Assembly)**:
  - Append 5 actions to `:actions` and 3 monologues to `:thoughts`. Run
    `assemble()`.
  - Assert prompt contains recent actions, thoughts, and location affordances in
    structured sections.
- **Test 2.2 (Adaptive Social Graph Injection)**:
  - In a 1-on-1 session with `bob`, assert `bob.md` `## Quick Impression` is
    injected.
  - In a group session with 5 agents, assert only Top-3 highest
    familiarity/affinity impressions are injected.

---

## Phase 3: Task Leases, Transit Engine & Social Tools (`plugins/sim-harness`)

### Deliverables

- Tools:
  - `start_activity({ type, description, duration_min, channel, focus_shield, expected_desire_deltas })`:
    Creates `IN_PROGRESS` lease in `MEMORY.md`, returns
    `{ next_check: "${duration_min}m" }`.
  - `start_transit({ to_location, estimated_duration_min })`: Verifies
    connection in `shared/locations/<loc>.md`, sets `transit_state`, logs to
    `:actions`, returns `{ next_check: "${estimated_duration_min}m" }`.
  - `conclude_activity()`: Settles lease, calculates $\Delta t_{\text{elapsed}}
    / \Delta t_{\text{planned}}$, applies scaled desire rewards.
  - `record_thought({ thought, candidate_options })`: Appends monologue and D2A
    3-option pre-imagination to `:thoughts` session.
  - `conclude_conversation({ peer_id, impression_updates, log_entry })`: Updates
    `<workspace>/memory/relationships/<peer>.md` frontmatter and logs.

### Test Specifications (`plugins/sim-harness/test/phase3-tasks.test.ts`)

- **Test 3.1 (Start-Then-Settle Task Lease)**:
  - Start 60-min task for $+2.0$ hunger. Conclude after 30 min. Assert hunger
    increases by exactly $+1.0$ ($0.5 \times 2.0$).
- **Test 3.2 (LLM Travel Judgment & Validation)**:
  - Attempt transit to unconnected location; assert tool returns descriptive
    error listing valid connections.
- **Test 3.3 (Conclude Conversation & Relationship Mutator)**:
  - Call `conclude_conversation()`. Assert `memory/relationships/<peer>.md`
    frontmatter increments `familiarity` and appends interaction entry under
    `## Interaction Log`.

---

## Phase 4: Dynamic Scheduler, Interrupt Engine & Zero-LLM Encounter Gate (`plugins/sim-harness`)

### Deliverables

- Dynamic Pacing Hook: Maps task/transit lease durations directly to
  `next_check`.
- Auto-Arrival on Transit Completion: When clock reaches
  `transit_state.arrival_iso`, automatically flips `location`, clears transit,
  and runs Encounter Gate at new location.
- `encounter-gate.ts`: Zero-LLM encounter probability roll:
  $$P(\text{bump}) = \text{clamp}\Big(\big(0.01 + 0.94 \cdot (F_{AB} / 100)^{1.5}\big) \times M_{\text{loc}} \times (1 - \text{shield}_A)(1 - \text{shield}_B),\; 0.0,\; 0.95\Big)$$
- Interrupt Handler: On encounter or incoming message:
  - If task is `EXCLUSIVE`, sets `status = "PAUSED"` and computes
    `remaining_min`.
  - If task is `KINEMATIC_PARALLEL`, transit timer keeps running.
  - Triggers immediate session wake event via
    `openclaw system event --mode now`.

### Test Specifications (`plugins/sim-harness/test/phase4-interrupts.test.ts`)

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
- **Invariant 2 Verification**: Zero hallucinated actions; every activity
  reflected in `:actions` and `MEMORY.md`.
- **Invariant 3 Verification**: All rewards settled proportionally on task
  conclusion or interrupt.
- **Nightly Distillation**: Verify `memory/YYYY-MM-DD.md` is generated and
  queryable via `memory_search`.
