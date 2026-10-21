---
name: kazusa-architecture
description:
  "Master architecture reference for the Kazusa multi-agent society simulation
  framework built on OpenClaw. Covers the big-picture vision, 5 major system
  components, OpenClaw primitive mappings, 5 core invariants, storage schemas,
  and folder structure. Keep this in context at ALL times when building,
  debugging, or extending the simulation."
---

# Kazusa: OpenClaw Society Simulator — Architecture Reference

> [!IMPORTANT] **Keep this document in context at ALL times when building,
> debugging, or extending the society simulation.** It is the single source of
> truth for vision, component boundaries, storage schemas, and execution
> invariants.

---

## 1. The Big Picture: What We Are Building

We are building a **real-time, high-fidelity multi-agent society simulation** on
top of the **OpenClaw** agent runtime. Each simulated human character is an
autonomous OpenClaw agent living in a shared world: they have distinct
personalities, internal homeostatic desires (energy, hunger, bladder, social,
fun, hygiene), short- and long-term goals, evolving social relationships, and an
objective physical location.

Classical generative-agent simulations (like the 2023 Stanford Smallville paper)
are too slow and expensive for real-time execution because they run a
synchronous LLM loop on every fixed simulation tick (evaluating every
observation and decomposing entire days into 5-minute slices). Our architecture
achieves **real-time speed and high behavioral fidelity** through three core
shifts:

1. **Variable-Horizon Event-Driven Autonomy (Task-Based Heartbeats)**: Instead
   of ticking every agent every few minutes, an agent commits to a coarse
   **Task/Option** of duration D (e.g., _sleep for 10 hours_, _study at the
   library for 60 minutes_, _walk 15 minutes to the grocery store_) and
   schedules its next heartbeat for `t_now + D`. The agent is not called again
   until that task finishes — _unless_ an external interrupt (an alarm ringing,
   a message arriving, or bumping into someone at the same place) wakes the
   agent mid-task.

2. **Grounded World State ("Prose is Never a Fact")**: Characters cannot
   hallucinate completing tasks or teleporting across town just by writing _"I
   went shopping"_ in their summary. Every physical movement, task, and social
   outcome must be committed via a tool call that checks physical preconditions
   and logs a duration-bounded lease.

3. **100% File- & Session-Native Transparency**: Every piece of state — desires,
   locations, plans, relationships, and world maps — lives in human-readable
   Markdown files (with structured YAML frontmatter) or native OpenClaw
   Sessions. Nothing is duplicated across hidden SQLite tables.

---

## 2. The 5 Major System Components

### 2.1 Desire & Planning System (Intrinsic Motivated Goals)

- Tracks each character's numerical desire meters (`0..10`).
- Deterministic plugin code decays desires over elapsed time Δt and translates
  the numbers into natural-language feelings (e.g., _"Exhausted"_).
- The LLM reads these qualitative feelings alongside its **Long-Term Goals** and
  **Today's Plan** (`HARD_BLOCK` fixed commitments vs. `SOFT_GOAL` intentions),
  brainstorms 3 candidate options, pre-imagines their outcomes, and commits to
  the best action.

### 2.2 Spatial World & Grounded Task Ledger

- Models the world as a shared set of objective locations (`dorm_a`,
  `grocery_store`, `school`, `cafe`) with narrative descriptions of connected
  places and distances so the LLM can judge travel times.
- Tracks the character's current `active_task` lease using a
  **Start-Then-Settle** lifecycle: starting a task reserves the time window, and
  rewards/summaries are credited only when the task completes or is interrupted,
  proportional to actual time spent.
- Distinguishes **`EXCLUSIVE` venue tasks** (like _shopping_ or _studying_,
  which pause when interrupted by a chat) from **`KINEMATIC_PARALLEL` transit
  tasks** (like _walking from dorm to school_, where two co-commuting agents can
  chat while their arrival timers keep ticking in parallel). This is up to the
  discretion of the LLM: when interrupted, they can choose to keep the original
  task end time, extend it due to the interruption, or cancel it entirely
  (change of plan).

### 2.3 Three-Tier Memory & Social Graph System

- **Tier 1 — Hot Working Memory**: Always-injected current state (`location`,
  qualitative `desires`, `active_task`, `Long-Term Goals`, and `Today's Plan`).
  These all live in `MEMORY.md`.
- **Tier 2 — Stream Memory**: Three separate chronological streams for recent
  `actions` taken, recent `thoughts`/monologues, and recent `chat` conversations
  across peers.
- **Tier 3 — Cold Archive & Social Graph**: Per-person relationship files
  storing details of impression (one per person, evolves over time) under
  `memory/relationship/<person-id>.md`, plus daily distilled notes written
  during sleep and searched lazily via vector + keyword embeddings.

### 2.4 Context Engine (What the LLM Sees on Each Turn)

Replaces OpenClaw's default single-session history loader. Before any model
turn, it automatically syncs passive desire decay, injects the current
location's file and present agents, pulls the newest tail of the character's
`actions`, `thoughts`, and `chat` streams, and selectively loads relationship
impressions:

- **1-on-1 chats**: Auto-loads the full relationship card for the peer.
- **Group chats / crowded rooms**: Ranks Top 3 most salient people based on
  relationship scores (absolute) and expands only those cards.

### 2.5 Task Scheduler (Variable Heartbeat) & Reactive Interrupt Router

- **Scheduled Wakes**: Dynamically schedules each character's next heartbeat
  based on the duration of their current task/transit or their next armed alarm.
- **Reactive Wakes**: Immediately interrupts or queues an agent's session when
  they receive a message, when an alarm fires, or when a **Zero-LLM Encounter
  Roll** (1% chance for strangers, high chance for close friends) triggers
  because two characters occupy the same location or transit corridor.

---

## 3. Mapping to OpenClaw Primitives

Every simulation component maps directly onto a native OpenClaw primitive:

| Simulation Component                 | OpenClaw Primitive                                                                       | How We Use It                                                                                                                                                                                                                                            |
| :----------------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared Agent Harness**             | Gateway & Multi-Agent Roster (`agents.entries.*`)                                        | Every character is a configured OpenClaw agent with its own workspace directory (`workspaces/<agent_id>/`). We omit per-agent `AGENTS.md` files so all characters share one unified simulation harness.                                                  |
| **Character Persona**                | Workspace `SOUL.md` & `IDENTITY.md`                                                      | OpenClaw loads `SOUL.md` (voice/values) and `IDENTITY.md` (bio) automatically. This is basically a split on the character card.                                                                                                                          |
| **Hot Working State**                | Workspace `MEMORY.md`                                                                    | OpenClaw always injects `MEMORY.md`. Its **YAML frontmatter** holds machine-mutated state (`location`, `desires`, `active_task`, `alarms`), while its **Markdown body** holds rendered qualitative desires, `## Long-Term Goals`, and `## Today's Plan`. |
| **Action, Thought & Chat Streams**   | OpenClaw Sessions (`agent:<id>:task`, `agent:<id>:thought`, `agent:<id>:chat:<chat-id>`) | Dedicated session transcripts as append-only streams: tool calls log to `:task` and `:thought`, while inter-agent messages use `:chat:<peerOrGroup>`.                                                                                                    |
| **Social Graph & Cold Archive**      | Workspace `memory/` Folder + Built-in `memory-core` (`memory_search`, `memory_get`)      | Relationship cards live in `memory/relationship/<peer>.md`. Nightly sleep distills the day into `memory/YYYY-MM-DD.md`. OpenClaw's `memory-core` automatically indexes `memory/*.md` for hybrid vector + keyword retrieval.                              |
| **Objective Physical World**         | Shared Markdown Files (`shared/location/<loc>.md`) + In-Memory `WorldIndex`              | Readable by all agents; frontmatter lists `activities` and `connections` (optional, with distances). `WorldIndex` watches `workspaces/*/MEMORY.md` headers to know who is at each location.                                                              |
| **Cross-Stream Context Injection**   | Custom Context Engine Plugin                                                             | Uses `assemble()` to merge the tails of `:actions`, `:thoughts`, and `:chat:*` sessions with `shared/locations/<loc>.md` and adaptive relationship cards.                                                                                                |
| **Variable Heartbeats & Interrupts** | OpenClaw Automations (`next_check`) + `system event --mode now` + `sessions_send`        | Paced automation jobs let tools set the exact next heartbeat duration via `next_check`. Alarms and spatial encounters wake sessions immediately via `system event --mode now`.                                                                           |
| **Behavioral Workflows**             | Shared OpenClaw Skills (`shared/skills/*/SKILL.md`)                                      | SKILLs teach the LLM how to settle tasks, use tools, exit chats cleanly, and distill daily logs before sleep.                                                                                                                                            |

---

## 4. The 5 Core Architectural Invariants

These are **non-negotiable constraints**. Every plugin, skill, and tool must
respect all five at all times:

### 4.1 Zero Storage Redundancy (File- & Session-First)

- Never store the same state in two places (no custom SQLite tables mirroring
  Markdown files).
- Prefer human-readable Markdown files with **YAML frontmatter** for structured
  state and **OpenClaw Sessions** for chronological event streams.

### 4.2 Prose is Never a World Fact

- An LLM writing _"I walked to the store and bought groceries"_ in chat/prose
  changes nothing in the simulation.
- Only tool calls (`start_transit`, `start_task`, `set_alarm`) mutate
  `MEMORY.md` or append to stream sessions.

### 4.3 Start-Then-Settle Task Leases

- Starting a task (`start_task`) only creates an `IN_PROGRESS` lease in
  `MEMORY.md` frontmatter and schedules the next wake-up.
- Desire recovery and task outcomes are settled **only** when the task concludes
  or is interrupted, scaled by actual elapsed time `Δt_elapsed / Δt_planned`.

### 4.4 Deterministic Math in Code, Semantics in the LLM

- **Code (0 tokens, <1 ms)**: Passive desire decay over time, urgency ranking,
  co-location indexing, stranger/friend encounter probability rolls, transit
  arrival flips, and conversation turn/repetition caps.
- **LLM**: Deducing short/long-term goals from qualitative desires, judging
  travel duration from location descriptions, brainstorming & pre-imagining
  candidate options, and generating dialogue/reflections.

### 4.5 Variable-Horizon Event-Driven Pacing

- Agents do not run on fixed polling ticks. Every started task or transit
  dynamically schedules the agent's next heartbeat at the last turn with
  `now + duration_min`, pre-emptible at any moment by an inbound message, alarm,
  or spatial encounter.
- When interrupted, agents should have enough information about the task to
  assess whether they should continue what they were doing, delay the task due
  to the interruption, or cancel it altogether.

---

## 5. Canonical Storage Map & Folder Structure

All paths below are relative to `apps/kazusa/`:

```text
apps/kazusa/
├── shared/
│   ├── location/<location_id>.md       # Shared read-only world locations & connections
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral skills (no per-agent AGENTS.md)
├── workspaces/<agent_id>/
│   ├── SOUL.md                         # Static personality, voice, core values
│   ├── IDENTITY.md                     # Static bio (character card split)
│   ├── MEMORY.md                       # Always-injected hot state (YAML frontmatter + Markdown body)
│   └── memory/
│       ├── YYYY-MM-DD.md               # Cold daily summaries distilled during sleep (vector-indexed)
│       └── relationship/<peer_id>.md   # Per-person social graph node (YAML + Impression + Log)
├── openclaw.json                       # Gateway & agent configuration
├── package.json                        # @openrp-ai/kazusa with local openclaw dependency
└── .state/                             # Runtime state (GIT-IGNORED)
```

---

## 6. Implementation Deliverables

The simulation framework consists of:

1. **Core Plugins** (under `packages/`):
   - **`sim-harness`**: Simulation tools (`start_task`, `start_transit`,
     `set_alarm`, `record_thought`), lifecycle hooks (desire decay, transit
     arrival, anti-hallucination guards), and the `WorldIndex` presence tracker.
   - **`sim-context-engine`**: Custom Context Engine plugin
     (`plugins.slots.contextEngine`) that assembles cross-session streams,
     location context, and adaptive relationship cards before every prompt.

2. **Shared Skills** (under `apps/kazusa/shared/skills/`):
   - **`sim-heartbeat-planner`**: Teaches the LLM the settle → orient → propose
     → commit heartbeat loop with the 3-option pre-imagination pattern.
   - **`sim-social-interaction`**: Teaches the LLM how to engage in and cleanly
     exit conversations, updating relationship impressions.
   - **`sim-nightly-reflection`**: Teaches the LLM how to distill the day's
     streams into `memory/YYYY-MM-DD.md`, update long-term goals, and plan
     tomorrow before sleep.

3. **Import Script**: A script that populates `workspaces/`, `shared/location/`,
   and `openclaw.json` agent entries from an OpenRP world definition, enabling
   rapid world bootstrapping.
