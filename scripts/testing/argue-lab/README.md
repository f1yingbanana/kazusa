# Argue lab

Can a character argue, and stay hurt? Replays one real daytime turn (the state
lab's capture and model routes: `../state-lab/README.md`) with a scenario
spliced in, so a question about behaviour costs minutes, not a day of the live
world.

- `scenarios.json`: a friend's message to Yuuka (from Noa) or Koyuki (from
  Yuuka) after a plain wrong (`wound`: a broken promise, credit taken, a secret
  told, a public slight) or nothing wrong (`neutral`), with the history as the
  character remembers it, and two follow-ups for a second exchange (`light`, a
  brush-off; `real`, a real apology).
- `run.mjs <arms> <out.jsonl> [runs] [concurrency]`: the arms (`ARMS` in the
  file) differ in one thing; today's conventions are swapped into the captured
  prompt, with or without "Disagree, and stay hurt".
  `ARGUE_LAB_FROM=<first run> ARGUE_LAB_FOLLOW=light|real` replays the second
  exchange after each wound reply; `ARGUE_LAB_ONLY=<id prefix>` for a smoke run.
- `label.mjs <run> <labels>`: blind labels (HOLDS, RELENTS, HURT, SMOOTHS, NONE)
  and how believable each reply is; `score.py <labels>` tallies by arm.

```
export STATE_LAB_ROUTE=openrouter STATE_LAB_EFFORT=high
node run.mjs base,argue out/v1.jsonl 6 20
STATE_LAB_EFFORT=low node label.mjs out/v1.jsonl out/v1-labels.jsonl 24
python3 score.py out/v1-labels.jsonl
```

`out/` holds model output and is not committed. Results so far are in
`.agents/skills/kazusa/references/director.md` (Lab 1).
