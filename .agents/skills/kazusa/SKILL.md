---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw. Always trigger this skill whenever
  designing, building, modifying, or testing Kazusa plugins, simulation tools,
  desire homeostasis engines, multi-stream context engines, shared agent skills,
  world state schemas, presence indexes, or multi-agent event/pacing lifecycles.
---

# Kazusa: OpenClaw Society Simulation Framework

Kazusa is a real-time, high-fidelity multi-agent society simulation framework
built entirely on the native **OpenClaw** agent runtime. Each simulated
character is an autonomous OpenClaw agent possessing distinct personality
traits, internal homeostatic desires, short- and long-term goals, evolving
social relationships, and an objective physical location in a shared world.

---

## 1. Core Paradigm & The 3 Critical Shifts

Classical generative-agent architectures (such as the 2023 Stanford Smallville
paper) run a synchronous LLM loop on every fixed clock tick (e.g., evaluating
every agent every 5–10 minutes). This approach cannot scale in real-time. Kazusa
achieves real-time execution and behavioral fidelity through three fundamental
architectural shifts:

1. **Variable-Horizon Event-Driven Autonomy (Task-Based Heartbeats)**:
   - Agents commit to coarse tasks or travel options of duration $D$ (e.g.
     _sleep for 8 hours_, _study for 60 minutes_, _walk 15 minutes to the
     market_) and Taskman autonomously schedules the agent's wake-up heartbeat
     for $t_{\text{now}} + D$.
   - The agent is not invoked again until that task concludes—_unless_
     pre-empted by an external interrupt (inbound message or spatial encounter).
     Agents reason about their sleep and wake schedule natively.
2. **Grounded World State ("Prose is Never a Fact")**:
   - Characters cannot hallucinate completing tasks, moving across town, or
     altering relationship scores simply by generating prose.
   - Every movement, task lease, and social update must be committed via
     deterministic tool calls.
3. **100% File- & Session-Native Transparency**:
   - All state—working desires, locations, leases, goals, impressions, and world
     maps—lives in human-readable Markdown files with YAML frontmatter or native
     OpenClaw Sessions. Zero custom database mirrors for agent state. Simulation
     clock time and speed persist in OpenClaw's native plugin state
     (`api.runtime.state.openKeyedStore`).

---

## 2. The 5 Non-Negotiable Invariants

Every plugin, tool, skill, and script in Kazusa must strictly adhere to these
five invariants:

### 2.1 Clean Separation of Machine State & Qualitative Memory

Never store high-frequency working state inside long-term memory files.

- **OpenClaw Plugin State Stores (`api.runtime.state.openKeyedStore`)**: Machine
  working state (simulation clock in `"clock"` and active task leases in
  `"tasks"`) stored directly in OpenClaw's native state database with zero file
  parsing churn.
- **`<workspace>/MEMORY.md`**: Qualitative reflections, narrative summaries, and
  goals, kept clean of high-churn mechanical diffs.
- **OpenClaw Sessions**: Chronological actions, tasks (`agent:<id>:tasks`),
  thoughts (`agent:<id>:thoughts`), and dialogues.

### 2.2 Prose is Never a World Fact

Prose output changes nothing in the world simulation. Only tool calls
(`start_task`, `delay_task`, `conclude_conversation`) mutate state in plugin
databases or append to stream sessions.

### 2.3 Start-Then-Settle Task Leases

`start_task` creates an initial lease or concludes and replaces the current
lease in one character turn. It records the transition in the canonical
execution stream (`agent:<id>:tasks`) and schedules the next wake-up. Characters
are never idle: sleep, waiting, and reflection are tasks too.

### 2.4 Deterministic Math in Code, Semantics in the LLM

- **In Code (0 tokens, < 1 ms)**: Simulation clock advance and formula
  calculations ($\text{sim\_time} + \Delta t \times \text{speed}$), sleep
  detection, passive desire decay, presence tracking, and zero-LLM encounter
  probability rolls.
- **In the LLM**: Deducing goals from qualitative feelings, judging travel time
  from terrain/distance descriptions, pre-imagining candidate options, and
  evaluating emotional satisfaction.

### 2.5 Variable-Horizon Event-Driven Pacing

Agents never poll on fixed intervals. Every task or transit schedules the next
heartbeat at $t_{\text{now}} + D$. When interrupted, agents receive full context
regarding the active task to decide whether to delay, conclude, or switch tasks.

### 2.6 One Brain Queue Per Character

Every task wake and external interrupt for a character is routed to the single
OpenClaw session `agent:<id>:brain`. Its queue mode is `steer`: a new stimulus
is made visible during the current cognitive turn, rather than creating a
competing turn in another chat session. The character remains single-threaded
even when events originate from different conversations or the world.

The context engine owns this routing and all prompt assembly. It reads the
active task, resolves trusted `kazusa:skill` markers to shared skills, and
instructs the model to preserve its prior intention unless the new observation
actually invalidates it. Taskman emits only the marker and schedules wakes; it
must not inject prompts, read skills, or interpret interrupts.

---

## 3. Storage Map & Folder Structure

All paths are relative to `apps/kazusa/` (or repository root):

```text
apps/kazusa/
├── openclaw.json                       # Framework configuration with plugins loaded
├── openclaw.local.json                 # Local overlay for test agents & dev settings (GIT-IGNORED)
├── package.json                        # @openrp-ai/kazusa with direct openclaw dependency
├── plugins/                            # Native OpenClaw TypeScript plugins (ZERO BUILD STEP)
│   ├── kazusa/                         # Unified simulation kernel
│   │   ├── openclaw.plugin.json
│   │   ├── package.json                # @kazusa/plugin; direct TypeScript entry
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # Registers Clock, then Taskman with that Clock
│   │       ├── clock/                  # Virtual formula clock, persistence, tools/RPC, tests
│   │       └── taskman/                # Task leases, automations, tools/RPC, tests
│   │       └── context-engine/         # Context assembly and brain routing
├── shared/
│   ├── wiki/                           # 1. WORLD WIKI: Objective ground truth & canon facts
│   │   ├── entities/
│   │   │   ├── places/<place_id>.md    # Locations, connections, distances, status, amenities
│   │   │   └── characters/<char_id>.md # Complete world character roster (100+ canon characters/NPCs)
│   │   ├── concepts/<topic>.md         # Canonical history, world rules, town laws, public records
│   │   └── reports/                    # Global compiled dashboards (relationship graph, directory)
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral workflows across all agents
├── workspaces/<agent_id>/              # Local active agent workspaces
│   ├── SOUL.md                         # Static personality, voice, and core values
│   ├── IDENTITY.md                     # Static bio + YAML desire targets & decay rates
│   ├── MEMORY.md                       # Qualitative reflections, ongoing thoughts, and goals
│   ├── memory/
│   │   └── YYYY-MM-DD.md               # Cold daily distilled summaries (vector indexed by memory-core)
│   └── wiki/                           # 2. PERSONAL WIKI: Subjective beliefs & impressions
│       ├── entities/
│       │   ├── characters/<peer_id>.md # Subjective impressions, trust, familiarity, secrets
│       │   └── places/<place_id>.md    # Subjective memory of places
│       ├── concepts/<concept_id>.md    # Subjective beliefs, theories, claims with evidence
│       ├── syntheses/                  # Long-term character arc summaries
│       └── reports/                    # Personal contradiction detection & open questions
└── .state/
    ├── clock.sqlite                    # Simulation clock state & speed
    └── ...
```

---

## 4. Key Deliverables Architecture (Zero-Build Plugins)

Kazusa is built entirely as **direct TypeScript plugins** loaded via OpenClaw's
native `plugins.load.paths` mechanism with **colocated tests inside `src/`**:

1. **`plugins/kazusa` (`@kazusa/plugin`)**:
   - Kazusa's single native runtime plugin. Its entry composes Clock, Taskman,
     and the context engine directly; do not recreate a plugin service boundary
     or package dependency between these internal modules.
   - **`src/clock/`** owns forward-only formula time, persisted `"clock"` state,
     clock tools (`clock_now`, `clock_set_speed`, `clock_advance`), matching
     `clock.*` Gateway RPC methods, and lifecycle persistence.
   - **`src/taskman/`** owns active task leases in persisted `"tasks"` state,
     task tools and the native `agent:<agentId>:tasks` transcript ledger, and
     the OpenClaw automation projection used for dashboard-visible wakes. Each
     successful task transition appends to the dedicated ledger through the
     native session-transcript runtime and publishes its update.
     `enqueueSystemEvent` is transient and must not be used as a task ledger.
   - Taskman uses a native cron `declarationKey` equal to the agent ID: normal
     task changes atomically upsert one visible wake job. Full fleet
     reconciliation occurs only at `cron_reconciled` and explicit clock edits.
     Kazusa may clear the complete cron list because it currently owns all
     Gateway automations; revisit this assumption before another owner exists.
     Wakes target `agent:<id>:brain`, never the task ledger or an isolated
     execution session.
   - Colocate focused unit tests with their module. Test-only in-memory stores
     belong in `*.test.ts`, never production source.
   - Parse plugin configuration and Gateway RPC parameters with Zod schemas; do
     not use hand-written `typeof` chains or casts for unknown inputs. Scope
     component configuration under its module name, e.g.
     `plugins.entries.kazusa.config.taskman.minDuration`.

2. **`plugins/kazusa/src/context-engine/`**:
   - The context engine remains inside the Kazusa plugin and composes directly
     with Clock and Taskman rather than crossing a plugin boundary.
   - It owns character brain routing and hooks into `assemble()` before model
     turns implementing the **3-Tier Retrieval Pipeline**:
     - **Tier 1 (Eager Spatial Perception & Sensory Shock)**: Compares current
       location in `World Wiki` with agent's `Personal Wiki`.
     - **Tier 2 (Eager Social Salience)**: Injects `## Quick Impression` for
       co-present characters.
     - **Tier 3 (Session Stream Tails)**: Merges recent events from task and
       thought streams.
   - It alone resolves skill markers and injects task, world, and stream
     context; Taskman contains no prompt hook or skill-file loader.
   - Colocate tests in `src/context-engine/`.

3. **Testing & Typecheck Standard**:
   - All tests use Vitest runner: `npm test` (`vitest run`).
   - All tests are colocated alongside their modules inside `src/` (e.g.
     `src/*.test.ts`) matching OpenClaw monorepo conventions.
   - Typechecking runs with zero emit: `npm run typecheck` (`tsc --noEmit`).

### 4.1 The `plugins/` Folder Zero-Build Philosophy

In contrast to monorepo architectures requiring compilation pipelines
(`tsc --build`, `tsup`) that delay developer iteration, Kazusa places all engine
logic directly in `plugins/`:

- **Direct TypeScript Execution**: OpenClaw executes `./src/index.ts` directly
  via its runtime TypeScript loader declared in `package.json`
  (`"openclaw": { "extensions": ["./src/index.ts"] }`).
- **Clean Configuration**: Registered in `openclaw.json` via
  `plugins.load.paths: ["./plugins/kazusa", ...]`.
- **Zero-Build Editing**: Any code edit to a TypeScript file takes effect
  immediately on the next heartbeat or event without compilation artifacts.
  watch daemons, or stale build caches.
- **Direct Vitest Testing**: All unit and integration tests execute directly
  against TypeScript files in milliseconds.

---

## 5. Progressive Disclosure: Reference Documentation

Deep-dive documentation, byte-level schemas, mathematical formulas, and testing
specifications are modularized in the `references/` directory. Consult the
appropriate reference document as needed:

- **File Schemas & State Contracts**: `references/file_schemas.md` _Read when
  implementing parsers, creating initial agent workspaces, modifying
  `MEMORY.md`, `IDENTITY.md`, locations, or relationship cards._

- **Deterministic Mathematics & Behavioral Formulas**:
  `references/mathematics.md` _Read when coding passive desire decay, circadian
  $M\_{\text{tod}}$ factors, squared urgency rankings, sleep debt dynamics,
  zero-LLM encounter probability rolls, or task settlement ratios._

- **OpenClaw Primitives Mapping**: `references/primitives_mapping.md` _Read when
  working with OpenClaw sessions (`:tasks`, `:thoughts`, `:chat:*`), Taskman
  autonomous scheduling, context engine hooks (`assemble`), or `memory-core`
  integrations._

- **Implementation Phases & Automated Testing Specifications**:
  `references/phases_and_testing.md` _Read when building deliverables across
  Phases 0–5 or writing automated Vitest verification suites._

---

## 6. Development & Coding Rules

- **Zero-Build Local Plugins**: Engine plugins live directly under `plugins/` in
  TypeScript. OpenClaw loads `src/index.ts` natively via its Jiti runtime loader
  (`openclaw.extensions: ["./src/index.ts"]`). **Never introduce a manual
  compilation or `npm run build` step during local development.**
- **Strict TypeScript**: Never use `any` or loose type assertions
  (`as unknown as T` without documented justification).
- **Atomic File Writes**: Never write directly to live Markdown state files.
  Always write to a temporary file in the same filesystem directory and
  atomically rename (`rename(tmp, target)`) to prevent corruption.
- **Zero Database Migrations**: State lives in Markdown frontmatter and session
  JSONL streams. Do not introduce SQL tables or migration files.
- **Automated Testing**: Test all state parsers, desire decay math, and
  scheduler logic directly with Vitest against `.ts` files in milliseconds.
- **Formatting**: Run `npm run format` (prettier) and `npm run lint` on all code
  and skill files before committing.
