# State lab

Tests what the state system does over weeks without simulating weeks. A state
has three jobs, and each is tested on its own with one model call where the live
world needs a day:

| Question                                                             | Tool                      | What it replays                                                                |
| -------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| Does a day move a state the right way, and leave it alone otherwise? | `nights.mjs`              | Bedtime, on a written day whose right answer is known                          |
| What happens over many days: drift, saturation, recovery?            | `nights.mjs` with a chain | Bedtime after bedtime, states and the page on the other person carried forward |
| Does a state change what a character does?                           | `behave.mjs`              | One daytime turn, twice, with only the state block differing                   |

Every prompt is cut from a request the lab Gateway really sent
(`corpus/*.jsonl`, captured with `scripts/llm-capture.mjs`), with the week it
was captured in scrubbed out, and states are rendered and applied by the
plugin's own functions (`reviewText`, `reviewedChanges`, `statsText`). A change
to those functions or to a state's wording is therefore under test as soon as it
is saved.

## The capture

The runners need `corpus/lab-2026-11-17.jsonl`, which is not in the repository:
it is a day of a private world's prompts, word for word. To make one, run a
world for a day and a night with every model request logged:

```
KAZUSA_LLM_LOG=$PWD/scripts/testing/state-lab/corpus/lab-2026-11-17.jsonl \
  NODE_OPTIONS="--import ./scripts/llm-capture.mjs" npm run dev
```

Two characters each need a daytime turn and the turn that goes to bed (the one
whose `start_task` result begins "Before sleep takes you"). The runners take
them by their place among the capture's chat requests: `CAST` in `behave.mjs`
(daytime, 1 and 3 in the lab's capture) and in `nights.mjs` (bedtime, 192 and
199). With a capture of your own, set those to where the turns are in it. A
runner stops with a message naming the request when one is not that character's
turn of that kind. The characters' pages on Sensei are read from
`apps/kazusa/world-lab/.template/workspaces/`.

## Running

```
./run-all.sh deep v0        # the day matrix, the chains and the probes of one variant
node nights.mjs plans/write-v0.json out/write-v0-deep.jsonl 8
python3 score.py out/write-v0-deep.jsonl            # by kind of day, against the labels
python3 score.py out/write-v2-deep.jsonl --delta    # how far fine-grained states moved
python3 score.py out/chains-v0-deep.jsonl --chains  # every trajectory
python3 dynamics.py out/chains-v0-deep.jsonl        # drift and response rates
node behave.mjs plans/probes-v0.json out/behave-v0-deep.jsonl 8
python3 judge-pack.py out/behave-v0-deep.jsonl plans/probes-v0.json judge-v0-deep
python3 judge-score.py judge-v0-deep
```

Runs resume: rerun the same command after a failure. A runner exits non-zero
when any job failed, after the rest have finished, and a reply whose stream
closed before the model said it was done counts as a failure and is tried again,
never kept. A night takes one to two minutes of model time, so a twelve-night
arc takes about twenty.

## Thinking depth is a condition

The lab's own route (OpenRP) ignores `reasoning_effort` and the model thinks for
thousands of tokens a call. OpenRouter honours an effort. Results differ, so a
run is always one or the other: `STATE_LAB_ROUTE=openrouter` with
`STATE_LAB_EFFORT=high` ("deep", about what the lab does) or `low`. `run-all.sh`
sets both. Keep under about 40 streams in all, or connections time out.

## Pieces

- `days/`: one day each, as the character's chat log. `N1` pleasant, `N2`
  logistics only, `SP` a kindness, `KP` word kept at a cost, `SM` a slight, `KM`
  word broken, `RM` broken then repaired, `REAL` the lab's own captured day.
  Written by agents from `brief/day-author.md`; `{DAY}` is filled per night. In
  `RM-koyuki-1` and `RM-koyuki-2`, five of Yuuka's lines were marked as Koyuki's
  own until 2026-11-18; the labels and every number measured before then were
  taken on the days as they were.
- `label/`: what three independent readers said each day should do to each
  state, blind to the kind of day. `score.py` scores against their majority.
- `plans/`: what to run. A chain is `{id, character, days, start, variant}`;
  `variant` picks a bedtime prompt (`prompts/`) and a catalog (`catalogs/`).
- `judge-*/`: pairs of replies, one from each arm in random order, for blind
  judges, with `key.json`. A control probe has identical arms and tells how far
  judges agree with a coin.

## Limits

A replay has no Gateway, no clock, no other characters acting and no memory
retrieval beyond the one page on the other person. It answers what the model
does with a prompt. Whether the live world builds that prompt is a separate
check, on the lab Gateway.
