---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw. Always trigger this skill whenever
  designing, building, modifying, or testing Kazusa plugins (sim-harness,
  sim-context-engine), simulation tools, desire homeostasis engines,
  multi-stream context engines, shared agent skills, world state schemas,
  presence indexes, or multi-agent event/pacing lifecycles.
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
     market_) and dynamically schedule their next heartbeat for
     $t_{\text{now}} + D$ via OpenClaw automation dynamic pacing (`next_check`).
   - The agent is not invoked again until that task concludes—_unless_
     pre-empted by an external interrupt (alarm, inbound message, or spatial
     encounter).
2. **Grounded World State ("Prose is Never a Fact")**:
   - Characters cannot hallucinate completing tasks, moving across town, or
     altering relationship scores simply by generating prose.
   - Every movement, activity lease, and social update must be committed via
     deterministic tool calls.
3. **100% File- & Session-Native Transparency**:
   - All state—desires, locations, leases, goals, impressions, and world
     maps—lives in human-readable Markdown files with YAML frontmatter or native
     OpenClaw Sessions. Zero custom SQLite tables or hidden database mirrors.

---

## 2. The 5 Non-Negotiable Invariants

Every plugin, tool, skill, and script in Kazusa must strictly adhere to these
five invariants:

### 2.1 Zero Storage Redundancy (File- & Session-First)

Never store state in two places. No SQLite databases mirroring Markdown files.
Structured state lives in file **YAML frontmatter** (`--- ... ---`); qualitative
context lives in Markdown bodies; chronological logs live in **OpenClaw
Sessions**.

### 2.2 Prose is Never a World Fact

Prose output changes nothing in the world simulation. Only tool calls
(`start_activity`, `start_transit`, `set_alarm`, `conclude_conversation`) mutate
`MEMORY.md` frontmatter or append to stream sessions.

### 2.3 Start-Then-Settle Task Leases

Starting an activity only creates an `IN_PROGRESS` lease in `MEMORY.md`
frontmatter and schedules the next wake-up. Desire rewards and outcomes are
settled **only** when the task concludes or is interrupted, scaled strictly by
actual elapsed time: $\Delta t_{\text{elapsed}} / \Delta t_{\text{planned}}$.

### 2.4 Deterministic Math in Code, Semantics in the LLM

- **In Code (0 tokens, < 1 ms)**: Passive desire decay over time, circadian
  multipliers, sleep debt accumulation, squared urgency ranking, presence
  tracking, and zero-LLM encounter probability rolls.
- **In the LLM**: Deducing goals from qualitative feelings, judging travel time
  from terrain/distance descriptions, pre-imagining candidate options, and
  generating authentic dialogue.

### 2.5 Variable-Horizon Event-Driven Pacing

Agents never poll on fixed intervals. Every task or transit schedules the next
heartbeat at $t_{\text{now}} + D$. When interrupted, agents receive full context
regarding the interrupted task to decide whether to resume, reschedule, or
cancel.

---

## 3. Storage Map & Folder Structure

All paths are relative to `apps/kazusa/` (or repository root):

```text
apps/kazusa/
├── openclaw.json                       # Clean committed framework configuration
├── openclaw.local.json                 # Local overlay for test agents & dev settings (GIT-IGNORED)
├── package.json                        # @openrp-ai/kazusa with local openclaw dependency
├── plugins/                            # Native OpenClaw TypeScript plugins (ZERO BUILD STEP)
│   ├── sim-harness/                    # Simulation tools, file state, math, scheduler & encounter gate
│   │   ├── openclaw.plugin.json
│   │   ├── package.json                # Declares "openclaw": { "extensions": ["./src/index.ts"] }
│   │   ├── src/
│   │   │   ├── clock.ts                # SimClock (real-time and accelerated time)
│   │   │   ├── frontmatter.ts          # Atomic YAML frontmatter + Markdown reader/writer
│   │   │   ├── desires.ts              # Deterministic decay & D2A qualitative rubric
│   │   │   ├── world-index.ts          # In-memory location presence index derived from MEMORY.md
│   │   │   ├── tasks-and-transit.ts    # Task leases, LLM transit judgment, pause/resume
│   │   │   ├── social-tools.ts         # conclude_conversation & relationship mutators
│   │   │   ├── wiki-tools.ts           # Dual-scope wiki_search, wiki_get, wiki_apply tools
│   │   │   ├── scheduler-wake.ts       # Dynamic heartbeat pacing & session wake triggers
│   │   │   ├── encounter-gate.ts       # Zero-LLM encounter probability roll
│   │   │   └── index.ts                # Main plugin registration entry point
│   │   └── test/                       # Vitest unit test suites
│   └── sim-context-engine/             # Custom Context Engine (plugins.slots.contextEngine)
│       ├── openclaw.plugin.json
│       ├── package.json
│       ├── src/
│       │   └── index.ts                # 3-tier retrieval (sensory shock, social salience, stream tails)
│       └── test/
├── shared/
│   ├── wiki/                           # 1. WORLD WIKI: Objective ground truth & canon facts
│   │   ├── entities/
│   │   │   ├── places/<place_id>.md    # Locations, connections, distances, status, amenities
│   │   │   └── characters/<char_id>.md # Complete world character roster (100+ canon characters/NPCs)
│   │   ├── concepts/<topic>.md         # Canonical history, world rules, town laws, public records
│   │   └── reports/                    # Global compiled dashboards (relationship graph, directory)
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral workflows across all agents
├── workspaces/<agent_id>/              # Local active agent workspaces (active simulated subset)
│   ├── SOUL.md                         # Static personality, voice, and core values
│   ├── IDENTITY.md                     # Static bio + YAML desire targets & decay rates
│   ├── MEMORY.md                       # Always-injected hot state (frontmatter + body)
│   ├── memory/
│   │   └── YYYY-MM-DD.md               # Cold daily distilled summaries (vector indexed by memory-core)
│   └── wiki/                           # 2. PERSONAL WIKI: Subjective beliefs & impressions
│       ├── entities/
│       │   ├── characters/<peer_id>.md # Subjective impressions, trust, familiarity, secrets
│       │   └── places/<place_id>.md    # Subjective memory of places (favorite spots, observed state)
│       ├── concepts/<concept_id>.md    # Subjective beliefs, theories, claims with evidence
│       ├── syntheses/                  # Long-term character arc summaries
│       └── reports/                    # Personal contradiction detection & open questions
└── .state/                             # Runtime cache (GIT-IGNORED)
```

---

## 4. Key Deliverables Architecture (Zero-Build Plugins)

Kazusa is built entirely as **direct TypeScript plugins** loaded via OpenClaw's
native `plugins.load.paths` mechanism, structured around the **Dual-Wiki
Model**:

1. **`plugins/sim-harness`**:
   - **File State Engine**: Atomic YAML frontmatter + Markdown parser and writer
     (`write-then-rename`) in `frontmatter.ts`.
   - **Presence Tracker**: In-memory `WorldIndex` tracking agent locations by
     watching `MEMORY.md` headers.
   - **Desire & Homeostasis Engine**: Passive decay math, circadian multipliers
     ($M_{\text{tod}}$), sleep debt accumulation, squared urgency ranking, and
     D2A qualitative rubric renderer in `desires.ts`.
   - **Simulation Tools**: Registered agent tools (`start_activity`,
     `start_transit`, `conclude_activity`, `record_thought`,
     `conclude_conversation`).
   - **Dual-Scope Wiki Tools**: Registered agent tools (`wiki_search`,
     `wiki_get`, `wiki_apply`) operating under the Epistemic Hierarchy (Personal
     Subjective Beliefs $\rightarrow$ World Objective Facts).
   - **Scheduler & Encounter Gate**: Dynamic heartbeat pacing hook
     (`next_check`), auto-arrival on transit expiration, and the zero-LLM
     encounter probability roll.
2. **`plugins/sim-context-engine`**:
   - Custom OpenClaw Context Engine (`plugins.slots.contextEngine`).
   - Hooks into `assemble()` before model turns implementing the **3-Tier
     Retrieval Pipeline**:
     - **Tier 1 (Eager Spatial Perception & Sensory Shock)**: Compares current
       location in `World Wiki` (`shared/wiki/entities/places/`) with the
       agent's `Personal Wiki` memory of that location. Automatically injects
       sensory perception notes when world state changed while the agent was
       absent (e.g. destroyed supermarket, closed school).
     - **Tier 2 (Eager Social Salience)**: Injects `## Quick Impression` from
       `workspaces/<id>/wiki/entities/characters/<peer>.md` for co-present
       characters (top-3 salience ranking in crowds).
     - **Tier 3 (Session Stream Tails)**: Merges recent events from
       `agent:<id>:actions` and `agent:<id>:thoughts`.
3. **The Dual-Wiki Epistemic System**:
   - **Objective World Wiki (`shared/wiki/`)**: Ground truth seeded by content
     creators. Holds all places, characters (the entire 100+ roster), and
     canonical concepts (lore, world rules, history). Characters that are not
     active simulated agents exist here as canonical background NPCs. Physical
     changes occur only via deterministic world events or completed tool leases.
   - **Subjective Personal Wiki (`workspaces/<agent_id>/wiki/`)**: Owned by
     active simulated agents. Tracks subjective impressions of characters and
     places, personal concepts as claims with evidence, contradictions, and arc
     syntheses.
4. **Shared Behavioral Skills (`shared/skills/`)**:
   - `sim-heartbeat-planner`: Settle $\rightarrow$ Orient $\rightarrow$ 3-Option
     Pre-Imagine $\rightarrow$ Commit cycle.
   - `sim-social-interaction`: Natural dialogue management, quick impressions,
     and clean conversational exits.
   - `sim-nightly-reflection`: Nightly sleep distillation, memory archiving, and
     subjective wiki claim consolidation.
5. **World Importer Script (`scripts/import-world.ts`)**:
   - CLI script bootstrapping `shared/wiki/` (places, characters, concepts) and
     active agent `workspaces/` from OpenRP world definitions.

### 4.1 The `plugins/` Folder Zero-Build Philosophy

In contrast to monorepo architectures requiring compilation pipelines
(`tsc --build`, `tsup`) that delay developer iteration, Kazusa places all engine
logic directly in `plugins/`:

- **Direct TypeScript Execution**: OpenClaw executes `./src/index.ts` directly
  via its runtime TypeScript loader (Jiti/tsx) declared in `package.json`
  (`"openclaw": { "extensions": ["./src/index.ts"] }`).
- **Clean Configuration**: Registered in `openclaw.json` via
  `plugins.load.paths: ["./plugins/sim-harness", "./plugins/sim-context-engine"]`.
- **Zero-Build Editing**: Any code edit to a TypeScript file takes effect
  immediately on the next heartbeat or event without compilation artifacts,
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
  working with OpenClaw sessions (`:actions`, `:thoughts`, `:chat:*`),
  automations (`next_check`), context engine hooks (`assemble`), or
  `memory-core` integrations._

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
