---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw. Always trigger this skill whenever
  designing, building, modifying, or testing Kazusa plugins (sim-harness,
  sim-context-engine, sim-file-state), simulation tools, desire homeostasis
  engines, multi-stream context engines, shared agent skills, world state
  schemas, presence indexes, or multi-agent event/pacing lifecycles.
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

All paths are relative to `apps/kazusa/` (or monorepo root):

```text
apps/kazusa/
├── openclaw.json                       # Gateway config (omits per-agent AGENTS.md)
├── package.json                        # @openrp-ai/kazusa with local openclaw dependency
├── shared/
│   ├── locations/<location_id>.md      # Read-only world locations, connections & distances
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral workflows across all agents
├── workspaces/<agent_id>/
│   ├── SOUL.md                         # Static personality, voice, and core values
│   ├── IDENTITY.md                     # Static bio + YAML desire targets & decay rates
│   ├── MEMORY.md                       # Always-injected hot state (frontmatter + body)
│   └── memory/
│       ├── YYYY-MM-DD.md               # Cold daily distilled summaries (vector indexed)
│       └── relationships/<peer_id>.md  # Per-person social graph (Impression + Log)
└── .state/                             # Runtime cache (GIT-IGNORED)
```

---

## 4. Key Deliverables Architecture

The Kazusa implementation is divided into modular packages and plugins:

1. **`packages/sim-file-state`**:
   - Atomic YAML frontmatter + Markdown parser and writer (`write-then-rename`).
   - `WorldIndex`: In-memory presence tracker derived by watching `MEMORY.md`
     files.
   - Deterministic desire decay engine, circadian math, sleep debt, and D2A
     qualitative rubric renderer.
2. **`plugins/sim-context-engine`**:
   - Custom OpenClaw Context Engine (`plugins.slots.contextEngine`).
   - Merges recent `:actions` and `:thoughts` session tails, current location
     setting facts, co-present agents, and adaptive relationship impressions
     into each prompt.
3. **`plugins/sim-harness`**:
   - Task & transit lease tools (`start_activity`, `start_transit`,
     `conclude_activity`, `record_thought`).
   - Dynamic heartbeat pacing (`next_check`) and immediate interrupt triggers
     (`openclaw system event --mode now`).
   - Zero-LLM Encounter Gate evaluating encounter rolls between co-located or
     co-commuting agents.
4. **Shared Behavioral Skills (`shared/skills/`)**:
   - `sim-heartbeat-planner`: Settle $\rightarrow$ Orient $\rightarrow$ 3-Option
     Pre-Imagine $\rightarrow$ Commit cycle.
   - `sim-social-interaction`: Natural dialogue management, quick impressions,
     and clean conversational exits.
   - `sim-nightly-reflection`: Nightly sleep distillation, memory archiving, and
     plan generation.
5. **World Importer Script**:
   - CLI script bootstrapping `workspaces/`, `shared/locations/`, and
     `openclaw.json` directly from OpenRP world definitions.

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

- **Strict TypeScript**: Never use `any` or loose type assertions
  (`as unknown as T` without documented justification).
- **Atomic File Writes**: Never write directly to live Markdown state files.
  Always write to a temporary file in the same filesystem directory and
  atomically rename (`rename(tmp, target)`) to prevent corruption.
- **Zero Database Migrations**: State lives in Markdown frontmatter and session
  JSONL streams. Do not introduce SQL tables or migration files.
- **Formatting**: Run `npm run format` (prettier) and `npm run lint` on all code
  and skill files before committing.
