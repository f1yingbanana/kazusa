# Kazusa Deterministic Mathematics & Behavioral Dynamics

This document details the deterministic models used across Kazusa: desire
levels, encounter probability gates, and task lease rules. All operations in
this document execute in native TypeScript code (costing **0 LLM tokens** and
taking **< 1 ms**).

---

## 1. Desires

Desires are narrative pressure, not chores. Code owns the arithmetic; the LLM
owns meaning. The LLM never reads or writes a number: it reads each desire as a
**state word** and declares, per task, the state word it expects to end in.

### 1.1 Configuration (`plugins.entries.kazusa.config.desires`)

```json5
desires: {
  // Ascending. A level belongs to the last state whose `min` it reaches; the
  // first `min` is 0. `level` is where a task targeting that state settles.
  states: [
    { name: "depleted", min: 0,  level: 10 },
    { name: "low",      min: 25, level: 35 },
    { name: "fine",     min: 50, level: 65 },
    { name: "full",     min: 80, level: 100 },
  ],
  initial: "fine",           // state a character's unseen desire starts in
  catalog: [
    { name: "energy",  drain: 4, description: "Physical and mental wakefulness." },
    { name: "satiety", drain: 8, description: "Hunger and the pleasure of food." },
    // social, stimulation, composure, purpose, expression ...
  ],
}
```

- Levels are `0..100`. `drain` is points lost per simulated hour.
- `name` is the stable key, shown to the LLM verbatim. There is no label; a
  client may prettify names.
- `description` is the entire semantic contract with the LLM and appears once,
  on the matching `start_task` `afterwards` property. It must say what `full`
  means, because the same word reads differently per desire ("Your social
  battery. Full means you've had your fill of people.").
- The catalog is per world. Characters cannot add desires; their only tuning is
  sparse `drain` overrides in the `"desires"` store.
- There are deliberately no weights, targets, urgency tags, per-desire
  restoration rates, top-N filters, or circadian multipliers.

### 1.2 Task effects (`afterwards`)

`start_task` and `delay_task` both require
`afterwards: { <name>: "<current>→<afterwards>" }`: only the desires the
activity changes (`{}` when none). The `start_task` schema is generated from the
catalog: one description naming each desire with its description, plus one
example (`a night's sleep: { "energy": "low→full" }`); `propertyNames` limits
keys to the catalog and the value enum holds every transition between different
states (12 for four states). `delay_task` carries a short schema that points at
`start_task`. No skill text explains it. Only the afterwards state is used; the
stated current state is the model's reasoning aid and may be stale.

At the transition time $t_0$ with level $L_0$ and planned end $t_{\text{end}}$,
each listed desire moves toward its target state's `level` $L^*$ at

$$r = \frac{L^* - L_0}{t_{\text{end}} - t_0}\ \text{points/hour}$$

and holds once it reaches $L^*$. Unlisted desires drain normally.

- **An afterwards state equal to the current one means no change**, as a guard
  for stale `from` states: a restated `fine` would otherwise prop desires up
  forever, and a restated `low` would raise a level at the bottom of `low`.
- **Magnitude** comes from the chosen state, **speed** from the duration: a
  30-minute nap to `fine` and an 8-hour sleep to `full` both need no calibration
  from the LLM.
- **Interruption settles itself**: replacing the task halfway leaves the desire
  halfway. There is no separate settlement ratio.
- **Effects stop at the planned end.** After it, or with no task, every desire
  drains at its rate. A stalled or overdue character keeps getting hungry.
- **`delay_task` restates effects** from the current level to the new end, so an
  activity that changes in nature mid-way ("waiting for Sensei" becoming "eating
  with Sensei") still counts.

#### Why these choices (live runs, GLM-5.2, 2026-10-28)

- An optional parameter was never filled; it must be required.
- The task tools and `send_message` are `catalogMode: "direct-only"`. Under
  OpenClaw's default Tool Search, deferred tools show only name and description,
  so `afterwards` and its descriptions were invisible.
- Named `effects` ("how you expect to feel when this activity ends"), the model
  reported its present state (an 8-hour sleep with `energy: depleted`).
- With bare state values and one property per desire, the model filled every
  property with its current state and copied that pattern from its own brain
  history, so a later sleep came out as `energy: low` (no change). Transition
  values fixed it: fresh calls were `{ "energy": "fine→full" }` alone.

### 1.3 Closed form (zero ticks)

Each character's record holds an anchor ($t_a$, levels at $t_a$) and the current
task's effects (`until`, per-desire `target` and `rate` $r \ge 0$). For desire
$d$ at time $t \ge t_a$, let the effect end at $u = \min(t, \max(t_a,
\text{until}))$:

- Affected: $L = \text{toward}(L_a, L^*, r\cdot(u - t_a)) - \lambda_d \cdot (t -
  u)$
- Unaffected: $L = L_a - \lambda_d \cdot (t - t_a)$

then clamp to $[0, 100]$, where `toward` moves without overshooting and
$\lambda_d$ is the character's drain. Every `start_task`/`delay_task` re-anchors
at its sim time before the lease is written, so a failed lease write leaves the
old effects continuing from a correct anchor. A clock pause or `clock_advance`
needs no work: the level is a pure function of sim time.

### 1.4 Rendering

The brain's situation message gets one line in catalog order, with no numbers,
tags, or filtering:

```text
### How you feel
energy: fine · satiety: low · social: full · stimulation: low · composure: fine · purpose: fine · expression: depleted
```

---

## 2. Deliberately Omitted

Earlier drafts had sleep debt, circadian multipliers, weighted squared-deficit
urgency, and per-desire prose tables. They were dropped: state words plus the
character's own judgment carry the same pressure with one config table. Do not
reintroduce them without a concrete behavioral failure that needs them.

---

## 3. Zero-LLM Encounter Gate

When Agent $A$ and Agent $B$ are co-located at location $L$ (or co-commuting
along transit corridor $C$), an encounter probability is evaluated in code:

$$P(\text{bump}) = \text{clamp}\Big(\big(0.01 + 0.94 \cdot (F_{AB} / 100)^{1.5}\big) \times M_L \times (1 - \text{shield}_A)(1 - \text{shield}_B),\; 0.0,\; 0.95\Big)$$

### Variables:

- $F_{AB} \in [0, 100]$: Familiarity between $A$ and $B$ from
  `<workspace>/memory/relationships/<peer>.md` frontmatter. (If no file exists,
  $F_{AB} = 0$).
- $M_L \in [0.0, 1.0]$: `encounter_modifier` from
  `shared/wiki/entities/places/<loc>.md` (e.g. `0.85` in a crowded cafe, `0.20`
  in a quiet library stack, `0.0` in private dorm room).
- $\text{shield}_A, \text{shield}_B \in [0.0, 1.0]$: `focus_shield` of current
  `active_task` (e.g. `0.9` for studying or sleeping, `0.1` for casual
  strolling).

### Mathematical Properties:

1. **Strangers ($F\_{AB} = 0$)**:
   $$P(\text{bump}) = 0.01 \times M_L \times (1 - \text{shield}_A)(1 - \text{shield}_B) \le 0.01$$
   _Over 99% of stranger interactions pass silently without waking agents or
   consuming any LLM tokens._
2. **Close Friends ($F\_{AB} = 80$, $M_L = 0.8$, low shields)**:
   $$(0.01 + 0.94 \cdot (0.8)^{1.5}) \approx 0.01 + 0.67 = 0.68 \implies P(\text{bump}) \approx 0.68 \times 0.8 \times 0.9^2 \approx 0.44 \text{ to } 0.70$$
   _Friends frequently notice each other and initiate spontaneous
   conversations._

---

## 4. Task Lease Mathematics

Desire effects of a task are continuous (§1.2), so there is no settlement ratio
or reward clamp: an interrupted task has simply accrued less.

### 4.1 Interruption & Agent Task Autonomy

- **Agent Autonomous Decision**:
  - When interrupted by an external stimulus (encounter or message), the agent
    is informed with the active task's full status (description, started time,
    planned end time, elapsed minutes, and remaining duration).
  - The framework does not force rigid machine-level pause/resume locks. The
    agent autonomously evaluates its priorities to decide whether to:
    1. **Delay/Extend** the task lease via `delay_task` (e.g. extending study
       time after chatting with a friend).
    2. **Transition** via `start_task`, recording the current task's outcome in
       `summary` and naming the next task (e.g. stopping study to hang out).
    3. **Ignore** the stimulus or continue uninterrupted (e.g. sleeping through
       a minor ambient encounter).
- **Physical Transit Invariant**:
  - For physical movement/travel, arrival flips occur deterministically at the
    scheduled arrival time based on the spatial corridor distance, regardless of
    conversational dialogue turns along the way.
