---
name: openclaw-simulation
description:
  "Guidelines for OpenClaw autonomous character simulation: setting agnosticism,
  circadian rhythms, suggestion over command, silent sleep, and scheduler
  hygiene."
---

# OpenClaw Autonomous Simulation Playbook

This skill governs the behavioral mechanics, circadian simulation, and
architectural boundaries of autonomous agents living in OpenClaw.

---

## 1. Strict Setting Agnosticism & Platform Independence

OpenClaw plugins and persona skills must remain **100% setting-agnostic and
platform-independent**:

- **ZERO World-Specific Proper Nouns**: Never hardcode fictional factions,
  titles, or characters in plugins, tools, or skills.
  - _Forbidden_: Setting-specific titles (e.g. `Sensei`, `Commander`), specific
    student or character names, fictional academies, or faction names.
  - _Required_: Generic terminology (_user, mentor, peer, companion, personal
    quarters, workplace, institution_).
- **ZERO Platform Leakage in Persona Prompts**: Never mention `Discord`,
  `Telegram`, `Slack`, or `WhatsApp` in persona skills. Agents experience an
  in-world reality (_personal device, chat channel, terminal, message tool_).
- **Lore Lives Strictly in Data Files**: Canon belongs in `shared/lore/` or
  `workspaces/<agent>/lore/`, never hardcoded into TypeScript or core skill
  files.

---

## 2. Suggestion Over Command (No Imperious Railroading)

Do not treat the LLM like a rigid script requiring all-caps commands; treat it
like an intelligent roleplayer that needs **logical context, physical friction,
and psychological coherence**:

- **Avoid Aggressive Imperatives**: Never write: _"YOU MUST IMMEDIATELY
  RELOCATE"_ or _"GO TO SLEEP NOW"_. Aggressive commands break immersion and
  lead to robotic compliance logs.
- **Provide Environmental Friction**: Explain physical reality: at night, public
  venues lock up, heating/lights drop, and staying overnight in an empty office
  is cold and unnatural. Natural human friction leads characters back to their
  personal quarters.
- **Allow Realistic Deviations**: Characters can choose to stay up late, study,
  or game—provided there is an authentic in-character reason. Such deviations
  should produce realistic natural consequences (fatigue, grogginess, heavy
  eyelids).

---

## 3. Natural Bedtime & Undisturbed Sleep (Silent Rest)

- **Sleep is Silent**: A background simulation turn (heartbeat) does **not**
  wake an asleep character. Time passing is not an alarm or a notification.
- **The `HEARTBEAT_OK` Exit Rule**: If a character is asleep and the current
  time is before their wake-up alarm:
  - The character remains soundly asleep in bed.
  - They do **not** check their phone or inspect the room.
  - They **must not call `relay_thought`** (unconscious beings do not broadcast
    thoughts).
  - They respond strictly with: `HEARTBEAT_OK`.
- **Token Economy**: Folding living state into the top of `MEMORY.md` allows
  Turn 1 resolution. Exiting sleeping ticks with `HEARTBEAT_OK` in a single turn
  without reading multiple skills saves millions of redundant tokens across
  multiple agents.

---

## 4. Never Edit Live Workspace Memory Files

> [!CAUTION] **The AI assistant must NEVER manually edit an agent's `MEMORY.md`,
> daily logs, or state files.**

- Manually editing character memory destroys the integrity of autonomous testing
  and conceals underlying skill, prompt, or tool bugs.
- All behavioral modifications must be achieved **strictly via skills, tools,
  and runtime prompt design**.

---

## 5. Scheduler Hygiene & Zero Meta-Leakage

- **Minimal, Non-Prescriptive Scheduler Prompts**: OpenClaw persona skills are
  loaded into the agent's turn. Do not bloat cron prompts with complex if/else
  trees:
  ```typescript
  const DEFAULT_HEARTBEAT_PROMPT =
    "Advance your daily life according to your current time and setting. Follow your persona skills to update your state or continue resting silently with HEARTBEAT_OK.";
  ```
- **Clean Cron Job Naming (Avoid Meta-Priming)**: OpenClaw prepends the
  registered job name into the prompt preamble (e.g.
  `[cron:<jobId> <jobName>]`).
  - _Bad_: `heartbeat-jitter-<agent>` (primes the model to talk about heartbeats
    and jitter).
  - _Good_: `routine-<agent>`.
- **Zero Meta-Words**: Words like `"heartbeat"`, `"cron"`, `"system check"`, or
  `"check-in"` must never appear in inner thoughts, current activity headers, or
  outbound dialogue.
