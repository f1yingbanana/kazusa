# Kazusa Deterministic Mathematics & Behavioral Dynamics

This document details all deterministic mathematical models, decay formulas,
urgency rankings, probability gates, and task settlement rules used across
Kazusa. All operations in this document execute in native TypeScript code
(costing **0 LLM tokens** and taking **< 1 ms**).

---

## 1. Passive Desire Decay & Homeostasis

Desire levels are numerical meters bounded between `0.0` (critical deficiency)
and `10.0` (complete satiation).

### 1.1 Time Delta Calculation

For any simulation wake event at timestamp $t_{\text{now}}$:
$$\Delta t_{\text{hours}} = \frac{t_{\text{now}} - t_{\text{last}}}{3{,}600{,}000}$$

### 1.2 Decay Formula

Each desire $d$ for agent $i$ decays according to its configured rate
$\lambda_{i,d}$ (from `IDENTITY.md`) modulated by a circadian time-of-day factor
$M_{\text{tod}}$:

$$V_d(t_{\text{now}}) = \text{clamp}\Big(V_d(t_{\text{last}}) - \big(\lambda_{i,d} \cdot M_{\text{tod}}(t) \cdot \Delta t_{\text{hours}}\big),\; 0.0,\; 10.0\Big)$$

### 1.3 Time-of-Day Multiplier ($M_{\text{tod}}$)

- **Sleep Energy**:
  - 07:00 – 21:00: $M_{\text{tod}} = 1.0$
  - 21:00 – 01:00: $M_{\text{tod}} = 1.5$ (accelerated evening fatigue)
  - 01:00 – 07:00: $M_{\text{tod}} = 2.2$ (extreme night exhaustion if awake)
- **Hunger**:
  - Near meal hours (11:00–13:00, 18:00–20:00): $M_{\text{tod}} = 1.4$
  - Night (00:00–06:00): $M_{\text{tod}} = 0.3$ (metabolic slowdown)
- **Other Desires**: $M_{\text{tod}} = 1.0$ (constant baseline decay).

---

## 2. Sleep Debt Accumulation & Recovery

Sleep debt tracks chronic exhaustion and forces characters into recovery sleep
routines:

- **Accumulation**:
  - If the character remains awake between 23:00 and 06:00, or if
    `desires.sleep_energy < 3.0`:
    $$\text{debt}_{\text{new}} = \text{debt}_{\text{prev}} + \big(\Delta t_{\text{hours}} \times 15\text{ minutes}\big)$$
- **Recovery During Sleep**:
  - For sleep duration $\Delta t_{\text{slept}}$ hours:
    $$\Delta V_{\text{sleep}} = \min(10.0, V_{\text{sleep}} + 1.25 \cdot \Delta t_{\text{slept}})$$
    $$\text{debt}_{\text{new}} = \max\Big(0,\; \text{debt}_{\text{prev}} - (\Delta t_{\text{slept}} \times 20\text{ minutes})\Big)$$
- **Qualitative Rendering**:
  - When `sleep_debt_min > 30`, the rendered `Sleep & Energy` bullet appends:
    `"carrying [N] minutes of lingering sleep debt"`, prompting the LLM to
    schedule a longer sleep cycle (e.g. 9–11 hours).

---

## 3. Squared Urgency Ranking & Qualitative Rubric

To prevent starvation of minor desires while ensuring acute needs dominate agent
attention, Kazusa uses a non-linear squared deficit formulation:

### 3.1 Squared Deficit Urgency Formula

$$U_d = W_d \cdot \max(0,\; T_{i,d} - V_d)^2$$

Where:

- $T_{i,d}$ is the character's target baseline from `IDENTITY.md` (e.g., $7.5$
  or $8.0$).
- $V_d$ is the current meter level ($0.0..10.0$).
- $W_d$ is the global priority weight ($W_{\text{sleep}} = 1.5$,
  $W_{\text{hunger}} = 1.3$, $W_{\text{social}} = 0.9$, $W_{\text{curiosity}} =
  0.8$, $W_{\text{progress}} = 1.1$).

### 3.2 Urgency Thresholds for Display

- $U_d \ge 18.0$: Tagged as **`[CRITICAL URGENCY]`** (placed at top of
  `## Current State & Desires`).
- $10.0 \le U_d < 18.0$: Tagged as **`[HIGH URGENCY]`**.
- $4.0 \le U_d < 10.0$: Tagged as **`[MODERATE URGENCY]`**.
- $U_d < 4.0$: Rendered with standard descriptive sentence without urgency tag.

### 3.3 Discrete-to-Analog (D2A) Lookup Table (Sample)

The rounded integer value $\text{round}(V_d)$ ($0..10$) maps to authentic
natural language:

| Value  | Hunger State                                                    | Sleep & Energy State                                              |
| :----- | :-------------------------------------------------------------- | :---------------------------------------------------------------- |
| **0**  | Starving and dizzy; barely able to focus on anything else.      | Completely collapsed from exhaustion; eyes closing involuntarily. |
| **2**  | Very hungry; intense stomach pains; urgent need for sustenance. | Severely fatigued; yawning constantly; heavy limbs.               |
| **4**  | Moderately hungry; stomach is rumbling; thinking about lunch.   | Growing tired; feeling a noticeable afternoon slump.              |
| **6**  | Mildly peckish; could eat a snack if convenient.                | Functionally alert; steady baseline energy.                       |
| **8**  | Well-nourished and comfortable; no desire for food.             | Fully refreshed, sharp, and physically energized.                 |
| **10** | Completely full and stuffed after a hearty meal.                | Vibrantly energized and peaking in alertness.                     |

---

## 4. Zero-LLM Encounter Gate

When Agent $A$ and Agent $B$ are co-located at location $L$ (or co-commuting
along transit corridor $C$), an encounter probability is evaluated in code:

$$P(\text{bump}) = \text{clamp}\Big(\big(0.01 + 0.94 \cdot (F_{AB} / 100)^{1.5}\big) \times M_L \times (1 - \text{shield}_A)(1 - \text{shield}_B),\; 0.0,\; 0.95\Big)$$

### Variables:

- $F_{AB} \in [0, 100]$: Familiarity between $A$ and $B$ from
  `<workspace>/memory/relationships/<peer>.md` frontmatter. (If no file exists,
  $F_{AB} = 0$).
- $M_L \in [0.0, 1.0]$: `encounter_modifier` from `shared/locations/<loc>.md`
  (e.g. `0.85` in a crowded cafe, `0.20` in a quiet library stack, `0.0` in
  private dorm room).
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

## 5. Start-Then-Settle Task Lease Mathematics

When an agent initiates a task via `start_activity()` or transit via
`start_transit()`:

### 5.1 Settlement Ratio

When the task completes, is paused, or is interrupted at $t_{\text{settle}}$:
$$\Delta t_{\text{elapsed}} = \frac{t_{\text{settle}} - t_{\text{started}}}{60{,}000}\text{ minutes}$$
$$\text{Ratio} = \text{clamp}\left(\frac{\Delta t_{\text{elapsed}}}{t_{\text{planned\_min}}},\; 0.0,\; 1.0\right)$$

### 5.2 Desire Reward Settle Formula

For any activity targeting desire recovery $\Delta D_{\text{target}}$:
$$\Delta D_{\text{awarded}} = \text{clamp}\big(\Delta D_{\text{target}},\; -3.0,\; +3.0\big) \times \text{Ratio}$$

- If an agent planned a 60-minute study session to gain $+2.0$ Purpose, but was
  interrupted after 15 minutes ($\text{Ratio} = 0.25$), they receive exactly
  $+0.5$ Purpose.
- Hallucinated instant claims are mathematically impossible.

### 5.3 Channel Distinction

- **`EXCLUSIVE` (Venue Task)**:
  - On interrupt: `status = "PAUSED"`, `remaining_min = planned - elapsed`.
  - Timer freezes. Upon resuming, next heartbeat is set to $t_{\text{now}} +
    \text{remaining\_min}$.
- **`KINEMATIC_PARALLEL` (Transit)**:
  - On interrupt: Physical movement timer continues ticking in background.
  - Arrival flip occurs at fixed $t_{\text{arrival\_iso}}$ regardless of how
    many chat turns take place during the walk.
