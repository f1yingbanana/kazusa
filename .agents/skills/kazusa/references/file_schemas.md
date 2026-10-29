# Kazusa File Schemas & State Contracts

This document specifies the exact byte-level contracts and schema specifications
for all Markdown state files, YAML frontmatter blocks, and configuration entries
in Kazusa.

---

## 1. Static Identity & Traits (`<workspace>/IDENTITY.md`)

- **Location**: `<workspace>/IDENTITY.md`
- **Purpose**: Defines static character bio and occupational context. Desire
  state and per-character drain live in the `"desires"` keyed store, never in
  Markdown.
- **Access**: Read by OpenClaw bootstrap. Written once during world generation /
  import.

```markdown
---
agent_id: alice
name: Alice Lin
occupation: Music Theory Student
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
- `avatarUrl` (string, optional): Explicit avatar URL override. Normally
  omitted: drop `avatar.{webp,png,jpg,jpeg,gif,avif}` in the workspace root and
  the plugin serves it at `/kazusa/avatar?id=<agent_id>&v=<mtime>`.

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
  - `namespace: "desires"` (`DesireRecord`): One record per `agentId` (see
    below).
  - `namespace: "location"` (`LocationRecord`): One record per character or
    player id: where they are and any trip in progress (see below).
- **Decoupling Architecture**:
  - Active tasks are stored directly in the plugin database and streamed to
    `agent:<agentId>:tasks`.
  - Position is managed by `src/location/` in the `"location"` store; the map
    itself is World Wiki places (§3.1).
  - Desires are managed by `src/desires/` in the `"desires"` store
    ([mathematics](mathematics.md) §1).
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

### Desire Record Schema

```typescript
interface DesireRecord {
  /** Sim time (epoch ms) at which `levels` were computed exactly. */
  anchorAt: number;
  /** Levels 0..100 at `anchorAt`, keyed by catalog desire name. */
  levels: Record<string, number>;
  /** The current task's effects; each applies from anchorAt until `until`. */
  effects?: {
    taskId: string;
    until: number;
    byDesire: Record<string, { target: number; rate: number }>; // rate: points/hour
  };
  /** Sparse per-character drain overrides (points/hour), keyed by name. */
  drain: Record<string, number>;
}
```

A catalog desire missing from `levels` starts at the configured `initial`
state's `level`; names no longer in the catalog are dropped on the next write.

### Location Record Schema

```typescript
interface LocationRecord {
  /** Where they are, or where the current trip started. */
  placeId: string;
  /** Sim ms when they got there. */
  since: number;
  /** Present from a trip's start until it is settled. */
  trip?: {
    taskId: string;
    purpose?: { description: string; minutes: number }; // walking over: what for
    to: string;
    departAt: number;
    arriveAt: number; // = the lease's endAt (walking over checks in on arrival)
    legs: { placeId: string; at: number }[]; // every place passed, origin first
    usualMinutes: number;
  };
  /** People noticed since arriving here (sightings); cleared on moving. */
  noticed?: string[];
}
```

A participant with no record is at the `home` on their world character card.
Position is a pure function of sim time; the record changes only through task
transitions, deadline settlement and the operator `location.place` RPC.

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
- **Purpose**: Shared, objective physical setting facts and the map's topology.
  Read once by `src/location/` at registration (a canon edit needs a Gateway
  restart) and validated as one connected graph.
- **Topology**: `parent` makes a tree of areas; every place, area or not, is
  somewhere to stand (an area means its open space). Each child links to its
  parent by walking `entry_minutes`. `connections` add two-way edges between any
  two places, declared once on either page; the first of `ways` is the usual
  one, and `by: walk` reads as on foot.

```markdown
---
pageType: entity
entityType: place
id: entity.place.sweets_club_room
place_id: sweets_club_room
name: Sweets Club Room
parent: west_annex
summary:
  "Sunlit room that smells of vanilla; long table, oven, a fridge of milk
  cartons."
entry_minutes: 1
connections:
  - to: trinity_dorm
    ways:
      - { by: walk, minutes: 10 }
      - { by: bike, minutes: 4 }
    note: "Paved path through the residential gardens."
---

# Sweets Club Room

A charming, sunlit room in the West Annex, claimed and redecorated by the
After-School Sweets Club.
```

### Field Specifications

- `place_id` (string, required): `^[a-z0-9][a-z0-9_-]*$`, unique; the id
  characters use in `where`.
- `name` (string, required): Display name, used in speech and situations.
- `parent` (place id, optional): The area this place is inside; absent at top
  level.
- `summary` (string, required): One sentence shown in **Where you are**.
- Body: the full description, shown to a character the first time they are
  there (until they have a card for the place).
- `entry_minutes` (number ≥ 0, default 1): Walking minutes to the parent's open
  space.
- `aliases` (strings, default `[]`): Other names people use; `where` resolves
  ids, names and aliases.
- There are no ownership, visibility or crowd flags. Whose a place is, how it
  is kept, whether it is tucked away and how busy it gets belong in the body;
  every entry is judged by the decision model with that description as
  evidence (`location-judgment` skill).
- `connections` (default `[]`): `{ to, ways: [{ by, minutes }], note? }`.
- `status` and opening hours are not yet part of the schema.

### 3.2 Canonical World Character Roster (`shared/wiki/entities/characters/<character_id>.md`)

- **Location**: `shared/wiki/entities/characters/<character_id>.md`
- **Purpose**: Canonical definition of all characters in the world (e.g. 100+
  students, citizens, shopkeepers).
- **Simulation Mapping**:
  - **Active Simulated Agents**: Have a workspace in `workspaces/<id>/` and an
    entry in `openclaw.json`.
  - **Human Players (`user:`)**: Represented with `character_id: user:<id>`
    (e.g. `user:sensei`) and `is_simulated_agent: false`. They participate
    directly in in-world chats through client interfaces without consuming
    runner processes.
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
home: schale_office # where they are until they first move
---

# Sensei

The advisor appointed to lead the Federal Investigation Club SCHALE and mentor
to students across Kivotos. Stationed at the SCHALE Central Office.
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
  (e.g. `bob`) or a human player identifier with the `user:` prefix (e.g.
  `user:sensei`).
- `name` (string, required): Full display name (e.g. `Bob Moreno`).
- `relation_type` (string, required): Qualitative relationship label
  (`close_friend`, `friend`, `classmate`, `acquaintance`, `rival`, `mentor`,
  `stranger`).
- `summary` (string, required): A concise, 1-line description of who this peer
  is to this character (under 120 characters). The Context Engine extracts this
  directly to build the **Eager Compact Contact Roster** in the prompt:
  `- <name> (@<peer_id>, <relation_type>): <summary> [chat:direct:<peer_id>]`.
- `familiarity` (number 0..100): Quantitative depth of shared history.
- `affinity` (number 0..100): Emotional warmth / liking.
- `trust` (number 0..100): Perceived reliability and honesty.
- `last_interaction_iso` (ISO 8601 string): Timestamp of latest interaction.

### Agent Personal Wiki Maintenance Contract

Characters own and update their own subjective Personal Wiki:

1. **First Encounters**: When an agent meets an unfamiliar character or
   exchanges contact info, they initialize a new card at
   `workspaces/<id>/wiki/entities/characters/<peer_id>.md` with initial
   `summary`, `relation_type: acquaintance`, and an initial
   `## Quick Impression`.
2. **Social Evolution & Reflection**: During conversations or during nightly
   sleep reflection, agents update the card:
   - Adjust `summary` and `relation_type` as their dynamic evolves.
   - Re-calibrate `affinity`, `trust`, and `familiarity`.
   - Update `## Quick Impression` to reflect current sentiment and open
     conversational threads.
   - Append date-stamped summaries to `## Interaction Log`.
3. **Tool Grounding**: Agents perform these updates via deterministic wiki tools
   (`wiki_update_entity` / `wiki_patch`), maintaining markdown integrity.

### 4.2 Subjective Place Cards (`workspaces/<id>/wiki/entities/places/<place_id>.md`)

- **Purpose**: The character's mental map. Only places they know reach their
  prompt (**Places you know**); the world wiki is never shown whole.
- **Created** as a frontmatter-only stub by `src/location/` once the character
  moves on from a place they had no card for (they have seen its whole
  description by then); atomic, never overwriting a card they wrote first. The
  character, or sleep consolidation, adds what they make of it. Cards for
  places heard of carry `learned: told by <id>`. Known places are exactly these
  cards.

```markdown
---
pageType: entity
entityType: place
place_id: trinity_patisserie
name: Pâtisserie de Trinity
aliases: [the patisserie]
learned: been there # or "told by airi-kurimura", "looked it up"
first_visited_iso: "2026-10-27T16:14:00.000Z"
---

Airi always takes the window table. The strawberry tart sells out by four.
```

### 4.3 Subjective Beliefs & Concepts (`workspaces/<id>/wiki/concepts/<concept_id>.md`)

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
    "allow": ["kazusa"],
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

### Character Workspace Invariant: Strict Ban on `AGENTS.md`

- **STRICT INVARIANT: Never create or place `AGENTS.md` inside any character
  workspace (`workspaces/<agent_id>/`).**
- In OpenClaw, any `AGENTS.md` in a workspace is automatically loaded into the
  agent's system prompt by default. In Kazusa, all behavioral guidance,
  simulation time conventions, task lifecycle management, and interrupt
  protocols are dynamically injected as skills via the Context Engine
  (`shared/skills/*`).
- Placing an `AGENTS.md` in a character workspace leads to redundant
  double-injection, instructions drifting out of sync across characters, wasted
  token budget, and breaking the simulation harness. Character workspaces must
  strictly contain only persona/identity files (`SOUL.md`, `IDENTITY.md`),
  reflections (`MEMORY.md`), memories (`memory/`), and subjective personal
  beliefs (`wiki/`).
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
  "channels": ["kazusa"],
  "channelConfigs": {
    "kazusa": {
      "label": "Kazusa Brain",
      "description": "In-process admission of perceived stimuli to character brains.",
      "schema": {
        "type": "object",
        "additionalProperties": false
      }
    }
  },
  "kind": "context-engine",
  "name": "Kazusa",
  "description": "Multi-agent world simulation for roleplay."
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
