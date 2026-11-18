# States: Values a World Keeps

Status (2026-11-17): built, `src/stats/`. Player states (§6) were added on
2026-11-17 and are covered by unit tests only. §0 says what a state is for,
rewritten the same day from what §5 measured; §5 says what was checked, what was
measured and what was left out.

People say **state**; the code says **`stats`** (`src/stats/`, store `"stats"`,
SSE `stats`, domain `stats`, `shared/stats.json`), because `state` (keyed
stores, desire state words) and `status` (presence) already mean other things.

## 0. What it is, and what it is for

A state is a named value on a character, on one character's view of another (a
pair: directed and private to its owner), on the world, or on the human player
alone (§6). A world defines its own in Settings → States; `outfit` is built in
(§3). The user can always set any of them.

**A state records where things stand. It never tells a character who to be.**
Personality and memory decide what a character does, and a state that pulls
against them loses (§5). So a state is one of two things:

- **A fact they have to live with**: money, what they are wearing, an injury,
  the week it is, the chapter of the story. A real person carries these, and a
  character acts on them: with 1 left they do not buy what costs 6. Usually on a
  `character` or the `world`, changed as they act (`character`) or by hand
  (`manual`).
- **A meter of where things stand**: how one person regards another, a mood over
  weeks, a reputation. A real person consults no number for this; they remember
  what happened. A meter follows that memory and does not steer it: the review
  that rewrites what they keep about someone moves it in the same breath. It is
  there for the player, who watches it move for a reason, and for whoever runs
  the story, who can act when it crosses a line. Usually a `pair` or a
  `character`, `reviewed`.

What follows:

- Never define a state to make a character behave some way. Change who they are
  (SOUL, IDENTITY) or what they remember (their wiki).
- Set a meter by hand and nothing they do follows, unless their page on that
  person is rewritten to match.
- When something must happen at a level (a scene opens, a secret is told), read
  the state and make it happen. A character does not act the number, and no rule
  layer does it for you yet (§5).
- By the method in the kazusa skill §0: code keeps pace and levels (`step`,
  bands, clamping), the character judges what happened and which way, and the
  prompt carries a fact where it must be respected and a meter where it is
  reviewed.

Not desires (a forecast that ramps over a task and drains with time; they keep
their module and closed form), not location or tasks, and not memory: what a
character believes about someone stays prose in their wiki. Relationship values
never go in a card's frontmatter (`memory/page.ts` reports them as a problem).

## 1. The one idea: a reasoning model changes a value, at a moment it already runs

A value changes only where the character's own model is already thinking, so no
state adds a model call. The attention decision (Jev) never changes one: it
classifies and cannot reason about a rubric (tried first, removed 2026-11-16).

| `changedBy` | For                            | How                                                                                                  |
| :---------- | :----------------------------- | :--------------------------------------------------------------------------------------------------- |
| `character` | outfit, mood, HP               | Awake, in their own turn: `changes` on `start_task`, or `change_state` in the middle of an activity. |
| `reviewed`  | regard, anything with a rubric | Asleep: the sleep pass looks back on the whole day and returns what moved.                           |
| `manual`    | STR, level, a chapter          | Nobody. The user and the system agent only.                                                          |

The user (`POST /kazusa/stats/set`, by `user`) and the system agent
(`set_state`, by `system`) can set any state, whatever its `changedBy`.

The rule a character goes by is the state's `description` (and each value's): it
is the one thing a model is told. Say what moves it, by what happens: "only when
they kept or broke their word to you". How far it moves is not the description's
to say: with bands that is one `step`, held by code.

## 2. Definitions (`shared/stats.json`)

Definitions are text in the world, so a creator ships them and anyone can edit
the file; values are play and live in the store. The file is read again whenever
its mtime or size changes (`catalog.ts`), so an edit by hand or by the system
agent needs no reload; a file that doesn't parse is reported once and read as no
states. Schema: `StatDefinitionSchema` in `@kazusa/client`
(`packages/client/src/stats.ts`), with the helpers both sides share
(`coerceStat`, `statValue`, `statBand`, `statWord`, `statsOf`, `wornOutfit`).

| Field         | Meaning                                                                                                                                                                                                                                               |
| :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `^[a-z][a-z0-9_]*$`, shown to models as written. `outfit` is reserved.                                                                                                                                                                                |
| `description` | What it is and when it changes. The one thing a model is told about it.                                                                                                                                                                               |
| `on`          | `character`, `pair`, `world` or `player` (§6).                                                                                                                                                                                                        |
| `kind`        | `choice` (`values: [{ name, description? }]`, `initial`) or `number` (`min`, `max`, `initial`).                                                                                                                                                       |
| `bands`       | Number only: `[{ name, min, description? }]` ascending, the first from `min` or below and none above `max`, so every value has a word. With bands a character reads the word, else `14/20`. A band's or a value's `name` is one line without a colon. |
| `step`        | How far one move takes a number with bands, and one press of an arrow key in the client. 1 when absent.                                                                                                                                               |
| `changedBy`   | §1. `world` and `player` are `manual` only; `pair` is `reviewed` or `manual`.                                                                                                                                                                         |
| `shown`       | `self` (they read it), `everyone` (people with them see it too; not for a pair), `nobody` (UI only).                                                                                                                                                  |

**How many.** The file holds up to 64, but keep the states that reach a
character (any they read or change: `shown` not `nobody`, or `changedBy` not
`manual`) to about 8 (`STATS_ADVISED`; Settings → States counts them and says
so). Every one is in `Your state` each turn, each character-changed one is
described in `start_task` and `change_state`, and states toward someone repeat
per person at hand. The number is a judgment, not yet measured. A stat sheet
(STR, INT, DEX) that only code or the user needs should be `manual` and
`nobody`: it costs no prompt.

**How a model gives a value** (`statMoved`). A choice: one of its values. A
number without bands: the new number, or a signed change as a string (`"-3"`),
so the model does no arithmetic. A number with bands: only `up` or `down`, one
`step`, clamped; a number is dropped (or refused by `change_state`). Models
judge which way well and how far badly, and "a step at most in a day" becomes
something code holds to instead of something the description hopes for. The
holder never sees the number: they read the band, with `, close to <band>` when
one move would cross into it (`statStanding`), and where the bands are more than
a step apart they are told so (`statStride`, `howMoved`: "It moves in small
steps, about 8 from one of these to the next"). Read as a whole word a step,
"up" looks too big to give and the state never moves. The user and the system
agent still set any number directly.

**How far apart the bands are sets the pace.** One thing that mattered moves a
state one step, so the steps between two bands (`statStride`) are how many such
things change the word. A state meant to build over weeks wants about 8
(`STRIDE_ADVISED`): at 3, a fortnight where nothing happened moved trust a whole
band; at 8 it held (§5). A slow state should never be a `choice`: each value is
a whole step and it hardly moves. Settings → States says both as a state is
defined (`statAdvice` in `apps/web/lib/stats/advice.ts`).

## 3. Outfit, the built-in

What a character wears is a state every character with outfits has, never in
`shared/stats.json`: its values are that character's own outfits (the words
their `stickers/stickers.json` declares, each with what is worn) plus `usual`,
the initial. `outfitStat` builds the definition; `statsOf(catalog, outfits)` is
one character's states, and `StatsResponse.outfits` carries each character's
outfits to the client. It is `changedBy: character`, `shown: everyone`.

It is the one state code acts on:

- `send_message` offers only the stickers (`wornStickers`) and the faces
  (`faceMoods(portraits, worn)`) of what they are wearing, so a character in a
  swimsuit cannot send themselves in uniform, and refuses a sticker of anything
  else when it is sent. An outfit with no portraits falls back to the usual
  clothes' moods; one with no stickers offers none.
- The Scene view draws the figure in it (`useWornOutfit` sets `Look.outfit`).
- People with them read `Name: outfit: swimsuit (what is worn)`.

Tool factories are synchronous and a store read is not, so `stats.wearing(id)`
reads a process-wide copy of each character's outfit entry, filled at
`gateway_start` (`load`) and on every change.

## 4. Mechanics

- **Store**: `"stats"`, one `StatRecord` per character or player,
  `{ own: { [name]: entry }, toward: { [otherId]: { [name]: entry } } }`, and
  the world's under the key `world`. An entry is `{ value, at, by }`; no entry
  means `initial`. An entry is read through the definition as it is now
  (`statValue`): a number is kept within the range, so 40 under a `max` lowered
  to 30 reads as 30, and a word the choice no longer has reads as `initial`.
  Deleting a definition keeps its values. Changes to one record queue
  process-wide (`kazusa.stats.queues`). Never Markdown, never a ledger.
- **`changes` on `start_task`** (`changesParameter`, worded by
  `kazusa-tools#start_task.changes`): required while the character has a state
  they set themselves, `{}` for none (an optional parameter is never filled),
  absent otherwise. Per character (`TaskExtension.startTaskParametersFor`),
  since outfits differ. States are named once in prose with a `propertyNames`
  enum, like `afterwards`. A value the state can't hold, a state that isn't
  theirs or an unchanged value is dropped, never refused. A real change adds
  `kazusa-results#state-changed` to the ledger row and `states` to its journal
  payload, both with the value as written: a change is worked out again inside
  the record's queue, so `-3` after another `-3` reports 14, not the 17 it stood
  to be when the call was checked. Not on `delay_task`.
- **`change_state`** (`{ name, value }`, worded by `kazusa-tools#change_state`):
  the same states, in the middle of an activity. Absent for a character with
  none. Says what is wrong with a value it can't hold, or that nothing changed.
  A character tool: it needs `contracts.tools` and `base.json`'s `alsoAllow`; a
  world made before it gets it at the next start (`allowNewCharacterTools`,
  `scripts/plugin-startup.mjs`).
- **Sleep review** (`SleepDeps.states`, `stats.review`): the sleep message ends
  with `# Your states`: each `reviewed` state as described, where their own
  stand, and where those toward each person who spoke in the day's records stand
  (`reviewText`). The night's JSON may carry
  `states: { own: {…}, toward: { <id>: {…} } }`; only reviewed states, toward
  people of the day, with a value the state can hold are applied
  (`reviewedChanges`), by `reviewed`. Worded in `sleep-consolidation`. A failure
  never costs the night. Undoing a sleep run does not undo its state changes.
- **Prompt**: `### Your state` in the situation message, after How you feel
  (`statsText`): their own; `Toward <person>` for people with them or named in
  what arrived; other people's `everyone` states that differ from the initial;
  `The world`. A value carries what it means where the world says (a choice's
  value description, a band's: `statMeaning`). Under them, `What these are:`
  describes each state the lines name, once, however many lines name it: a value
  with nothing saying what it is tells its reader nothing.
- **Read model**: `GET /kazusa/stats`
  (`{ catalog, revision, records, world, outfits }`),
  `POST /kazusa/stats/catalog` and `/stats/set` (`manage`), SSE `stats` with one
  whole record, or `catalog: true` to refetch. A catalog save carries `base`,
  the `revision` it was made from, and is refused with 409 when the states have
  changed since (another session, the system agent, an edit by hand), so it
  never undoes a change it did not see. The client reads again, through the
  stream's sync (`liveStats.whole`) so the read is not dropped, and asks the
  user to save again. A Gateway started before this gives no `revision`, and its
  saves go unchecked. The revision does not cover a form left open: the page
  follows the stream while the form keeps what it opened on, so the form is
  refused when the state it opened on has changed or gone since
  (`editConflict`). A save that touched no meaning keeps its line breaks
  (`withLinesKept`): the form lists meanings one to a line. The client takes
  only what a write changed from that write's response, and not even that when
  the stream changed the same thing while the request was out (`afterStatSet`,
  `afterStatCatalog`: it reads again if the two differ). It makes a whole read
  outside SWR with the record events that arrived meanwhile put back on top
  (`apps/web/lib/source/stats/sync.ts`): a patch to an SWR cache drops a read of
  it under way. A read that fails is tried again by itself, a few times with
  longer waits (`RETRY_MS`).
- **Changes in order**: a change worked out from where a value stands (a signed
  number, a step up or down) is worked out inside that subject's write queue
  (`apply` in `stats/register.ts`), so two at once each start from the other's
  result.
- **Client**: Settings → States defines them (with examples, advice under a
  field where a state would work badly as defined, and a number's words drawn to
  scale, §2); a value is set where its subject lives: the world's beside the
  clock in the top bar, a character's in the inspector's States section, the
  player's own in the same section, opened by You in the status bar. A
  character's section is folded, its summary where their states stand, because
  they are read far more than set; Toward lists who they hold something toward.
  Nothing in the client puts a value back to its initial: `value: null` on
  `/stats/set` still does. See the `kazusa-client` skill.

## 5. Checked live, and not built

Checked on the lab world with a real model (2026-11-16, GLM-5.3-flash, one
character): `### Your state` in the prompt; `changes: {}` on an activity that
changed nothing, then `changes: { "outfit": "gym" }` when she changed; the next
turn offered only `gym-*` stickers and the gym portraits' moods, and she sent
`[sticker=gym-calm]`. **Not yet run with a model** on this branch: the sleep
review of the sleep pass, and `change_state` (offered, never called in the run).

Measured on replays (2026-11-17, branch `feat/sleep-in-brain`, where a character
goes over the day in the turn that goes to bed and gives `states` on `reflect`;
`scripts/testing/state-lab/` there, with a README; about 4,500 replays on
GLM-5.3-flash). A replay is a captured prompt with one thing changed, so a night
costs one model run instead of a simulated day. The harness applies states with
this module's own functions, but the old sleep pass on this branch was not
measured.

- **A day moves a meter.** With bands about 8 steps apart and that branch's
  `sleep-consolidation#states` wording, a kept promise raised trust on all 24
  nights it was tried, a broken one lowered it on 23 of 24, and twelve
  uneventful days moved it 0.7 to 1.3 steps of 8. With bands 3 steps apart and
  the earlier wording the same twelve days moved it 1.5 to 3 steps of 3: up to a
  whole band on nothing. A 4-word `choice` rose on 24% of good days and fell on
  3% of bad ones.
- **What still leaks.** A slight or a broken word lowers liking only about one
  time in five: the character reasons that they still like the person, which is
  theirs to decide. About 15% of ordinary nights after a good day move up again.
  Two states fed by the same events (liking, trust) move together. Some runs
  still read one step as becoming the next word and so give none. On the live
  lab Gateway two nights (a kept promise, then a broken one) moved nothing: with
  a real week behind her, one event was weighed against the pattern.
- **Only a fact steers.** Blind judges told a wallet of 1 from one of 40 in 39
  of 40 pairs and exam week from an ordinary one in 34 of 40. For trust, regard,
  composure and spirits they were at chance. The character does read the words
  (her reasoning named her trust in 21 of 24 runs) and then acts from who she
  is. Neither a line saying the block is newer than memory nor bands worded as
  actions changed that (lending a ledger at "absolute" against "guarded" trust:
  2 and 1 of 12; 0 and 0; 4 and 0). The history behind a meter does steer: with
  the page and state twelve courted days leave, a character lent her lucky coin
  11 times in 12; with those of twelve days of being let down, once.
- **Bookkeeping holds.** Paying 6 from 20 left 14 in 22 runs of 24, nobody went
  below zero, and being embarrassed lowered composure 22 times in 24.
- **Thinking depth matters, and one route ignores it.** OpenRP passes
  `reasoning_effort` on and the model thinks for thousands of tokens whatever it
  says, which is where minutes-long turns come from. Where the effort is
  honoured, low effort moves meters on routine days about one and a half times
  as often.

Not built:

- **A rule layer.** Nothing happens when a meter crosses a band. §0 needs it:
  something that reads a state and opens a scene, tells the system agent, or
  writes a line into the character's memory so that what they do follows.
- **The reason with the change.** A night that moves a meter also writes why, in
  the page, but the change carries no reason and makes no timeline event, so the
  player sees a number move and not what moved it.
- **Tallies.** A character keeps count on their own ("that's two you owe me
  now"). A state that counts what happened (words kept, words broken), with the
  band worked out in code, would ask the character only what they judge well.
  Untested.
- **Meters out of the daytime prompt.** A `reviewed` state is in `Your state`
  every turn, where it costs words and does not steer; showing it only at the
  review is untested.
- Per-pair starting values. Everyone starts at `initial` toward everyone, so two
  old friends read "no particular feeling" until someone sets the pair.
- A timeline event per change, place states, per-character `max` or `initial`,
  dice, and drift or reset rules.
- A sticker or face of another outfit is not refused when sent, only not
  offered.
- A state with bands moves one step per answer, but nothing in code stops two
  answers in one night; a number without bands moves as far as the answer says.
  The description is the rule for both.
- Player states (§6) have not been run with a model or in the client against a
  live Gateway: unit tests only.

## 6. A state only the player has (`on: "player"`)

The human player has a body too: how tired they are, what they carry. A `player`
state is a value only the player has and only the player sets (the system agent
can as well), which the characters with them read.

- **Schema**: `changedBy` is `manual`; `shown` is `everyone` (people with the
  player read it) or `nobody` (client only). There is no `self`: no model reads
  the player's own prompt.
- **Whose it is** (`statsOf(catalog, { player, outfits })`): the player's states
  are the `character` states, as before, plus the `player` ones. A character's
  never include them: not as their own in `Your state`, not in `changes`,
  `change_state` or the sleep review, and `set_state` and `/stats/set` refuse
  one on a character ("a state of the player"). The value is in the player's
  record under `own`, set with the player's id as `characterId`.
- **Prompt**: a character with the player reads it the way they read anyone's
  `everyone` state: on the player's line (`Name: tired: worn out (…)`), only
  while it differs from its initial, and described once under `What these are:`.
  So write the description about the player as others see them. A character
  whose own catalog shows nothing still gets `### Your state` when someone with
  them has something that shows.
- **Client**: Settings → States offers "You, the player" under Who has it; the
  values are set in the inspector's States section opened by You in the status
  bar.
