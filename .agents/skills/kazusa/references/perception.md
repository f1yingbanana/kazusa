# Perception — Universal Attention Gate & Stimulus Router (Jev Decision Model)

Drafted under `src/perception/` inside the unified Kazusa plugin
(`@kazusa/plugin`). Perception acts as the sensory nervous system for each
autonomous character, gating environmental stimuli, direct chats, group
messages, and task deadlines before they reach the agent's single cognitive
execution lane: `agent:<id>:brain`.

---

## 1. Core Architectural Paradigm: Jev Decision Model

Earlier designs routed stimuli through a secondary generative LLM chat session
(`agent:<id>:perception`). That approach suffered from high latency (2–5s),
significant token costs ($0.015+ per check), output JSON parsing fragility,
prompt-injection vulnerabilities from untrusted incoming text, and lossy
generative summarization.

Kazusa refactors Perception to use OpenClaw's native **Decision Model API**:
`api.runtime.decisions.evaluate({ state, questions }, { agentId, purpose: "perception" })`.

### Why Decision Models for System 1 Attention

- **Sub-100ms Latency**: A single forward pass evaluates categorical choices in
  ~70–200ms without iterative auto-regressive token generation.
- **Calibrated Softmax Probabilities**: Directly outputs exact probabilities
  ($P(\text{STEER})$, $P(\text{QUEUE\_NEXT})$, $P(\text{IGNORE})$), enabling
  rigorous mathematical hysteresis.
- **Zero Generated Output Tokens**: $0.042 per million input tokens (compared to
  ~$15.00/1M for frontier generative LLMs).
- **Zero Prompt Injections**: Incoming chat text cannot inject instructions to
  hijack tools or escape the prompt, because the decision model only predicts
  categorical logits.
- **Verbatim Stimulus Preservation**: Stimuli admitted to the brain pass through
  completely intact. No hallucinations, omissions, or generative paraphrasing.
- **Supported Providers**: TypeSafe AI Jev (`typesafe/jev-latest`,
  `typesafe/jev-1.13.0`), local Kev (ONNX/GGUF), or OpenClaw-hosted decision
  endpoints.

---

## 2. Resolution of OpenClaw 2026.10.5 Runtime Constraints

In OpenClaw 2026.10.5, `api.runtime.gateway.request(...)` and
`api.runtime.gateway.readSessionFacts(...)` are restricted by
`canTrustedOfficialPluginRequestScopes` to bundled or trusted-official plugins.
Local plugins cannot call those Gateway RPCs.

Perception's policy operates in-process; this does not by itself solve the
supported delivery/steering transport:

1. **Inbound Message Interception**: The native `api.on("before_dispatch")` hook
   claims incoming direct/group messages (`return { handled: true }`), stopping
   unmanaged auto-replies and registering the stimulus. The producer owns prior
   ledger persistence.
2. **In-Process Lifecycle Tracking**: Brain busy/idle state is tracked in
   real-time via
   `api.agent.events.registerAgentEventSubscription({ streams: ["lifecycle"] })`,
   monitoring `agent_start` and `agent_end` events for `agent:<id>:brain`.
3. **Public Brain Handoff**: The internal Kazusa channel uses
   `dispatchReplyWithBufferedBlockDispatcher` targeting `agent:<id>:brain`.
   Routine inputs use `InboundEventKind: "room_event"` to queue behind a busy
   turn; urgent steering uses `"user_request"`. Native `onAdopted` acknowledges
   custody; deferred or uncertain handoffs retain their pending reservation.
4. **Explicit Speech**: The channel suppresses automatic outward replies.
   Visible dialogue requires Kazusa `send_message`; built-in `message` is
   denied.
5. **No Ghost Sessions**: Deletes `agent:<id>:perception`, eliminating
   tool-stripping hacks (`toolsAllow: []`), prompt overrides, and cross-session
   fact reads.

### Host work ownership (verified live 2026-10-27)

Use the public channel dispatcher and adoption lifecycle; do not import private
session controllers or deprecated `queueAgentHarnessMessage`. Perception never
appends brain/chat transcripts to manufacture admission.

OpenClaw scopes async work to its owner. Returning HTTP success or resolving
Perception ingress does not keep a detached timer/model run alive. Use the
owning instance's native `api.lifecycle.runInBackgroundContext` composed with
`runDetachedWebhookWork` (`src/background-work.ts`) for these concrete lifetime
boundaries. The native lifecycle runner drops request/tool context while
preserving current plugin bindings; the webhook helper reserves Gateway work
admission. Neither a bare webhook helper nor a module-load
`AsyncLocalStorage.snapshot()` supplies both guarantees. Module loading can
itself happen inside a request, so a snapshot can restore expired authority.

- Messaging reserves notification work before its HTTP/tool caller returns.
- Perception reserves a scope spanning the whole coalescing wait and drain.
  Cancelling that timer resolves its wait, so disposal does not leak the scope.
- Brain submission owns the full dispatcher promise, even after `onAdopted` or
  `onDeferred` resolves ingress. Later tool continuations still need live scope.
- A drain scheduled by adoption and a delivery retry enter their own detached
  scope. Errors remain observed; an adopted turn is never replayed for a later
  model/tool failure.

Keep the fixed window starting at the first arrival. The public
`channel-inbound-debounce` helper buffers until a quiet interval; it does not
provide detached work ownership. Replacing the coalescer would change attention
latency under continuous traffic without fixing the scope failure.

Native keyed-store values must be JSON. Delete absent optional run/context
properties rather than writing explicit `undefined`; tests enforce that same
contract. Recovery never blindly repeats possibly adopted work: it checks each
delivery still in custody against the brain transcript (`adoptedByBrain`). Found
means the turn ran, so its stimuli become processed; missing means they return
to pending. Only without that check does it quarantine (`stopped`). A restart
tombstone on `:brain` is cleared by the brain channel, which then retries the
handoff once (SKILL §3.4).

- [Webhook and SDK helpers](https://docs.openclaw.ai/plugins/sdk-subpaths)
- [Inbound debounce](https://docs.openclaw.ai/plugins/sdk-channel-inbound)

---

## 3. Universal Attention Gate: Idle & Busy Brain Evaluation

Characters are never truly "idle" in Kazusa—sleeping, reading, meditating,
eating, and resting are active tasks in `tasks`. Therefore, **every incoming
stimulus is evaluated through Jev against the agent's current activity and
state**, regardless of whether the brain LLM lane is currently executing.

```text
Incoming Stimulus / Coalesced Bundle (Chat / Physical Event / World Notice)
                               │
                               ▼
        Producer persists chat ledger before Perception intake
                               │
                               ▼
       Compile State Prefill (Task, Focus, Desires, Context)
                               │
                               ▼
              Jev Decision Model Evaluation
            (`api.runtime.decisions.evaluate`)
                               │
         ┌─────────────────────┴─────────────────────┐
         ▼                                           ▼
   [Brain is IDLE]                            [Brain is BUSY]
         │                                           │
 Choices: WAKE vs IGNORE                     Choices: STEER vs QUEUE vs IGNORE
         │                                           │
  P(WAKE) ≥ T_wake?                           P(STEER) ≥ T_steer(focus)?
  ├── Yes ➔ Wake :brain                       ├── Yes ➔ Steer active :brain run
  └── No  ➔ IGNORE (Stay quiet)               ├── No & P(QUEUE) ≥ 0.5 ➔ Hold in queue
                                              └── No ➔ IGNORE (Stay focused)
```

### 3.1 Idle Brain Evaluation (`WAKE` vs `IGNORE`)

Characters in Kazusa are never truly inactive: sleeping, reading, meditating,
and resting are distinct active tasks tracked in `tasks`. When incoming stimuli
arrive while the LLM brain lane is idle, Perception evaluates whether the
stimuli warrant waking the character from their current activity.

#### 1. Activity Context Resolution

Perception retrieves the character's active task via
`taskStore.getActiveTask(agentId)`. If no task is currently active, it defaults
gracefully:

```typescript
const defaultActivity = {
  type: "resting",
  description: "Lounging and reflecting",
  startedAt: null,
  endAt: null,
  focusLevel: 0.1,
};
```

Focus level is computed dynamically using `resolveTaskFocus(task)` (e.g. low for
resting, medium for chores, high for studying/combat).

#### 2. Pure Semantic Evaluation (No Hardcoded Heuristics)

Unlike brittle heuristic architectures, Perception uses **no hardcoded keyword
matching or focus threshold overrides**:

- Activity context (e.g. sleep, meditation, intense combat, casual lounging) is
  provided directly to the Jev Decision Model in
  `DecisionEntry.currentActivity`.
- Jev evaluates semantic salience directly and returns categorical decisions
  (`choice: "WAKE"` vs `"SLEEP"`, or `"STEER"` vs `"QUEUE_NEXT"` vs `"IGNORE"`).
- This keeps the codebase minimal and eliminates stray assumptions or arbitrary
  magic numbers.

#### 3. Queue-Next Fast-Path Bypass (`allQueued`)

When a character was previously busy thinking, stimuli evaluated as `QUEUE_NEXT`
were **already explicitly approved** for attention once the active thought
completes.

- When the brain finishes its turn and becomes idle, Perception inspects the
  bundle:
  ```typescript
  const allQueued =
    bundle.length > 0 && bundle.every((item) => item.action === "QUEUE_NEXT");
  let shouldWake = allQueued || !evaluateDecision;
  ```
- If `allQueued === true`: Perception **bypasses Jev re-evaluation entirely**
  and delivers the bundle immediately (`shouldWake = true`). This prevents
  redundant decision-model latency and guarantees instant delivery.
- If no decision model is configured (`!evaluateDecision`): Perception fails
  open to deliver, ensuring no events are dropped.

#### 4. Context Assembly (`DecisionBatch`)

When Jev evaluation is required, the Context Engine's dedicated decision
assembler compiles the full `DecisionBatch` (`{ state, questions }`) containing
the state data and the rubrics resolved from
`shared/skills/perception/SKILL.md`:

```typescript
const batch: DecisionBatch = await this.assembleDecisionContext(agentId, {
  activeTask: task,
  brainStatus,
  brainContext: state.brainContext,
  incomingBundle: bundle,
  pendingQueue: state.pending,
  signal: this.lifetime.signal,
});
```

#### 5. Jev Evaluation & Outcome Handling

Perception submits a choice evaluation query to Jev
(`api.runtime.decisions.evaluate`):

- **Question**: `wake_decision`
- **Instructions**:
  `"Should the character be woken up from '${task?.description}' to respond to this incoming sensory bundle?"`
- **Criteria**:
  - `WAKE`: The incoming stimuli are relevant, direct, or urgent enough to wake
    the character from their current activity.
  - `IGNORE`: The stimuli are ambient chatter, background noise, or negligible
    while engaged in this activity (e.g. sleep/rest).
- **Outcome**:
  - $P(\text{WAKE}) \ge T_{\text{wake}}$ ➔ **WAKE**: Consolidated single-turn
    presentation delivered to `agent:<id>:brain` via `followup` turn with
    `[INTERRUPT]\nIncoming chats: [...]` containing all bundle IDs.
  - $P(\text{WAKE}) < T_{\text{wake}}$ ➔ **IGNORE**: Stimuli are dropped from
    `state.pending` attention queue, but **safely retained in the subjective
    ledger** (`agent:<id>:chat:*`) for permanent memory and historical recall.
  - **Error Safety**: If `evaluateDecision` throws or encounters a network
    error, the catch block retains all items in `state.pending` without dropping
    them. Zero message loss.

### 3.2 Busy Brain Evaluation (`STEER` vs `QUEUE_NEXT` vs `IGNORE`)

- When the brain is already actively executing a cognitive turn, incoming
  stimuli compete for working memory.
- Jev evaluates categorical choices:
  - _Question_:
    `"Given the character is actively thinking and engaged in '${task?.description ?? "active reasoning"}', how should the character allocate attention to this incoming bundle (considering its combination and context)?"`
  - _Choices_: `["STEER", "QUEUE_NEXT", "IGNORE"]`
- **Semantic Focus Rather Than Ad-Hoc Numbers**: Instead of fragile hardcoded
  probability thresholds, the character's active task description (e.g.
  low-focus lounging vs high-focus studying/combat) and context are provided
  directly to Jev in `currentActivity`. Jev semantically weighs whether the
  stimuli warrant immediate mid-thought steering.
- **Routing Rules**:
  1. **STEER**: Injects immediately into the active brain execution lane via
     OpenClaw's `mode: "steer"` session queue
     (`InboundEventKind: "user_request"`).
  2. **QUEUE_NEXT**: Retained in the pending attention queue to be delivered
     automatically when the current brain run finishes.
  3. **IGNORE**: Dropped from pending attention. The message remains permanently
     recorded in the subjective chat ledger.
  4. **Attention Floor for Deadlines**: Task deadlines can never be dropped into
     `IGNORE`; if evaluated as `IGNORE`, they clamp to `QUEUE_NEXT`.
  5. **Fail-Open Policy**: If Jev is unavailable or throws, Perception fails
     open to `STEER`, ensuring stimuli are never dropped or stalled when the
     decision service is down.

---

## 4. Multi-Stimulus Arrival & Emergent Salience (Combination Effects)

In real conversational environments, messages frequently arrive in fragments or
rapid succession (e.g., `"Hey"`, `"are you there?"`,
`"quick emergency in the kitchen"`). Furthermore, two individually routine
messages from different peers can combine to create an urgent situation.

If stimuli were evaluated in isolated silos:

1. Fragmented messages would be discarded as `IGNORE` before the punchline
   arrives.
2. An earlier clue (e.g., `"Do you smell smoke?"`) discarded as `IGNORE` would
   lose its context when a subsequent message
   (`"The building alarm is ringing!"`) arrives.

To guarantee context integrity and capture **emergent combination salience**,
Perception employs three mechanisms:

### 4.1 Ingestion Debouncing & Coalescing Window

- When a stimulus arrives, Perception initiates a brief perceptual coalescing
  window (`coalesceWindowMs = 500ms`).
- Any additional stimuli arriving within this window are grouped into a single
  **incoming bundle**.
- This guarantees multi-line chat bursts (common on Discord/Telegram) are
  evaluated as a coherent whole rather than piecemeal.

### 4.2 Cumulative Context in State Compilation

When Jev evaluates an incoming bundle, `state` provides:

- **`recentChannelContext`**: The last 3–5 messages from that channel ledger,
  ensuring continuous conversational flow even across intervals.
- **`pendingQueue`**: Any stimuli currently waiting in the attention queue from
  earlier arrivals.
- **`incomingBundle`**: The newly arrived stimuli to be evaluated.

### 4.3 Collective Salience & Priority Escalation

- Jev evaluates the **entire bundle** collectively against the character's
  active task:
  - _Example_: Stimulus A (`"Did you smell smoke?"`) alone has $P(\text{STEER})
    = 0.20$ (low urgency).
  - Stimulus B (`"The toaster is flaming!"`) arrives.
  - When evaluated together with A and recent channel context, the combined
    bundle yields $P(\text{STEER}) = 0.98$!
- **Escalation of Previously Queued Items**:
  - If Stimulus A was already sitting in `QUEUE_NEXT`, and newly arrived
    Stimulus B elevates the overall situation to `STEER`, **both A and B are
    admitted and steered into the brain together**.
  - Context is never severed or evaluated in an amnesiac vacuum.

---

## 5. Consolidated Queue Draining (Single-Turn Batch Presentation)

When an agent is busy or asleep, stimuli evaluated as `QUEUE_NEXT` accumulate in
the pending attention queue.

### The Anti-Pattern: Serial Ping-Pong Turns

In naive queue implementations, when the brain finishes its current run, the
queue pops items one-by-one:

- Brain finishes Turn 1 $\to$ wakes for Message 1 (Turn 2) $\to$ finishes $\to$
  wakes for Message 2 (Turn 3) $\to$ finishes $\to$ wakes for Message 3 (Turn
  4).
- This produces severe conversational lag, burns unnecessary LLM turns, and
  forces the character into robotic, fragmented single-line replies.

### The Kazusa Pattern: Consolidated Single-Turn Presentation

1. **Batch Drain on Turn Completion**: When the active brain run completes
   (`agent_end` lifecycle event on `agent:<id>:brain`), Perception drains **all
   eligible pending stimuli in one single batch** (up to `maxBatchSize`).
2. **Simultaneous Admission**: All drained stimulus IDs are atomically removed
   from `pending` and marked admitted.
3. **Single Wake Signal**: Perception issues a single wake signal to
   `agent:<id>:brain`.
4. **Context Engine Synthesis**: When `agent:<id>:brain` awakens, the Context
   Engine's `assemble()` pipeline pulls recent stream ledgers with native
   structured sender attribution and renders chronological speaker/time
   envelopes.
5. **Holistic Response**: The agent synthesizes all incoming messages in a
   **single, unified, coherent LLM turn** (e.g., addressing Bob's questions and
   Clara's updates simultaneously in one natural response).

---

## 6. Context Assembly & Decision Schema

When stimuli arrive, the Context Engine compiles a structured, bounded
`DecisionBatch` (`{ state, questions }`) passed directly into
`api.runtime.decisions.evaluate`.

### State Payload Schema (`DecisionBatch.state`)

```typescript
interface DecisionStatePayload {
  character: {
    id: string;
  };
  currentActivity: {
    type: string;
    description: string;
    startedAt: number | null;
    endAt: number | null;
    focusLevel: number; // 0..1 numerical scalar from resolveTaskFocus
  };
  brainStatus: "idle" | "busy_thinking";
  recentChannelContext: Array<{
    role: string;
    text: string;
    timestamp?: number;
  }>; // Trailing messages from session store runtime
  pendingQueue: Array<{
    id: string;
    sender: string;
    text: string;
    timestamp: number;
  }>; // Stimuli already deferred in the attention queue
  incomingBundle: Array<{
    id: string;
    sender: string;
    text: string;
    timestamp: number;
  }>; // Newly arrived stimuli to be evaluated
}
```

### Decision Request Format: Idle Brain (`WAKE` vs `IGNORE`)

```typescript
const outcome = await api.runtime.decisions.evaluate(
  {
    state: stateData, // brainStatus: "idle", pendingQueue: []
    questions: {
      wake_decision: {
        type: "choice",
        instructions: `Should the character be woken up from '${task?.description ?? "resting"}' to respond to this incoming sensory bundle?`,
        criteria: {
          WAKE: "The incoming stimuli are relevant, direct, or urgent enough to wake the character from their current activity.",
          IGNORE:
            "The stimuli are ambient chatter, background noise, or negligible while engaged in this activity (e.g. sleep/rest).",
        },
      },
    },
  },
  {
    agentId,
    purpose: "perception.idle_salience",
    rubricVersion: "2",
  },
);
```

### Decision Request Format: Busy Brain (`STEER` vs `QUEUE_NEXT` vs `IGNORE`)

```typescript
const outcome = await api.runtime.decisions.evaluate(
  {
    state: stateData, // brainStatus: "busy_thinking", pendingQueue: [...]
    questions: {
      attention_allocation: {
        type: "choice",
        instructions: `Given the character is actively thinking and engaged in '${task?.description ?? "active reasoning"}', how should the character allocate attention to this incoming bundle (considering its combination and context)?`,
        criteria: {
          STEER:
            "The incoming stimuli (individually or combined) are urgent, dangerous, or important enough to immediately interrupt current thoughts.",
          QUEUE_NEXT:
            "The stimuli are relevant and should be addressed, but can wait until the current thought/action concludes.",
          IGNORE:
            "The stimuli are routine chatter, ambient background noise, or irrelevant to the character's current activity and should not draw attention.",
        },
      },
    },
  },
  {
    agentId,
    purpose: "perception.salience",
    rubricVersion: "2",
  },
);
```

---

## 7. Ledger Persistence & Per-Agent Subjective Storage

### Design Decision: Per-Agent Subjective Ledgers

We explicitly choose to store separate subjective transcripts per character:

- Direct: `agent:<id>:chat:direct:<peer>`
- Group: `agent:<id>:chat:group:<group>`

**Rationale**:

1. **Dual-Wiki Subjective Epistemology**: Characters only possess knowledge of
   events they personally perceived.
2. **Native OpenClaw Compatibility**: Standard channel adapters (Discord,
   Telegram, WhatsApp, Web UI) write and read native agent transcripts without
   custom reverse-proxies or dummy observer agents.
3. **Negligible Storage Cost**: A text chat message averages ~1 KB. 10,000 group
   messages across a 5-member simulation consume only ~50 MB of local SQLite
   disk space. The engineering complexity of a shared observer agent far exceeds
   the disk cost.

### Ledger Writer Contract & Separation of Responsibilities

1. **Perception Never Writes to Ledgers**:
   - Perception is strictly an **Attention / Salience Gate**, not a transcript
     writer.
   - Perception takes pure in-memory `Stimulus` objects, evaluates salience via
     Jev, and delivers cognitive prompts to `agent:<id>:brain`.
   - Perception never calls `appendSessionTranscriptMessageByIdentity` or
     manages session entries for any ledger.
   - Its own records live in the `"perception"` keyed store: per-character inbox
     state, and one entry per attention decision (`<agentId>:decision:<uuid>`).
     Every ledger is replayed into a prompt, so attention mechanics ("noticed
     after 94s", "queued, not steered") stay out of ledgers and never reach a
     character or the decision model.

2. **`send_message` Tool (Egress & Mutual Ledger Writer)**:
   - Implemented in `src/messaging/`; follow
     [the messaging contract](messaging.md), including native `__openclaw`
     sender metadata, simulation timestamps, ordered writes, and idempotency.
     Perception never supplies missing attribution by writing to the transcript.
   - When Agent Alice sends a message to Agent Bob via `send_message`:
     - Writes outbound record to Alice's ledger (`agent:alice:chat:direct:bob`,
       `role: "assistant"`).
     - Writes inbound record to Bob's ledger (`agent:bob:chat:direct:alice`,
       `role: "user"`).
     - After the recipient copy commits, calls `perception.receive()` directly
       with its original simulation timestamp and stable message ID.
       Notification runs outside the ledger write queue; no turn runs in the
       chat session.

3. **`before_dispatch` Hook (Universal Ingress Interceptor)**:
   - Catches external inbound messages targeting `agent:*:chat:*`. Internal
     `send_message` delivery calls Perception directly after ledger persistence.
   - Returns `{ handled: true }` to silence OpenClaw's raw, unmanaged auto-reply
     turn.
   - Extracts the clean message text and forwards the `Stimulus` into
     `perception.receive(recipient, stimulus)`.
   - Does not perform duplicate ledger writes; transcript persistence was
     already completed prior to attention admission.

---

## 8. Task Deadlines as First-Class Sensory Stimuli & Ephemeral Cron Projection

In earlier drafts, task deadlines were treated as an out-of-band procedural
boolean (`state.deadline`). That approach had major conceptual and practical
drawbacks:

1. Deadlines could never interrupt or steer an ongoing thought, even for
   dangerous or urgent countdowns (e.g. food burning on a stove).
2. Deadlines bypassed the Jev attention allocation gate.
3. Procedural timestamp math (`Date.parse(task.endAt) <= simNow`) suffered from
   sub-second timer scheduling jitter.

Kazusa unifies task deadlines under the **universal sensory stimulus model**: in
biological cognition, a kitchen timer ringing or a clock striking the hour is
simply an **internal auditory/temporal sensory stimulus (`Stimulus`)**.

### 8.1 The Stimulus Contract for Deadlines

When Taskman's cron deadline fires, Perception receives it as a first-class
`Stimulus`:

```typescript
const stimulus: Stimulus = {
  id: `task-deadline:${task.id}`,
  sessionKey: `agent:${agentId}:tasks`,
  sender: "kazusa:clock",
  text: `Activity check-in: your ${task.type} activity was planned to end at ${formatSimTime(endAt)}. Reassess your progress.`,
  timestamp: clock.time(),
};
await perception.receive(agentId, stimulus);
```

### 8.2 Ephemeral Session Architecture (`sessionTarget: "isolated"`)

In OpenClaw, `withCronSessionPreparation` enforces single-threaded session lane
serialization (`beginSessionWorkAdmission` on `resolveSessionLane(sessionKey)`).

- If Taskman scheduled a cron directly targeting `session:agent:<id>:brain`:
  - When `:brain` is actively executing (busy thinking), the cron job blocks in
    OpenClaw's lane queue.
  - `before_agent_reply` cannot fire while `:brain` is in-flight, which would
    lock out mid-turn steering and delay deadline delivery.
- By targeting `"isolated"`, the cron job executes in its own uncontended
  ephemeral lane (`cron:<jobId>`).
- When the cron fires, `before_agent_reply` intercepts the turn:
  1. Claims the turn with `{ handled: true }` (silent reply).
  2. Forwards the deadline stimulus into
     `perception.receive(agentId, stimulus)`.
  3. OpenClaw records the cron run as `status: "ok"` (success) on the dashboard
     without LLM inference or transcript writes, then deletes the ephemeral
     session (`deleteAfterRun: true`).

### 8.3 The Cognitive Attention Gate & Attention Floor

Because the deadline enters `state.pending` as a standard stimulus, it passes
through the unified cognitive attention gate, with one fundamental cognitive
invariant: **the passage of time cannot be un-elapsed, and characters are never
taskless**. Therefore, task deadlines possess an **attention floor of
`QUEUE_NEXT`**:

1. **When Brain is Idle**:
   - The deadline stimulus unconditionally wakes the character (`WAKE`) so they
     can reflect, transition activities, or extend the lease via `start_task` or
     `delay_task`. Jev's `wake_decision` is bypassed (`hasDeadline === true`).
2. **When Brain is Busy (Interruption in Progress)**:
   - Jev evaluates the incoming sensory bundle against the ongoing thought and
     active task:
     - **STEER**: If the task deadline is urgent, hazardous, or time-critical
       (e.g. boiling soup, bomb defusal countdown), Jev evaluates `STEER`. The
       character is immediately steered mid-turn.
     - **QUEUE_NEXT**: If the task deadline is routine (e.g. reading a book,
       resting), Jev evaluates `QUEUE_NEXT`. The stimulus waits in
       `state.pending` until the current thought/reply concludes, and then
       drains as a wake turn.
     - **Safety Clamp on IGNORE**: While ambient chat stimuli can be dropped if
       Jev evaluates `IGNORE`, Perception enforces that task deadlines **can
       never be dropped into non-existence**. Any `task-deadline:*` stimulus in
       an `IGNORE` bundle is automatically clamped to **`QUEUE_NEXT`**. This
       completely prevents "zombie characters" (where an agent would be left
       taskless without a future cron wake).

### 8.4 Retiring the Alarm: Preemption and Task Transitions

In human cognition, when an agent consciously abandons or switches tasks early,
they **cancel the alarm**:

- If during an interruption turn the agent decides to stop studying early and
  help Bob, the agent calls `start_task("helping_bob", 45)`.
- Calling `start_task` immediately runs `synchronizeAgentAutomation(agentId)`.
  Because `declarationKey: agentId` is the unique job key, OpenClaw's `cron.add`
  **atomically replaces** the previous scheduled wake job with the new one. The
  old alarm is wiped from the scheduler.
- **Race Condition Defense**: If a millisecond race occurred where an old cron
  fired just before `cron.add` committed, Perception inspects the stimulus
  `taskId` against `taskStore.lookup(agentId)`:
  ```typescript
  if (currentTask.id !== deadlineTaskId) {
    // Stale timer for a retired/replaced task; discard silently
    return;
  }
  ```
  The stale deadline is dropped silently without touching an LLM or distracting
  the character.

---

### 8.5 Interleaving Examples (Collision Scenarios)

The following scenarios illustrate how task deadlines and interruptions
interleave naturally in Kazusa:

#### Example 1: Routine Task Deadline During Conversation (`QUEUE_NEXT`)

- **Scenario**: Alice is reading a book (scheduled until 14:00).
- **13:55**: Bob sends a direct chat: _"Did you see the announcement about the
  election?"_
- **13:56**: Alice's brain starts an LLM turn on `agent:alice:brain` to reply to
  Bob.
- **14:00**: While Alice is still generating her response, the reading deadline
  cron fires.
- **Attention Gate**: Jev evaluates the reading deadline against her active
  thought. Routine reading completion is not an emergency: Jev marks it
  **`QUEUE_NEXT`**.
- **14:01**: Alice completes her message to Bob. Her brain turn ends.
- **Drain**: Perception detects turn completion and drains pending `QUEUE_NEXT`
  items.
- **Outcome**: Alice's brain awakens with the deadline percept. Having just
  replied to Bob, Alice now decides what to do next with full working memory:
  calls `start_task("writing_notes", 30)`.

#### Example 2: Urgent Task Deadline / Hazard During Conversation (`STEER`)

- **Scenario**: Alice is simmering soup on high heat (scheduled for 10 minutes
  until 12:10).
- **12:08**: Bob asks a deep, complex philosophical question. Alice begins an
  extensive cognitive turn.
- **12:10**: The 10-minute soup timer deadline fires.
- **Attention Gate**: Jev evaluates the soup deadline against her active
  thought. Unattended boiling soup is an active hazard: Jev evaluates
  **`STEER`**!
- **Outcome**: Alice's active turn is immediately steered mid-thought. She
  generates: _"Hold on Bob, my soup is boiling over, let me take it off the
  stove!"_, invokes `start_task("eating", 20)`, and avoids burning down the
  kitchen.

#### Example 3: Task Preemption / Switching (`Canceling the Alarm`)

- **Scenario**: Alice is studying in her room (scheduled until 17:00).
- **16:30**: Bob bursts in with an emergency: _"Clara fell down the stairs, I
  need your help carrying her!"_
- **16:31**: Alice starts an interruption turn. She decides to immediately
  abandon studying: `start_task("helping_clara", 60)`
- **Task Transition**: `start_task` replaces the active task in SQLite and
  atomically updates OpenClaw's cron with Clara's deadline (17:31).
- **Outcome**: The 17:00 study alarm is wiped from the scheduler. If a
  sub-second race had caused the 17:00 study timer to pop in transit, Perception
  checks `currentTask.id !== "study_task_id"` and silently discards it. Alice is
  never distracted by a study alarm while bandaging Clara.

#### Example 4: Coalesced Arrival (Simultaneous External and Internal Stimuli)

- **Scenario**: Alice is meditating quietly in her room (brain is idle).
- **09:00:00.100**: Her 30-minute meditation task deadline fires.
- **09:00:00.250**: Within the 500ms coalescing window, Bob sends a message:
  _"Good morning! Are you free for coffee?"_
- **Coalescing**: Perception bundles both stimuli into a single sensory intake:
  ```text
  Incoming chats: [{"sender":"bob","text":"Good morning! Are you free for coffee?"}]
  Scheduled meditating task deadline reached at 09:00:00.000Z.
  ```
- **Outcome**: Alice wakes up in a **single LLM turn** perceiving both that her
  meditation ended and that Bob reached out. She responds naturally: _"Good
  morning Bob! I just finished meditating, so I'd love to grab coffee."_ and
  calls `start_task("coffee_with_bob", 45)`. Zero split-brain, zero redundant
  LLM turns.

---

### 8.6 Proposed Unified Taskless and Overdue Check-in

A consumed one-shot deadline can leave an expired task if the brain omits
`start_task`/`delay_task`; a new character can have no task and no first alarm.
Both cases need the same activity check-in, not a fabricated resting lease.

The current proposal is one service scan every 60 real seconds plus a startup
scan. Skip paused simulation, busy brains, pending deliveries/queued perception,
explicit stops, recovery quarantine, and tasks whose check-in is still in the
future. Taskman detects eligibility; Perception rechecks it under its serial
queue and exclusively owns admission. Existing exact task-deadline cron remains.

Use neutral lifecycle perceptions, unique nudge-occurrence IDs, retained
adoption and cooldown state, and one outstanding wake per character. Recheck
expected task state before dispatch and select skill from current state at
assembly. Do not route background checks through ordinary `receive()` unchanged:
it can clear the explicit stop flag. After five adopted unresolved checks, warn
and use a fixed 15-minute retry interval until a future task resets the counter.

This scheduler is **not implemented yet**. Full design and acceptance cases:
[Character brain context and activity check-ins](../../../../apps/kazusa/docs/brain-context.md).

---

## 9. Configuration & Categorical Attention Decisions

### 9.1 User Configuration (`plugins.entries.kazusa.config.perception`)

| Setting            | Default | Scope                                                                               |
| :----------------- | :------ | :---------------------------------------------------------------------------------- |
| `coalesceWindowMs` | `500`   | Milliseconds to debounce incoming rapid-fire messages into a single sensory bundle. |
| `maxBatchSize`     | `16`    | Maximum stimuli consolidated and admitted together into a single brain turn.        |

_Note_: The decision model provider and routing are configured centrally via
OpenClaw's model runtime (`openclaw.json`), not duplicated in plugin
configuration.

### 9.2 Categorical Attention Decisions

Instead of arbitrary numerical hysteresis bands, Perception respects Jev's
discrete categorical attention decisions directly:

- **Idle State**: `WAKE` (deliver after the scored `response_latency`, often
  immediately), `DEFER` (hold until the current activity ends) or `IGNORE` (drop
  from attention).
- **Busy State**: `STEER` (immediate mid-turn injection via `mode: "steer"`,
  interrupting any in-progress `send_message`), `QUEUE_NEXT` (accumulate for a
  single consolidated wake upon turn completion), `DEFER` (hold until the
  current activity ends), or `IGNORE` (drop from attention).
- See §12 for readiness, task boundaries and paced speech.

---

## 10. Required Interleavings & State Machine Verification

| Interleaving                            | Expected Outcome                                                                                  |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------ |
| Arrival while character is sleeping     | Jev evaluates against `sleep` task; routine chatter returns `IGNORE`; brain remains asleep.       |
| Urgent emergency while sleeping         | Jev evaluates `WAKE`; wakes brain immediately with raw stimulus.                                  |
| Two individually minor arrivals (A+B)   | Coalesced into a bundle; evaluated collectively; combination elevates salience to `STEER`/`WAKE`. |
| Arrival during low-focus task           | Jev evaluates `STEER`; easily steers ongoing run.                                                 |
| Arrival during high-focus task          | Jev evaluates `QUEUE_NEXT`; resists distraction; deferred to `QUEUE_NEXT` instead.                |
| Multiple stimuli in `QUEUE_NEXT`        | When brain run completes, all queued items drained in a **single consolidated wake turn**.        |
| Urgent B arrives while routine A queued | Collective evaluation promotes both A and B to steer the active turn together.                    |
| Task deadline arrives while busy        | Coalesced flag set; delivered together with queued chats on next brain turn.                      |
| Task extended during active turn        | If `delay_task` was called, stale deadline check is dropped when turn finishes.                   |
| Decision model unavailable / error      | Fails open to `WAKE` (if idle) or `STEER` (if busy); never silently drops or stalls stimuli.      |
| Process restart                         | Retained stimuli in `"perception"` store recovered; re-evaluates against live clock and task.     |
| Restart mid-turn                        | Custody reconciled with the brain transcript; a tombstoned `:brain` is cleared and retried once.  |
| Deferred chat when the task ends        | Delivered in the same turn as the deadline check-in (§12).                                        |
| `STEER` while `send_message` is pacing  | Remaining bubbles are dropped; the tool returns said/unsaid before the steer is injected (§12.4). |
| Explicit operator stop                  | Retains pending stimuli in store without immediately triggering an auto-wake.                     |

---

## 11. Architectural Boundaries

- **Perception owns**: Stimulus intake, debouncing/coalescing, Jev decision
  evaluation, collective salience, consolidated queue draining, and `:brain`
  wake/steer triggering. Chat producers own ledger persistence and sender
  attribution.
- **Taskman owns**: Lease state (`tasks`), task duration clamping, and cron
  projection.
- **ContextEngine owns**: Assembling admitted context and stream tails for
  `:brain`. Assembly is strictly read-only and idempotent.
- **Brain (`agent:<id>:brain`) owns**: Qualitative consciousness, tool execution
  (`start_task`, `delay_task`, `send_message`), and narrative reasoning.

### 11.1 Development Human Player Ingress (`before_dispatch`)

Default WebChat is a development bridge, not the production UI. Its hook only
notifies the selected session owner; it does not provide human group fan-out or
guarantee a simulation-timestamped ledger commit before attention. A different
frontend using the same native `chat.send` RPC retains those backend semantics.
See
[messaging](messaging.md#production-human-conversations-required-not-implemented)
for the required conversation-level production ingress and persistence caveat.
Perception remains responsible only for attention; chat producers own writes.

When a development input arrives on `agent:<id>:chat:direct:user:<userId>`:

1. `before_dispatch` claims the message (`{ handled: true }`), preventing
   default unmanaged LLM auto-replies.
2. Identifies the sender as `user:<userId>` (resolving the direct-chat peer or
   plugin config `user.id`), stamps in-world simulation time from Clock, and
   builds a deterministic SHA-256 deduplication ID.
3. Forwards the stimulus to `perception.receive(agentId, stimulus)` for
   attention evaluation against the character's active task.
4. If admitted, the character's decision model and brain evaluate the human's
   message in the context of their relationship card in the Personal Wiki
   (`workspaces/<id>/wiki/entities/characters/sensei.md`).

---

## 12. Human Reply Timing, Task Boundaries & Paced Speech

The design target is a person with a phone. A notification does not mean the
message is read now, and reading it does not mean replying now. People finish
what they are doing, check at natural breaks, and once they pick up the phone
they see everything waiting. Section 3's WAKE/IGNORE gate had two gaps: an
`IGNORE` during a task was never brought back, and two characters woken by the
same group message replied at the same instant.

### 12.1 Decision questions

One `DecisionBatch` carries every question; this adds no Jev latency.

| Brain | Choice question                                                  | Extra question                        |
| :---- | :--------------------------------------------------------------- | :------------------------------------ |
| Idle  | `wake_decision`: `WAKE`, `DEFER`, `IGNORE`                       | `response_latency` (score, see below) |
| Busy  | `attention_allocation`: `STEER`, `QUEUE_NEXT`, `DEFER`, `IGNORE` | —                                     |

- `IGNORE` is final. Ignored keys are kept in `ignoredIds` (bounded like
  `processedIds`); `Perception.noticed()` excludes them, so an ignored message
  never reaches the brain or its "Chats awaiting your reply" view. "Maybe later"
  is `DEFER`. A future cheap pre-filter (e.g. large-group chatter that never
  mentions the character) could skip Jev entirely; it is not built.
- `response_latency` is a `score` question whose ordered criteria are objects
  `{ minutes, description }` from the perception rubric (default anchors 0, 1,
  5, 20, 60, 180 simulated minutes). Perception reads the same criteria from the
  batch, interpolates the fractional score in `log(1 + minutes)` space, and
  applies ±20% jitter so characters with the same score do not reply in
  lockstep. It is used only when the choice is `WAKE`.
- A failed or missing latency answer means zero delay, matching the fail-open
  policy.
- Task deadlines and idle check-ins still bypass Jev when the brain is idle.

**Evidence for timing.** A person deciding how soon to answer weighs who they
are, what they are doing, who is asking, where the conversation stands, and what
it says. The decision state carries each:

| Factor                       | Field                                                                                                           | Source                                  |
| :--------------------------- | :-------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| Temperament, recorded mood   | `character.identity`, `soul`, `memory`                                                                          | workspace files                         |
| Activity and absorption      | `currentActivity` (`type`, `description`, `elapsedMinutes`, `remainingMinutes`)                                 | Taskman lease                           |
| Time of day                  | `simulationTime`                                                                                                | Clock                                   |
| Relationship with the sender | `personalWiki` (sender cards first)                                                                             | personal wiki                           |
| Conversation state           | `conversations[]`: `kind`, `title`, `members`, `youLastSpokeMinutesAgo`, `unansweredMessages`, `waitingMinutes` | Messaging canonical store (`chatFacts`) |
| Content and addressing       | `incomingBundle`, `recentChannelContext`                                                                        | stimuli, ledgers                        |
| Mid-speech                   | `currentSpeech` (busy only)                                                                                     | Messaging outbox                        |

Desires and mood are not modelled yet; when they are, they belong in `character`
next to identity, and the rubric already tells Jev to weigh mood.

### 12.2 Waiting items and readiness

Approved-but-not-yet-delivered stimuli stay in `state.pending` with
`action: "QUEUE_NEXT"` and an optional `until`:

| Outcome                | `until`                                   |
| :--------------------- | :---------------------------------------- |
| Busy `QUEUE_NEXT`      | none: ready when the current thought ends |
| Idle `WAKE`, delay > 0 | `{ notBefore, taskId? }`                  |
| `DEFER` with a task    | `{ taskId }`                              |
| `DEFER` without a task | none (behaves like `WAKE`/`QUEUE_NEXT`)   |

An item is **ready** when it has no `until`, its `notBefore` has passed, or its
bound task is over (the lease is gone, replaced, or past `endAt`). The boundary
binds to the task **id**, not `endAt`: `delay_task` keeps the wait ("study ran
over"), `start_task` ends it ("gave up and checked my phone").

When the brain is idle and **any** approved item is ready, Perception reserves
one followup containing **all** approved items: picking up the phone shows
everything. A fresh `WAKE` with no delay, or an idle deadline, does the same.
Readiness is reached through existing events (deadline cron → `receive`, brain
end → `ended`) plus one per-agent timer for the earliest `notBefore`. The timer
re-checks at most every 30 real seconds, so clock speed changes, pauses, and
`clock_advance` need no extra subscription. `pending` is retained, so waits
survive restarts; `recover()` and the next drain re-arm the timer.

### 12.3 Scenarios

| Situation                                       | Outcome                                                                                                  |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Studying until 15:00, user texts at 14:20       | `DEFER`. At 15:00 the deadline turn carries "Incoming chats" + "Activity check-in" together.             |
| Character extends the study at that check-in    | The deferred chats were already in that turn; replying briefly or holding off is the brain's choice.     |
| `WAKE` after 20 min, but the task ends in 5     | The task boundary makes it ready first; delivered with the check-in.                                     |
| Items waiting, an urgent message arrives        | Fresh `WAKE` with no delay pulls in every waiting item.                                                  |
| Items waiting, a minor message arrives          | It is `DEFER`red or ignored for good; earlier waits are unaffected.                                      |
| Mid-task reaction turn, another message arrives | Busy `DEFER` keeps it for the task boundary instead of forcing another turn right after this one.        |
| Sleeping 23:00–07:00, message at 02:00          | `DEFER`; the character wakes up to their messages.                                                       |
| A group message wakes two characters            | Different latency scores (plus jitter) stagger them; the later one sees the earlier reply in its ledger. |
| Idle supervisor tick while items wait           | Skipped (`queued > 0`); the next wake is already scheduled.                                              |
| Clock paused                                    | `notBefore` cannot pass and tasks cannot end; nothing fires.                                             |

### 12.4 Paced speech and steering

`send_message({ messages: [...] })` keeps the tool call open while Messaging
delivers each bubble as its own canonical message, waiting a simulated typing
interval before every bubble after the first (the brain's thinking time already
showed the typing indicator for the first). While the call is open the brain is
busy, so new stimuli go through `attention_allocation`. Jev's state includes
`currentSpeech: { chat, said, unsaid }` so it can tell that a reply contradicts
what the character is about to say.

OpenClaw's steer queue injects only at the next tool boundary. Perception
therefore interrupts Messaging when it **reserves** a steer delivery (not at
adoption): the tool returns a partial result, and the host injects the steer
message right after it. Without the interrupt, every bubble would be delivered
before the character noticed anything.

Interrupted bubbles were never committed, so no ledger or human ever saw them.
The tool result lists what was said and unsaid; the steer message carries the
interrupting text, so the result does not repeat it.
