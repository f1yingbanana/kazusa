# Perception — Stimulus Routing and Attention Admission

Design only. Planned as `plugins/kazusa/src/perception/` in the unified Kazusa
plugin. No Perception routing or queue implementation exists yet.

## Responsibility boundary

Perception decides **what happened to this character, where to record it, and
when it should reach their brain**. The context engine decides what historical
context to show once a run has been admitted. Taskman owns leases, their task
ledger, and dashboard-visible cron projection—not the brain session.

`producer → Perception pending stimuli → admission → agent:<id>:brain`

Ledger writes and cognitive delivery are distinct. Never start character runs on
chat/task ledgers. One brain remains the sole execution lane even while
different conversations or physical events compete for attention.

## Stimulus kinds

| Kind                                    | Record / destination                                                                    | Cognitive meaning                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Incoming direct/group chat (with media) | Owner's `:chat:direct:<peer>` / `:chat:group:<group>` view                              | Someone said/shared something; media is preflighted with Context Engine background and stored as `[Image: <summary>]`. Replying is a character choice. |
| Physical encounter                      | Perceivable in-world observation; exact record convention to be designed                | Meeting a person is not receiving a chat message.                                                                                                      |
| World event                             | Only affected characters' perceivable observations                                      | No omniscient broadcast of hidden world state.                                                                                                         |
| Task due                                | Taskman supplies the deadline stimulus; existing `:tasks` ledger describes the activity | Cue to assess progress, not automatic completion or a forced transition.                                                                               |

Reuse native message text and timestamps. No speculative event metadata schema,
new experience stream, external-channel adapter, or additional database yet.

## Secondary queue and admission

- Keep pending stimuli separate from OpenClaw's execution/steering queue.
- **Multimodal Preflight & Grounding**: When an incoming stimulus contains
  images or media attachments, Perception coordinates with OpenClaw's Media
  Understanding pipeline (`tools.media`) or a vision model. It provides the full
  narrative background from the Context Engine (location, speaker identity,
  recent conversation thread) to ground the visual description. The resulting
  semantic summary is written into the recipient's `:chat:*` ledger as an inline
  `[Image: <summary>]` block with an attachment reference. High-resolution
  re-inspection is performed on demand by the brain via
  `view_image(path, prompt)`.
- Observe native run lifecycle/activity for each brain. A busy check is not a
  lock: checking and admitting must preserve single-session ordering.
- If the brain is idle, admit eligible input to wake it. If busy, evaluate
  whether an event merits immediate attention/distraction through steering or
  should wait until a useful boundary. Event type alone need not determine
  urgency; character and situation matter.
- Deferred events remain pending, not silently dropped. Re-evaluate when the
  active run completes, errors, or is interrupted. Busy detection must recover
  after restart; exact queue persistence and acknowledgement rules are TBD.
- Steering is additional perception, not a command to abandon the prior
  stimulus. Skills teach reassessment while preserving unfinished intentions;
  personality may still lead to distraction or a switch of focus.
- The gate prevents automatic steering floods but does not by itself prove
  starvation freedom. Choose and test a bounded admission/fairness policy when
  implementing it; do not claim prompt wording alone solves starvation.

Do not pause, extend, or conclude a task merely because an interrupt arrived.
The character must use `start_task` or `delay_task` if their activity changes.
Before delivering a deferred task-due stimulus, revalidate it against the lease
so a replaced/delayed task does not trigger a stale completion reaction.

## Native integration constraints to verify during implementation

- Route/admit before the native run pipeline. `assemble()` is too late and may
  run again on retry. Message observation hooks are not automatically routing
  hooks, and a plain subagent run is not proof of steering support.
- Media attachments must never store raw base64 or heavy vision tokens into chat
  ledgers; store only lightweight `[Image: <summary>]` text descriptions and
  local attachment paths. Re-inspection occurs explicitly via `view_image`.
- Verify the chosen native dispatch surface preserves agent ID, brain session,
  queue mode, delivery suppression, requester authority, and cancellation.
- Taskman's current cron payload directly targets `:brain`. This bypasses the
  planned gate until an explicit integration is implemented; changing a skill or
  naming a module does not intercept cron execution.
- Persist simulation occurrence time at ingestion via `clock.time()`, not the
  later admission time. Deferred events keep their original event timestamp.
- The task ledger is written by Taskman; Perception must not duplicate it. Chat
  producers/Perception will write each participant's permitted view with native
  `message.timestamp` in simulation time. Operational session metadata,
  transcript envelope creation times, and cron deadlines remain real-time.

## Acceptance tests for the future implementation

Route different stimulus kinds without leaking another character's records; wake
an idle brain; steer or defer a busy brain; admit deferred input after
completion/error; preserve earlier intentions; reject stale task wakes; avoid
duplicate delivery across retries; and demonstrate bounded progress under a
burst of stimuli. No test should assume interrupts automatically pause tasks.
