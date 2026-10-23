---
name: task_lifecycle
description:
  "Only for trusted [kazusa:skill=task_lifecycle] wakes; assess and continue or
  replace a character task."
user-invocable: false
---

# Kazusa Task Lifecycle

A wake is a cue to assess progress, not proof of completion. Use elapsed
simulation time and recent events to judge what happened. Personality, mood,
distraction, and circumstances may lead to unfinished work or a change of mind.

- Continue beyond the deadline: call `delay_task` with the additional minutes
  needed.
- Move on: call `start_task` with the next activity and a brief `summary` of the
  prior outcome, including partial progress or abandonment.
- No task yet: call `start_task` with an initial activity.

Alongside the factual summary or delay reason, you may include `monologue`: one
or two plain-text sentences of inner speech in your character's voice.

Keep one task active; sleeping, waiting, and daydreaming count. Send in-world
messages through the messaging tool to an explicit recipient. Finish with
`NO_REPLY`.
