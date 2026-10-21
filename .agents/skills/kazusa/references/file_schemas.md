# Kazusa File Schemas & State Contracts

This document specifies the exact byte-level contracts and schema specifications
for all Markdown state files, YAML frontmatter blocks, and configuration entries
in Kazusa.

---

## 1. Static Identity & Traits (`<workspace>/IDENTITY.md`)

- **Location**: `<workspace>/IDENTITY.md`
- **Purpose**: Defines static character bio, occupational context, desire
  baselines, and individual decay constants.
- **Access**: Read by OpenClaw bootstrap & Desire Engine. Written once during
  world generation / import.

```markdown
---
agent_id: alice
name: Alice Lin
occupation: Music Theory Student
desire_config:
  sleep_energy: { target: 8.0, decay_per_hour: 0.45 }
  hunger: { target: 7.5, decay_per_hour: 0.60 }
  social_connection: { target: 4.5, decay_per_hour: 0.15 }
  curiosity: { target: 8.0, decay_per_hour: 0.30 }
  recognition: { target: 6.5, decay_per_hour: 0.20 }
  purpose_progress: { target: 8.5, decay_per_hour: 0.40 }
---

# Identity

Alice is a 19-year-old sophomore studying music composition at Oak Hill College.
She is meticulous, passionate about counterpoint, and often gets so absorbed in
manuscript writing that she forgets to eat.
```

### Field Specifications

- `agent_id` (string, required): Canonical identifier matching `openclaw.json`
  entry.
- `name` (string, required): Full display name.
- `occupation` (string, required): Primary role or vocation.
- `desire_config` (object, required): Map of desire keys to
  `{ target: number, decay_per_hour: number }`.
  - `target`: Ideal homeostasis setpoint (`0.0..10.0`).
  - `decay_per_hour`: Natural baseline hourly depletion rate ($\lambda_{i,d}$).

---

## 2. Hot Working State (`<workspace>/MEMORY.md`)

- **Location**: `<workspace>/MEMORY.md`
- **Purpose**: Always injected into LLM context by OpenClaw. **Single Source of
  Truth** for location, desires, active lease, alarms, and goals.
- **Access**: Mutated atomically in-place by simulation tools and pre-turn decay
  hooks.

```markdown
---
agent_id: alice
last_updated_iso: "2026-10-20T14:10:00Z"
location: "grocery_store"
transit_state: null
sleep_debt_min: 45
desires:
  sleep_energy: 6.8
  hunger: 3.2
  social_connection: 4.8
  curiosity: 7.1
  recognition: 5.4
  purpose_progress: 4.0
active_task:
  id: "task_20261020_1400"
  type: "shop_groceries"
  description: "Buying pasta, tomatoes, and coffee beans for the week"
  channel: "EXCLUSIVE"
  location: "grocery_store"
  started_iso: "2026-10-20T14:00:00Z"
  planned_duration_min: 25
  elapsed_min: 10
  remaining_min: 15
  focus_shield: 0.2
  status: "PAUSED"
paused_task: null
alarms:
  - id: "alm_01"
    fire_at_iso: "2026-10-21T08:00:00Z"
    label: "Wake up for 9 AM Counterpoint lecture"
    status: "ARMED"
---

## Current State & Desires

- **Location**: Willow Market & Grocery (`grocery_store`)
- **Active Task**: Shopping for groceries (PAUSED — 10 min completed, 15 min
  remaining)
- **[HIGH URGENCY] Hunger**: Hungry; your stomach is growling and you want a
  proper meal soon.
- **[MODERATE URGENCY] Purpose & Progress**: Falling behind; you haven't worked
  on your composition assignment yet today.
- **Sleep & Energy**: Rested enough to focus, though carrying 45 minutes of
  lingering sleep debt.
- **Social Connection**: Content; your recent chat satisfied your need for
  company.

## Long-Term Goals

- Finish the three-movement string quartet before Friday's studio critique.
- Find out why Bob had a heated argument with Sam at the pharmacy.

## Today's Plan

- **[HARD_BLOCK] 16:00 - 17:30**: Counterpoint Seminar at `school`
- **[SOFT_GOAL]**: Finish buying groceries at `grocery_store` (15 min remaining)
- **[SOFT_GOAL]**: Draft 16 bars of the quartet second movement at `dorm_a`
```

### Frontmatter Specifications

- `agent_id` (string, required): Agent ID.
- `last_updated_iso` (ISO 8601 string): Timestamp of last desire decay / state
  mutation.
- `location` (string, required): ID of current location (matches
  `shared/locations/<id>.md`).
- `transit_state` (object | null): If actively in transit,
  `{ from, to, corridor, started_iso, arrival_iso, duration_min }`. When `null`,
  agent is static at `location`.
- `sleep_debt_min` (number, integer): Accumulated sleep debt in minutes.
- `desires` (object, required): Current numerical meters (`0.0..10.0`).
- `active_task` (object | null):
  - `id`: Unique task lease identifier.
  - `type`: Short category string (e.g. `shop_groceries`, `study_counterpoint`,
    `sleep`).
  - `description`: Qualitative summary of what character is doing.
  - `channel`: `"EXCLUSIVE"` (venue task; pauses on chat) or
    `"KINEMATIC_PARALLEL"` (transit; allows parallel chat while movement timer
    runs).
  - `location`: Location ID where task occurs.
  - `started_iso`: Timestamp task began.
  - `planned_duration_min`: Total planned duration.
  - `elapsed_min`: Minutes completed so far.
  - `remaining_min`: Minutes remaining.
  - `focus_shield`: Float `0.0..1.0` indicating resistance to interruptions
    (e.g., 0.9 for sleeping/exam, 0.1 for lounging).
  - `status`: `"IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED"`.
- `paused_task` (object | null): Stores previous task when interrupted by a
  higher-priority task.
- `alarms` (array): List of
  `{ id, fire_at_iso, label, status: "ARMED" | "FIRED" | "DISARMED" }`.

### Markdown Body Specifications

- `## Current State & Desires`: Automatically regenerated by the desire engine
  on every decay/mutation. Formatted in first-person sorted by urgency.
- `## Long-Term Goals`: Maintained and updated by the LLM during nightly sleep
  distillation or milestone moments.
- `## Today's Plan`: Structured schedule containing `[HARD_BLOCK]` (inflexible
  commitments) and `[SOFT_GOAL]` (flexible desires/intentions).

---

## 3. Shared Objective World Map (`shared/locations/<location_id>.md`)

- **Location**: `shared/locations/<location_id>.md`
- **Purpose**: Shared, read-only objective physical setting facts, affordances,
  and connection topology.
- **Access**: Read by all agents via Context Engine.

```markdown
---
location_id: grocery_store
name: Willow Market & Grocery
category: commercial
encounter_modifier: 0.65
allowed_activities: [shop_groceries, browse_items, work_cashier, talk]
connections:
  - to: dorm_a
    distance: "1.2 km slightly uphill along Willow Ave"
    notes:
      "Takes ~18-20 min walking with heavy grocery bags, ~12 min walking light,
      or 5 min by bike/bus."
  - to: cafe
    distance: "250 m across Market Square"
    notes: "A quick 3-4 min walk."
  - to: school
    distance: "900 m via College Path"
    notes: "About 10-12 min on foot."
---

# Setting Description

A busy neighborhood grocery store and pharmacy with narrow aisles, a produce
section by the entrance, and a checkout counter. Fluorescent lighting hums
softly overhead. Fresh fruit crates line the front entryway, and the aroma of
roasted coffee drifts from the bakery aisle.
```

### Frontmatter Specifications

- `location_id` (string, required): Unique location slug.
- `name` (string, required): Human-readable name.
- `category` (string, required): E.g. `commercial`, `residential`, `academic`,
  `recreational`.
- `encounter_modifier` (number, float `0.0..1.0`): Spatial density factor used
  by Encounter Gate.
- `allowed_activities` (string array): Canonical list of activity types
  supported here.
- `connections` (array): Reachable adjacent locations with human-readable
  distance and terrain context so the LLM can deduce travel duration.

---

## 4. Social Graph & Relationship Cards (`<workspace>/memory/relationships/<peer_id>.md`)

- **Location**: `<workspace>/memory/relationships/<peer_id>.md`
- **Purpose**: Two-tier memory model of a single relationship: Tier 1 eager
  summary (`## Quick Impression`) and Tier 2 lazy logs (`## Interaction Log`).
- **Access**: Context Engine injects `## Quick Impression`; OpenClaw
  `memory-core` searches `## Interaction Log`.

```markdown
---
peer_id: bob
name: Bob Moreno
relation_type: close_friend
familiarity: 75
affinity: 62
trust: 70
last_interaction_iso: "2026-10-19T19:45:00Z"
---

## Quick Impression

Bob is my neighbor at Oak Hill Dorm and a fellow music student. He is warm and
talkative, though he procrastinates on assignments.

- **Open Threads**: Promised to lend me his counterpoint textbook before
  Wednesday; seemed worried about his part-time shift at the pharmacy.

## Interaction Log

- **2026-10-19**: Met at Hobbs Cafe; Bob mentioned Tom Moreno is upset about the
  upcoming town council election.
- **2026-10-17**: Collaborated on harmony exercises in the dorm lounge for two
  hours.
```

### Frontmatter Specifications

- `peer_id` (string, required): Peer's agent ID.
- `name` (string, required): Peer's display name.
- `relation_type` (string): E.g. `stranger`, `acquaintance`, `friend`,
  `close_friend`, `rival`.
- `familiarity` (number, integer `0..100`): Crucial input for Zero-LLM Encounter
  Gate ($F_{AB}$).
- `affinity` (number, integer `0..100`): Liking/warmth score.
- `trust` (number, integer `0..100`): Reliability/confidence score.
- `last_interaction_iso` (ISO 8601 string): Timestamp of last conversation.

---

## 5. Cold Daily Summary Archives (`<workspace>/memory/YYYY-MM-DD.md`)

- **Location**: `<workspace>/memory/YYYY-MM-DD.md` (e.g. `memory/2026-10-20.md`)
- **Purpose**: Nightly consolidated reflection written before sleep.
  Automatically indexed by OpenClaw's built-in `memory-core` plugin for hybrid
  vector + keyword semantic search.

```markdown
# Daily Reflection: October 20, 2026

## Summary of the Day

Spent the morning analyzing Bach inventions in the dorm lounge. Ran into Bob at
Willow Market while buying groceries; he seemed preoccupied with financial
issues. Attended afternoon Counterpoint lecture and received valuable feedback
on my quartet exposition.

## Key Insights & Evolving Thoughts

- Bob's stress might be affecting his coursework; I should check in on him
  tomorrow after lunch.
- The cello counter-melody in measure 14 needs a smoother harmonic transition to
  G minor.

## Tomorrow's Priorities

- Complete revised counter-melody draft before 14:00.
- Meet Bob at Hobbs Cafe to return his counterpoint textbook.
```

---

## 6. Gateway & Agent Configuration (`openclaw.json`)

```json
{
  "agents": {
    "ownership": "explicit",
    "defaults": {
      "model": "anthropic/claude-3-7-sonnet",
      "plugins": ["sim-harness", "sim-context-engine"]
    },
    "entries": {
      "main": {},
      "alice": {
        "workspace": "workspaces/alice"
      },
      "bob": {
        "workspace": "workspaces/bob"
      }
    }
  },
  "plugins": {
    "load": {
      "paths": ["./plugins/sim-harness", "./plugins/sim-context-engine"]
    },
    "slots": {
      "contextEngine": "sim-context-engine"
    },
    "entries": {
      "sim-harness": {
        "enabled": true
      },
      "sim-context-engine": {
        "enabled": true
      }
    }
  }
}
```

- Note: Per-agent `AGENTS.md` files are deliberately omitted so all characters
  run on the unified simulation harness.
- Local developer overrides and test rosters are defined in
  `openclaw.local.json` via `"$include": ["./openclaw.json"]` and kept
  git-ignored.

---

## 7. Plugin Manifest & Configuration Contracts (`plugins/*`)

All simulation functionality is implemented as native OpenClaw plugins located
directly in `plugins/`.

### 7.1 Plugin Manifest (`openclaw.plugin.json`)

Each plugin folder contains an `openclaw.plugin.json` file declaring its plugin
metadata, dependencies, and optional configuration schema:

```json
{
  "id": "sim-harness",
  "name": "Kazusa Simulation Harness",
  "description": "Simulation tools, frontmatter state, desires, tasks, and encounter scheduler"
}
```

### 7.2 Plugin Package Manifest (`package.json`)

Each plugin includes a lightweight `package.json` configuring its direct
TypeScript runtime entry point:

```json
{
  "name": "@kazusa/sim-harness",
  "version": "0.1.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./src/index.ts"]
  }
}
```

> [!NOTE] **Zero-Build Runtime Contract**: OpenClaw evaluates TypeScript files
> directly via its embedded Jiti/tsx loader when `openclaw.extensions` points to
> `./src/index.ts`. Local plugins require no build step (`tsc`, `tsup`, or
> `dist/` folders) during development. The official documentation note
> ("Published external plugins should point runtime entries at built JavaScript
> files") applies strictly to published npm packages distributed externally.
