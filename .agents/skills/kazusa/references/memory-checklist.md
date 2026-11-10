# Memory implementation checklist

Tracks [memory.md](memory.md). Tick items only when they are verified; note how.
Migrations are scripted (`apps/kazusa/scripts/`) and back up to
`.state/backups/` first.

## Needs a decision or content from the author

- [ ] `remember` is never called by `zai/glm-4.7-flashx`, despite direct cases
      and firm guidance (see Live results). Try a stronger model on one
      character, or accept that sleep catches plans and new people later.
- [ ] Review the 36 concepts at `renown: known` with no community, especially
      secrets such as `gematria`, `maestro_mimesis`, `shittim_chest`.
- [ ] `rabu-komakaze`: `school: Formerly Trinity General School` resolves to no
      page (the one world lint error).
- [ ] `natsu-yutori/memory/MEMORY.md` and `reisa-uzawa/memory/MEMORY.md`: left
      in place, no date to file them under.
- [ ] `summary` written for concepts where the first sentence is poor
      (optional).
- [ ] Delete `.state/backups/before-chat-cleanup-*.tgz` and older memory backups
      when happy: they hold the removed content, as does git history.

## Done

Phase 1, hygiene:

- [x] `skipBootstrap`; no workspace `AGENTS.md`/`USER.md`
- [x] `session-memory` off, `memory.search` removed,
      `plugins.slots.memory: "none"` (ends dreaming), applied and loaded by the
      Gateway
- [x] `MEMORY.md` injection does not depend on the slot (read in the host's
      code, not yet seen in a real turn)

Phase 2, format and depth:

- [x] Parser, depth with reasons, lint, `/kazusa/wiki/lint`,
      `/kazusa/knowledge/explain`, ARONA's `wiki_lint`, `knowledge_explain`
- [x] World-agnostic: anchors are `memory.anchors` (default `club`, `school`),
      and name-like words are generic

Phase 3, backfill: `lore/` into `concepts/`, `community`, `renown`, card leads,
relationship cards, root pages, notes, numbers to `relation`, machine state,
diaries into `days/`, guesses for the clubmates and Natsu's and Yoshimi's
Sensei.

Phase 4, index and retrieval: FTS5 index, freshness on read, six signals, **On
your mind**, **People you know**, Places-you-know, preview route, skills.

Phase 5, embeddings: `embeddings.ts`, background indexing, 1.5 s query limit
with keyword fallback, measured.

Phase 6, tools: `recall`, `look_up`, `remember` run in `tools.test.ts`;
character file tools and memory-core tools removed from `openclaw.json`.

Phase 7, sleep (`sleep.ts`, `sleep-consolidation` skill): trigger, input,
schema, source validation, apply, preimages, watermark, note cap, journal, wake
abort, deadline hold, `memory_consolidate`, `memory_restore`. **Tested with a
fake model only; never run on a real model. Off by default.**

Phase 8, world history: `## History`, `seen`, **Since you were last here**,
news, future-dated lines stay hidden.

Phase 9, client: Wiki section with the world next to a character's page, depth
and why, diary, per-night diffs, problems; `memory.consolidated` on the
Timeline.

Review fixes (2026-10-30): sleep watermark no longer loses a backlog;
`always known` notes survive the cap; recent news surfaces unmentioned; no
`community` graph edge.

## Next

- [ ] Hide strangers' names in sightings and **With you**. Ids carry names, so
      this needs opaque handles that `send_message` resolves, and a rule for
      when someone counts as introduced.

## Evaluation

- `src/memory/fixtures/`: 104 cases over 3 synthetic worlds (port city with
  guilds, company with teams, colony ship), none from the shipped world. 88 run
  in the unit suite; 12 paraphrase cases need
  `node scripts/memory-eval.ts --fixtures --embed`.
- First run, before fixes: 84 of 92 keyword cases. Now 88 of 88, and 98 of 100
  with vectors. Missing: "what keeps the lights on" and "planning to overthrow
  the bridge".
- `scripts/memory-eval-cases.json`: 32 cases on the shipped world.

## Live results (2026-10-31, `zai/glm-4.7-flashx`)

- Tokens: measured 50-80k input per call for the main characters until past
  brain turns stopped being replayed (2026-10-31); the 12-16k noted here before
  came from an estimate, not provider usage. Now about 12-13k in replay.
- Turn shape: at most one activity per 2 minutes (blocked in code), at most 2
  lookups per run. A send that repeats this run's words is blocked.
- Retrieval: right people, guesses and threads in **On your mind**; acceptance
  1-7 checked on the live Gateway through `/kazusa/memory/preview`.
- `look_up`: used correctly. `recall`: used, sometimes needlessly; repeats now
  capped.
- `remember`: never called. Sleep writes the same facts later, unless a
  character doesn't sleep.
- Sleep: fires from a real bedtime; good diary, voice, sourced notes and new
  concept pages. Watch that a rewritten `view` keeps what still holds.

## Known weak spots

- Invented facts: replayed against real prompts with 207 unknowable questions
  (routes, numbers, family, false claims, pressure, held-out cases). About 1 in
  4 replies invented an answer before. With the rule in `context-conventions`
  and the reminder closing each delivery, about 2% still do, mostly hedged
  guesses ("I think it might be..."), which the author accepted; one reply
  stated invented details outright. It can overcorrect: Natsu said she didn't
  know the way to her own school's Main Gate, and Yoshimi accepted a false
  premise while saying she didn't remember it.
- Double sends came mostly from replayed brain turns the model copied (18 of 24
  runs double-sent; 3 of 24 once they were gone, on a small sample; 16 of 82 on
  the wider set). `turn.ts` blocks an identical send within a run, and the model
  can loop on the block until the host ends the run (3 times in a 9 minute live
  round with 4 characters). A run ending in an error leaves `stopped` set, so
  that character's pending messages wait for the next new stimulus.
- Characters still copy each other: live, Airi sent Natsu's "I'm on my way" line
  as her own, and the same line can recur across runs. Not yet explained.
- Characters are far more talkative since the "stay silent" note went, and false
  claims in test chats can stick: Yoshimi later said "I know I lost a bet to
  Natsu" after only being told so.
- In replay, 13-18% of runs ended in plain text with no `send_message`, so the
  reply reaches nobody. Not measured live.
- The Timeline lists a message between two characters twice, once per side of
  the chat. One send, two rows.
- Old brain turns still mention the host's room event note, which was removed on
  2026-10-31. They age out of the history.
- A character can stay up all night with hourly check-ins, so no consolidation.
- Acceptance 8-9 not judged live: the guess reaches the prompt, but whether
  replies use it was not assessed, and Perception's recognition is unit-tested
  only.
- Restarts need agent databases to finish preparing (minutes with 139 agents);
  until then messages wait and cron maintenance may log failures.

## Live acceptance (after the first section is clear)

Pace at 1x or paused and jump with `clock.advance`. Each test records the
expected page, and the reply is read for whether it was used. The situation
message itself is no longer kept, so whether the page was on their mind is read
from the reply alone.

1. **Interlocutor recognition**: Sensei texts Kazusa something with no names;
   her `sensei` page is in **On your mind**.
2. **Named person**: "have you seen Natsu today?" brings up Natsu's page.
3. **Nickname**: "Cath Palug" brings up Kazusa's own past, not a page for a
   stranger.
4. **No omniscience**: a Trinity student asked about a Gehenna room gets nothing
   from it, and says so in character.
5. **Heard-of depth**: the same student asked about the Prefect Team gets one
   line, not its inner workings.
6. **Exclusive section**: a `Known by:` section reaches only those listed.
7. **Mid-run edit**: edit a personal note and text the character; the next turn
   shows the edit, no restart.
8. **Second-order belief**: the guess appears and the reply is not simply warm.
9. **Perception**: the decision context carries the same recognition for a
   message from a close friend, with no embedding call.
