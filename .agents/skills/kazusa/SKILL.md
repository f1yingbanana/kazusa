---
name: kazusa
description:
  Master architectural guide for developing the Kazusa multi-agent society
  simulation framework on top of OpenClaw (`@openrp-ai/kazusa` and
  `@kazusa/plugin`). Always trigger this skill whenever designing, building,
  modifying, debugging, or testing anything in Kazusa—including the unified
  `@kazusa/plugin` (`src/clock`, `src/taskman`, `src/context-engine`, planned
  `src/perception`), stimulus admission and routing, `agent:ID:brain` steer
  routing, `start_task`/`delay_task` leases, `clock_*` tools and Gateway RPCs,
  the 3-Tier `assemble()` retrieval pipeline, World Wiki (`shared/wiki/`) vs.
  Personal Wiki (`workspaces/ID/wiki/`) schemas, desire homeostasis math, or
  OpenClaw session and cron integrations, even if the user only mentions a
  single module, tool, or character file.
---

# Kazusa: Real-time multi-agent AI world simulator framework for role-play

Kazusa is a real-time, multi-agent society simulation framework built natively
on the **OpenClaw** runtime. Each character is an autonomous OpenClaw agent with
distinct personality traits, homeostatic desires, short- and long-term goals,
subjective beliefs, and an objective physical location in a shared world.

## 1. Core Architectural Pillars

Classical generative-agent simulations poll every agent on a fixed clock tick,
causing runaway token costs, multi-session race conditions, and ungrounded
hallucinations. Kazusa addresses these through six architectural pillars:

1. **Single-Threaded Consciousness (`agent:<id>:brain` with `steer` Queue)**:
   - All admitted stimuli for a character target one OpenClaw execution session:
     `agent:<id>:brain`. Chat and task sessions are ledgers, not competing
     places to think.
   - Steering makes an admitted distraction visible inside an ongoing turn. It
     invites reassessment, not automatic abandonment of earlier intentions.
2. **Variable-Horizon Task Leases (Never Idle, Zero Fixed Polling)**:
   - Characters never poll on fixed intervals and are never idle (sleep,
     waiting, and reflection are tasks too).
   - Agents commit to a task of duration $D$ via `start_task` (or adjust it via
     `delay_task`), which replaces any prior lease, logs the transition to
     `agent:<id>:tasks`, and schedules a wake-up at $t_{\text{now}} + D$ unless
     pre-empted by an interrupt.
3. **Dual-Wiki Epistemology (Objective World vs. Subjective Beliefs)**:
   - **World Wiki (`shared/wiki/`)** stores objective canon facts (locations,
     connections, character roster, public rules).
   - **Personal Wiki (`workspaces/<agent_id>/wiki/`)** stores what a specific
     character believes, remembers, and feels about peers, places, and concepts,
     preventing omniscient context leakage.
4. **Tool-Grounded State ("Prose is Never a Fact")**:
   - Narrative prose never mutates simulation state. Locations, task leases, and
     social transitions change only when the agent invokes deterministic tools
     (`start_task`, `delay_task`, `send_message`).
5. **Deterministic Math in Code, Semantics in the LLM**:
   - Code executes in `< 1 ms` at zero token cost: virtual formula clock
     ($\text{sim\_time} + \Delta t \times \text{speed}$), passive desire decay,
     sleep detection, presence tracking, and encounter probability rolls.
   - The LLM handles qualitative reasoning: deducing goals from feelings,
     estimating travel durations from terrain descriptions, imagining candidate
     actions, and evaluating emotional outcomes.
6. **Perception (Stimulus Routing & Attention Admission; Planned)**:
   - Distinguishes incoming chats, physical encounters, world events, and task
     deadlines. Intercepts incoming media (images), ground-preflights them with
     context engine background, and routes semantic text records to their
     appropriate ledgers and admitted cognitive input to `:brain`.
   - A secondary per-character pending-stimulus queue checks whether the brain
     is busy, then decides whether to wake, steer/distract, or defer. Do not
     blindly enqueue every event into the active generation.
   - Owns this routing policy, not Taskman or the context engine. Taskman will
     submit task-due stimuli; it will still own lease scheduling. Perception is
     documented only; its implementation and starvation policy remain open.

## 2. State Storage & Repository Layout

High-frequency machine state is strictly separated from qualitative Markdown
files so `<workspace>/MEMORY.md` never suffers from mechanical diff churn or
file-parsing overhead.

| State Category              | Canonical Storage Location                                | Purpose & Mutation Rule                                                                                                                                                            |
| :-------------------------- | :-------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine Working State**   | `api.runtime.state.openKeyedStore` (`"clock"`, `"tasks"`) | High-frequency virtual clock state/speed and active task leases. Never store in Markdown.                                                                                          |
| **Cognitive Brain Queue**   | OpenClaw Session `agent:<id>:brain`                       | Single-threaded execution for admitted stimuli; planned Perception gates input before wake/steer.                                                                                  |
| **Stream Ledgers**          | OpenClaw Sessions `agent:<id>:tasks`, dialogues           | Append-only chronological transcripts of settled/started tasks, inner thoughts, and chats.                                                                                         |
| **Agent Identity & Memory** | `workspaces/<id>/{SOUL,IDENTITY,MEMORY}.md` + `memory/`   | Static voice/values (`SOUL.md`), bio & YAML desire parameters (`IDENTITY.md`), qualitative reflections (`MEMORY.md`), and vector-indexed daily summaries (`memory/YYYY-MM-DD.md`). |
| **Objective Canon**         | `shared/wiki/`                                            | Ground-truth places, character roster, world rules, and compiled global reports.                                                                                                   |
| **Subjective Beliefs**      | `workspaces/<id>/wiki/`                                   | Agent-specific impressions of peers/places, personal theories, syntheses, and contradiction reports.                                                                               |

### Directory Map (`apps/kazusa/`)

```text
apps/kazusa/
├── openclaw.json                       # Framework config (plugins.load.paths: ["./plugins/kazusa"])
├── openclaw.local.json                 # Git-ignored local dev/test agent overlay
├── package.json                        # @openrp-ai/kazusa
├── plugins/kazusa/                     # @kazusa/plugin — unified zero-build TypeScript plugin
│   ├── openclaw.plugin.json
│   ├── package.json                    # "openclaw": { "extensions": ["./src/index.ts"] }
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                    # Composes Clock, Taskman, and ContextEngine in-process
│       ├── clock/                      # Formula clock, "clock" store, clock_* tools & RPCs
│       ├── taskman/                    # "tasks" leases, :tasks ledger, cron projection, tools
│       ├── context-engine/             # :brain context, skill marker resolution, assemble()
│       └── perception/                 # PLANNED ONLY: stimulus routing and attention admission
├── shared/
│   ├── wiki/                           # WORLD WIKI (objective truth)
│   │   ├── entities/{places,characters}/<id>.md
│   │   ├── concepts/<topic>.md
│   │   └── reports/
│   └── skills/<skill_name>/SKILL.md    # Shared behavioral workflows resolved via kazusa:skill markers
├── workspaces/<agent_id>/              # Per-agent workspace
│   ├── SOUL.md | IDENTITY.md | MEMORY.md
│   ├── memory/YYYY-MM-DD.md
│   └── wiki/                           # PERSONAL WIKI (subjective beliefs)
│       ├── entities/{characters,places}/<id>.md
│       ├── concepts/<id>.md | syntheses/ | reports/
└── .state/                             # Underlying SQLite backing for OpenClaw keyed stores

```

## 3. Unified Plugin Architecture & Module Boundaries

`plugins/kazusa` (`@kazusa/plugin`) is a single native OpenClaw plugin whose
`src/index.ts` composes `Clock`, `Taskman`, and `ContextEngine` directly in
process. Do not introduce cross-plugin service boundaries or split these into
separate packages, and keep their internal responsibilities strictly decoupled:
Perception is the next planned component of this unified plugin, not another
cross-plugin service boundary.

### 3.1 `src/clock/` — Virtual Formula Clock

- Owns forward-only simulation time ($\text{sim\_time} + \Delta t \times
  \text{speed}$), lifecycle persistence in the `"clock"` keyed store, agent
  tools (`clock_now`, `clock_set_speed`, `clock_advance`), and matching
  `clock.*` Gateway RPCs.

### 3.2 `src/taskman/` — Lease State, Ledger & Wake Scheduling

- **Lease & Ledger Ownership**: Manages active leases in the `"tasks"` keyed
  store and exposes `start_task` and `delay_task`. Every task transition or
  delay appends to the native `agent:<agentId>:tasks` session transcript and
  publishes its update. Because `enqueueSystemEvent` is transient, never use it
  as a task ledger.
- **In-Character Monologues**: Transitions and delays may include a brief
  in-character `monologue`. Format it as an italic blockquote directly below the
  factual summary inside the same ledger message text rather than extending
  OpenClaw's message schema.
- **Simulation Timestamps**: Set native ledger `message.timestamp` from the
  clock at the task mutation. Delay entries include the new due time and
  remaining simulated minutes. Keep OpenClaw bookkeeping timestamps real-time.
- **Cron Automation Projection**: Projects each agent's next wake into OpenClaw
  automations using `declarationKey = agentId` so normal task transitions
  atomically upsert a single dashboard-visible wake job targeting
  `agent:<id>:brain`. We recalculate all timings on `cron_reconciled` and
  explicit clock edits to map simulated time to real world time (Kazusa
  currently owns all Gateway automations and may clear the cron list on full
  reconciliation; revisit before adding any non-Kazusa cron owner).
- Direct cron-to-brain targeting is transitional. Once Perception exists, task
  deadlines go through its admission gate; Taskman does not own the brain.
- **Strict Boundary**: Taskman emits only `kazusa:skill` markers and schedules
  wakes. It never injects prompts, reads skill files, or interprets interrupts.

### 3.3 `src/context-engine/` — Brain Context & `assemble()` Pipeline

- Registered through `api.registerContextEngine("kazusa", ...)`. Producers
  explicitly target `:brain`; OpenClaw 2026.10.5 ignores `session.mainKey` and
  keeps its default session at `main`. Never run character turns in chat
  ledgers.
- Reuses native workspace injection for `SOUL.md`, `IDENTITY.md`, and
  `MEMORY.md`; `memory/` remains tool-recalled archive, subject to OpenClaw's
  native new/reset note-loading behavior.
- Retains recent complete brain turns (`recentBrainHistory`, bounded by
  `brainMaxTokens`, default 2000; can be set to 0 for pure ledger runs) to
  guarantee tool-call/result atomicity & error recovery, in-flight steering
  boundary preservation, and reasoning continuity.
- Uses native `readRecentUserAssistantTextForSession` with simulation timestamp
  bounds and no practical message-count cap. It reads backward in 250-message
  pages but does not stop at the cutoff; full-history scans are an accepted
  tradeoff for now. Skip undated entries rather than inventing timestamps.
- **Ledger writer contract**: Every task/chat message must contain one text
  block with all readable content, including media summaries and attribution.
  The native reader only extracts the first user content block and does not
  return structured sender metadata. All direct and group chat writers must
  prefix incoming and outgoing text with `[speaker:<sender-id>]`. These writers
  are planned, not implemented; tags currently appear only in fixtures. Never
  infer a speaker from `sourceChannel`.
- Require `runtimeContext.sessionTarget.agentId` during assembly; throw if
  absent rather than deriving ownership from a key. `register.ts` owns SDK
  lifecycle, configuration, and session I/O. `context-engine.ts` owns selection,
  rendering, and skill expansion.
- Adds current simulation time and reads task and chat records from the last 24
  simulated hours (configurable upward), selects whole messages newest-first
  under one shared remaining token budget, then groups them by session with
  chronological, timestamped entries. No source quotas, per-message clipping,
  incognito feature, or external-channel adapter.
- **Multi-Media Architecture**: Grounded preflight + on-demand inspection. Media
  processors receive the Context Engine's assembled background (location,
  identities, conversation thread) to produce situation-aware descriptions.
  Ledgers record only lightweight `[Image: <summary>]` text blocks with
  attachment references, excluding heavy raw image tokens from context assembly.
  Agents re-inspect images on demand via `view_image(path, prompt)`.
- Does not read active-task state. The task ledger supplies experiences and
  monologues; no separate `:thoughts`. A start outside the window/budget can be
  absent, which is not proof of having no task. No task metadata injection yet.
- Uses OpenClaw's native token estimator. Proactive compaction is disabled;
  manual/overflow recovery still delegates to OpenClaw. Windowing is not
  summarization and never deletes ledger history.
- Chat keys distinguish `agent:<id>:chat:direct:<peer-id>` from
  `agent:<id>:chat:group:<group-id>`. Read only the owner's streams.
- **Foundational & On-Demand Skills**: The context engine unconditionally loads
  the `context-conventions` skill at the top of `systemPromptAddition`,
  establishing baseline simulation time, stream section, and envelope semantics
  so that plugin code remains free of hardcoded prose. When a stimulus contains
  one or more `[kazusa:skill=<name>]` tags, the engine dynamically resolves
  additional `<name>` skills via a dedicated `SkillLoader` following OpenClaw's
  precedence hierarchy. Frontmatter is stripped using a YAML parser so the LLM
  receives only clean Markdown.
- Behavioral instructions belong in skills, not TypeScript prompt constants.
- See [context-engine conventions](references/context_engine.md) for budgets,
  timestamps, SDK lifecycle requirements, and the future messaging contract.
- Future additions extend this into the **3-Tier Retrieval Pipeline**:

1. **Tier 1 (Eager Spatial Perception & Sensory Shock)**: Diffs the current
   location in `shared/wiki/` against the agent's `workspaces/<id>/wiki/` to
   surface environmental changes or unfamiliar surroundings.
2. **Tier 2 (Eager Social Salience)**: Injects `## Quick Impression` blocks from
   the agent's Personal Wiki for all co-present characters.
3. **Tier 3 (Session Stream Tails)**: Merges recent entries from the agent's
   `:tasks`, `:chat:direct:*`, and `:chat:group:*` streams (implemented).

### 3.4 `src/perception/` — Planned Stimulus Router & Attention Gate

- Design only: see [Perception](references/perception.md). Do not claim that
  rerouting, busy detection, or the secondary queue is already implemented.
- Owns stimulus classification, perceptibility, ledger destinations, brain
  wake/steer/defer admission, and future pending-input lifecycle.
- Multimodal interception: Coordinates with OpenClaw's `tools.media` pipeline,
  supplying Context Engine background before storing `[Image: <summary>]` text
  blocks into `:chat:*`.
- Context assembly only reads and renders admitted context; it never reroutes
  input or drains a queue. Admission must happen before a run starts, not in
  `assemble()`, which may be retried.

## 4. Engineering & Zero-Build Conventions

- **Zero-Build Jiti Execution**: OpenClaw runs `./src/index.ts` directly via its
  runtime TypeScript loader. Never add a build step (`tsc --build`, `tsup`, or
  `npm run build` artifacts); code edits take effect on the next event.
- **Zod Boundary Validation & Strict Types**: Validate all plugin configurations
  (scoped under `plugins.entries.kazusa.config.<module>.*`) and Gateway RPC
  inputs with **Zod** schemas. Never use `any`, hand-rolled `typeof` chains, or
  unverified `as unknown as T` casts.
- **Atomic Markdown Writes**: When mutating Markdown files, always write to a
  temporary file in the same directory and atomically `rename(tmp, target)` so
  concurrent reads never see partial writes.
- **Colocated Vitest Suite**: Place unit tests alongside their implementation in
  `src/**/*.test.ts` (keep test-only in-memory stores inside `*.test.ts`, never
  in production files). Verify changes with:
- `npm test` (`vitest run`)
- `npm run typecheck` (`tsc --noEmit`)
- Targeted `prettier --check` and `eslint` for touched files. Root `format` and
  `lint` scripts rewrite files; avoid them in a dirty worktree.

## 5. Reference Documentation

Load these reference files on demand when working on their specific subsystem:

- `references/file_schemas.md` — Read when implementing Markdown/YAML parsers or
  creating/modifying `SOUL.md`, `IDENTITY.md`, `MEMORY.md`, World Wiki, or
  Personal Wiki files.
- `references/mathematics.md` — Read when implementing or tuning passive desire
  decay, circadian $M_{\text{tod}}$ multipliers, squared urgency rankings, sleep
  debt, task settlement ratios, or encounter probability rolls.
- `references/primitives_mapping.md` — Read when wiring OpenClaw sessions
  (`:brain`, `:tasks`, `:chat:*`), cron automations, `assemble()` hooks, or
  `memory-core` vector indexing.
- `references/context_engine.md` — Read when modifying context assembly, session
  naming, memory layers, budgets, or future chat producers.
- `references/perception.md` — Read when designing stimulus routing, busy-brain
  admission, steering, deferred attention, or moving task wakes behind the gate.
- `references/phases_and_testing.md` — Read when planning milestone deliverables
  across Phases 0–5 or designing integration test suites.
