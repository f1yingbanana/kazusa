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

## 2. Working Machine State (OpenClaw Plugin State Stores)

- **Mechanism**: `api.runtime.state.openKeyedStore<T>`
- **Purpose**: High-frequency mechanical state tracking the simulation clock and
  active agent task leases directly in OpenClaw's native state database with
  zero markdown file parsing churn.
- **Namespaces**:
  - `namespace: "clock"` (`ClockPersistedRecord`): Stores simulation clock
    timestamp (`simTime`), speed multiplier (`speed`), and `updatedAt`.
  - `namespace: "tasks"` (`ActiveTask | null`): Stores current active task
    indexed by `agentId`.
- **Decoupling Architecture**:
  - Active tasks are stored directly in the plugin database and streamed to
    `agent:<agentId>:tasks`.
  - Spatial location is managed by the spatial subsystem (`LOCATION.md` / World
    Wiki places).
  - Biological/psychological drives are managed by the homeostasis engine
    (`IDENTITY.md` decay rates / hunger / energy).
  - No `STATE.md` or `TASK.md` file parsing is required.

### Active Task Schema

```typescript
export const activeTaskSchema = z.object({
  /** Unique identifier for the task. */
  id: z.string(),
  /** Task category or type (e.g. 'study', 'reading', 'nap'). */
  type: z.string(),
  /** Natural-language description of what the character is doing. */
  description: z.string(),
  /** Start timestamp in ISO 8601 format. */
  startedAt: z.string(),
  /** Scheduled completion timestamp in ISO 8601 format. */
  endAt: z.string(),
  /** Planned duration in minutes. */
  duration: z.number(),
  /** Optional task-specific metadata. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ActiveTask = z.infer<typeof activeTaskSchema>;
```

### Field Specifications

- `id` (string, required): Unique task execution lease identifier (e.g.
  `task_1729500000000`).
- `type` (string, required): Task category or routine (e.g. `study`, `reading`,
  `nap`).
- `description` (string, required): Natural-language description of current
  task.
- `startedAt` (ISO 8601 string): Timestamp when task began.
- `endAt` (ISO 8601 string): Scheduled completion timestamp.
- `duration` (number): Planned duration in minutes (enforces configured
  `minDuration`).
- `metadata` (object, optional): Arbitrary task metadata dictionary.

---

## 3. Qualitative Reflection & Goals (`<workspace>/MEMORY.md`)

- **Location**: `<workspace>/MEMORY.md`
- **Purpose**: Injected into LLM context by OpenClaw. Contains qualitative
  goals, reflections, and ongoing thoughts—free of high-frequency mechanical
  state churn.
- **Access**: Maintained and updated by the LLM during nightly sleep
  distillation or milestone moments.

```markdown
# Alice's Goals & Reflections

## Long-Term Goals

- Finish the three-movement string quartet before Friday's studio critique.
- Find out why Bob had a heated argument with Sam at the pharmacy.

## Today's Plan

- **[HARD_BLOCK] 16:00 - 17:30**: Counterpoint Seminar at `school`
- **[SOFT_GOAL]**: Practice bass guitar in the music club room
- **[SOFT_GOAL]**: Draft 16 bars of the quartet second movement at
  `trinity_dorm`
```

---

## 3. Shared Objective World Wiki (`shared/wiki/`)

The World Wiki acts as the canonical encyclopedia and physical ground truth of
the simulation.

### 3.1 Objective Places (`shared/wiki/entities/places/<place_id>.md`)

- **Location**: `shared/wiki/entities/places/<place_id>.md`
- **Purpose**: Shared, objective physical setting facts, affordances, and
  connection topology. Mutated only via in-world events or completed task
  leases.
- **Access**: Read by all agents via Context Engine (Tier 1 Spatial Perception &
  Tier 3 Lazy Retrieval).

```markdown
---
pageType: entity
entityType: place
id: entity.place.grocery_store
place_id: grocery_store
name: Willow Market & Grocery
category: commercial
status: OPERATIONAL # or DESTROYED, CLOSED, UNDER_RENOVATION
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

### 3.2 Canonical World Character Roster (`shared/wiki/entities/characters/<character_id>.md`)

- **Location**: `shared/wiki/entities/characters/<character_id>.md`
- **Purpose**: Canonical definition of all characters in the world (e.g. 100+
  students, citizens, shopkeepers).
- **Simulation Mapping**:
  - **Active Simulated Agents**: Have a workspace in `workspaces/<id>/` and an
    entry in `openclaw.json`.
  - **Human Players (`user:`)**: Represented with `character_id: user:<id>` (e.g.
    `user:sensei`) and `is_simulated_agent: false`. They participate directly in
    in-world chats through client interfaces without consuming runner processes.
  - **Background NPCs**: Exist only as World Wiki entity cards. Active agents
    can search for them, talk about them, and reference their canonical bio
    without spawning runner processes.

```markdown
---
pageType: entity
entityType: person
id: entity.character.sensei
character_id: user:sensei
name: Sensei
canonicalId: schale.sensei
aliases: [Teacher, Advisor]
affiliation: Federal Investigation Club SCHALE
role: SCHALE Advisor / Teacher
personality_traits: [patient, empathetic, observant, dedicated]
status: ACTIVE_IN_WORLD
is_simulated_agent: false # Human player
---

# Sensei

The advisor appointed to lead the Federal Investigation Club SCHALE and mentor to
students across Kivotos. Stationed at the SCHALE Central Office.
```

### 3.3 Canonical World Concepts & Lore (`shared/wiki/concepts/<topic_id>.md`)

- **Location**: `shared/wiki/concepts/<topic_id>.md` (e.g.
  `concepts/kivotos_halos.md`, `concepts/town_charter.md`)
- **Purpose**: Objective canonical lore, rules of the world, institutional
  bylaws, and public historical records.
- **Access**: Queried via `wiki_search` / `wiki_get` when agents consult world
  facts or canon rules.

```markdown
---
pageType: concept
conceptType: lore
id: concept.kivotos_halos
title: Halos of Kivotos
aliases: [Halo, Angelic Rings]
lastRefreshedAt: "2026-10-20T00:00:00Z"
claims:
  - id: claim.halo.sleep
    text:
      "Halos disappear when students fall completely unconscious or fall asleep."
    status: supported
    confidence: 1.0
---

# Overview

In Kivotos, all students possess halos above their heads that manifest when
conscious. Halos vary widely in geometric shape, color, and size.
```

---

## 4. Subjective Personal Wiki (`workspaces/<agent_id>/wiki/`)

Each active simulated agent maintains their own subjective worldview, isolated
from other agents.

### 4.1 Subjective Relationship Cards (`workspaces/<id>/wiki/entities/characters/<peer_id>.md`)

- **Location**: `workspaces/<id>/wiki/entities/characters/<peer_id>.md`
- **Purpose**: Two-tier memory model: Tier 1 eager summary
  (`## Quick Impression`) and Tier 2 lazy interaction logs, structured with
  `memory-wiki` edge metadata.
- **Access**: Injected into prompt by Context Engine (Tier 2 Social Salience).

```markdown
---
pageType: entity
entityType: person
id: entity.peer.bob
peer_id: bob
name: Bob Moreno
relation_type: close_friend
summary: "Music student at Oak Hill Dorm and fellow composer."
familiarity: 75
affinity: 62
trust: 70
last_interaction_iso: "2026-10-19T19:45:00Z"
relationships:
  - targetId: entity.character.bob
    targetTitle: Bob Moreno
    kind: close_friend
    weight: 0.75
    confidence: 0.9
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

### Field Specifications

- `peer_id` (string, required): Canonical peer identifier matching an agent ID
  (e.g. `bob`) or a human player identifier with the `user:` prefix (e.g. `user:sensei`).
- `name` (string, required): Full display name (e.g. `Bob Moreno`).
- `relation_type` (string, required): Qualitative relationship label
  (`close_friend`, `friend`, `classmate`, `acquaintance`, `rival`, `mentor`,
  `stranger`).
- `summary` (string, required): A concise, 1-line description of who this peer is
  to this character (under 120 characters). The Context Engine extracts this
  directly to build the **Eager Compact Contact Roster** in the prompt:
  `- <name> (@<peer_id>, <relation_type>): <summary> [chat:direct:<peer_id>]`.
- `familiarity` (number 0..100): Quantitative depth of shared history.
- `affinity` (number 0..100): Emotional warmth / liking.
- `trust` (number 0..100): Perceived reliability and honesty.
- `last_interaction_iso` (ISO 8601 string): Timestamp of latest interaction.

### Agent Personal Wiki Maintenance Contract

Characters own and update their own subjective Personal Wiki:
1. **First Encounters**: When an agent meets an unfamiliar character or exchanges
   contact info, they initialize a new card at
   `workspaces/<id>/wiki/entities/characters/<peer_id>.md` with initial `summary`,
   `relation_type: acquaintance`, and an initial `## Quick Impression`.
2. **Social Evolution & Reflection**: During conversations or during nightly sleep
   reflection, agents update the card:
   - Adjust `summary` and `relation_type` as their dynamic evolves.
   - Re-calibrate `affinity`, `trust`, and `familiarity`.
   - Update `## Quick Impression` to reflect current sentiment and open conversational threads.
   - Append date-stamped summaries to `## Interaction Log`.
3. **Tool Grounding**: Agents perform these updates via deterministic wiki tools
   (`wiki_update_entity` / `wiki_patch`), maintaining markdown integrity.

### 4.2 Subjective Beliefs & Concepts (`workspaces/<id>/wiki/concepts/<concept_id>.md`)

- **Location**: `workspaces/<id>/wiki/concepts/<concept_id>.md` (e.g.
  `concepts/market_vandalism.md`)
- **Purpose**: Tracks unverified personal beliefs, theories, and subjective
  claims with evidence directly under `concepts/`. Evaluated by
  `reports/contradictions.md` when conflicting claims are recorded.

```markdown
---
pageType: concept
conceptType: belief
id: claim.alice.market_vandalism
title: Willow Market Vandalism Theory
status: contested # supported, contested, verified, debunked
confidence: 0.65
claims:
  - id: claim.market.destroyed
    text: "The supermarket was destroyed by a rogue demolition crew last night."
    status: contested
    confidence: 0.65
    evidence:
      - kind: overheard_dialogue
        sourceId: source.chat.bob
        note: "Bob told me he heard sirens near Willow Ave at midnight."
        confidence: 0.7
---

# Reflection Notes

Bob seemed genuinely rattled when he brought it up. Need to walk past Willow Ave
to see if it's true.
```

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
      "plugins": ["kazusa"]
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
      "paths": ["./plugins/kazusa"]
    },
    "entries": {
      "kazusa": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  },
  "messages": {
    "queue": {
      "mode": "steer"
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
  "id": "kazusa",
  "name": "Kazusa Simulation",
  "description": "Simulated time and task scheduling for Kazusa roleplay agents"
}
```

### 7.2 Plugin Package Manifest (`package.json`)

Each plugin includes a lightweight `package.json` configuring its direct
TypeScript runtime entry point:

```json
{
  "name": "@kazusa/plugin",
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
