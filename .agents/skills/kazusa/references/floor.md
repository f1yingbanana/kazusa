# The Floor: Turn-Taking in Face-to-Face Conversation

Status (2026-11-05): built and unit-tested (`messaging/floor.ts`,
`messaging/composing.ts`, Messaging's `play`, `Perception.judgeSpeech`); not yet
run live. Designed in the order set by the kazusa skill §0: simulation, then
player, then prompt. Builds on huddles ([location](location.md) §4.6) and paced
speech ([messaging](messaging.md), [perception](perception.md) §12.4).

Goal: a huddle sounds like people talking. Usually one at a time; in a heated
moment, over each other, because someone chose to.

## 0. The problem, measured

Live run, 2026-11-02 03:09–03:39 sim time, clock at 1x (pauses excluded):

| Huddle                   | Lines/min | Spoken words/min | Talking at once\* | Switches that start over the last line\*\* | Words/line |
| :----------------------- | --------: | ---------------: | ----------------: | -----------------------------------------: | ---------: |
| Trinity lunch (5 people) |      14.4 |              319 |              ~2.1 |                                        74% |         26 |
| Millennium (4)           |      11.5 |              271 |              ~1.8 |                                        71% |         26 |
| Momoi + Neru             |       9.1 |              174 |              ~1.2 |                                        60% |         23 |
| Hare + Kotama            |       6.1 |              115 |              ~0.8 |                                        57% |         19 |

\* Spoken words/min ÷ 150 words/min, a typical speaking rate. \*\* The next
speaker's line started less than half the time it takes to say it after the
previous line.

Each line reaches every other member as a stimulus, so the 5-person table
produced about 1,400 attention decisions in 30 minutes, 57% of them "queued".
The cause is physical, not cognitive:

- **No floor.** `speechTail` keeps one character's own bubbles in order; nothing
  orders different speakers in one huddle.
- **The first line takes no time to say.** `typingMs` paces only the bubbles
  after the first, so every turn's opening line lands the instant the tool is
  called, usually in the middle of someone else's.

Overlap itself is not the bug: people do talk over each other. The bug is that
here it is the default, chosen by no one.

More thinking delay would not help. The median gap between lines is already ~3 s
(model latency at 1x), slower than people's ~200 ms. A uniform delay moves every
listener's reply later, but all of them still reply, now to older lines.

## 1. Principles applied

**Minimum mechanics, maximum combinations.** Two facts of physics and one
judgment. No new tool, parameter or prompt section:

1. **Saying takes time.** Every spoken line, the first included, takes its
   length in speaking time and is heard as it is said: whole when finished, or
   up to where it stopped when cut off.
2. **One floor per huddle.** Someone holding it is speaking. A spoken line that
   finds the floor taken waits for it, unless its speaker cuts in.
3. **How badly do you want in?** When a line finds the floor taken, the decision
   model answers one question for its speaker: `CUT_IN` (now, over the speaker),
   `NEXT` (the next pause, even between the speaker's lines) or `WAIT` (until
   the speaker has finished). At a pause the floor goes by that answer, not by
   who waited longest.

Everything else is existing machinery: hearing a line is a stimulus, a stimulus
can `STEER` a busy character, a steer interrupts unsaid speech and reports
`{ said, unsaid }`. Section 4.5 lists what falls out.

**Code vs. judgment.** Code owns speaking time, the floor, its order and where a
cut-off line stops: physics. The character owns whether to speak, what and how
much. The decision model owns two impulses: how badly to get in (new), and
whether something heard makes their own speech moot or worth stopping for
(`STEER`, as today).

## 2. Simulation: how people take turns

| What real people do                                                           | Kazusa                                                                                                                  |
| :---------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| Mostly one speaks at a time.                                                  | One floor per huddle.                                                                                                   |
| Saying something takes time; you hear it as it is said.                       | A line takes its speaking time and is heard when finished.                                                              |
| Some talk fast, some slow; excitement speeds you up, grief slows you down.    | Jev judges each send's pace from who they are and how they feel.                                                        |
| Languages pack different amounts into a written character.                    | Each writing system's characters take their own time: letters, kanji/hanzi, kana, hangul.                               |
| Listeners plan their reply while the other talks.                             | Brains already think while others speak; a ready line waits only for the floor.                                         |
| At each point where a turn could end, someone eager may take it.              | The floor frees at the end of every line. `NEXT` waiters go first, then the speaker's own next line.                    |
| The polite let the speaker finish.                                            | `WAIT` waiters go only once the speaker's whole turn is said.                                                           |
| Among the equally eager, whoever starts first gets it.                        | Same answer: whoever was ready first.                                                                                   |
| In an argument, people cut in, and the one talked over stops or talks louder. | `CUT_IN` speaks at once. The one talked over hears the cut-in and either stops (`STEER`) or keeps going (`QUEUE_NEXT`). |
| A sentence broken off is heard as far as it got.                              | A line cut off by a steer is heard up to the word it reached, ending in "—".                                            |
| Who cuts in depends on temperament, stakes and who is talking.                | The `floor` judgment reads identity, the relationship with the speaker, the conversation and the line they want to say. |
| You drop what you were going to say when someone says it first.               | Lines heard while waiting are stimuli; `STEER` drops your unsaid lines and you think again.                             |
| Impatience grows: you hold back, then can't any more.                         | Every line heard while waiting is a chance to `STEER`; the new line is judged again and may now `CUT_IN`.               |
| Gestures, nods and eating don't take the floor.                               | Action bubbles never wait for the floor.                                                                                |
| Big groups split into side conversations.                                     | `talk` with some of your own conversation ([conversations](conversations.md)).                                          |

## 3. Player: what is fun, and where it surfaces

- **A readable table, until it isn't.** Calm talk reads one voice at a time in
  Chats. When the topic turns, lines start breaking off with "—" and
  overlapping: the player sees the temperature change without being told.
- **Temperament shows in how people talk, not just what they say.** The hothead
  cuts in; the junior waits for the president to finish; a friend gets
  interrupted more than a teacher. Nothing names these traits: the `floor`
  judgment reads them from identity and relationship cards.
- **Biting their tongue.** Airi has a line ready, Natsu says it first, Airi lets
  it go. Unsaid bubbles reach no ledger; the observer could see them (§5).
- **Being cut off.** "And another thing—", then someone else's line.
- **The player is unpaced.** Sensei types in real time, so their line is said as
  sent, over anyone: they can interrupt, and see who stops.
- **Client.** The floor holder shows as speaking (the typing event with
  `mode: "speaking"`, set while a line is said); two at once show two. Waiting
  speakers show nothing: you can't see someone about to speak.
- **Never fun:** queues, urgency levels or "waiting to speak" in a character's
  prompt, or a table that is always shouting.

## 4. Mechanics

### 4.1 Speaking time

`composingMs(text, "speaking", rates, pace)` (`messaging/composing.ts`, the same
function that times typing) sums each character's time at an ordinary pace and
divides by the speaker's pace; no cap. Spaces and punctuation take none.
`messaging.rates.speaking` gives characters per second per writing system:
`letters` 12 (any alphabet's letters and digits; ~150 English words a minute),
`han` 5 (Chinese characters and kanji), `kana` 8 (about a mora each), `hangul` 7
(syllable blocks). Those follow measured syllable rates (Japanese ~8 morae,
Mandarin ~5 syllables a second; Korean approximate), so a Japanese line isn't
one "word" for lack of spaces. Scripts whose writing leaves out vowels (Arabic,
Hebrew) or packs syllables differently (Thai, Devanagari) count as letters and
run short or long; a world can tune the rates.

Pace comes from Jev (§4.3), once per send: 1 is ordinary, and the rubric's
anchors run from 0.6 (halting, grieving) to 1.6 (rapid-fire); a fractional score
lies between two anchors on a log scale (`paceAt`).

Text chats take typing time the same way, with typing rates and no floor
([messaging](messaging.md), Paced speech). Actions take no time and never touch
the floor. Stickers are already dropped face to face.

### 4.2 The floor

`Floors` (`messaging/floor.ts`) lives in Messaging's process-wide cell
(`MessagingState.floors`), so every plugin instance sees one floor per huddle.
Not durable: after a restart nobody holds it, and the outbox's `resume()` sends
surviving bubbles at once, as before. Per huddle id:

```text
speaking: Map<planId, agentId>     // usually one; more while someone cuts in
turn?: { agentId, planId, open }   // the send whose turn it is; open until it ends
waiting: [{ agentId, planId, choice: NEXT | WAIT, order }]
```

A plan is one `send_message` call. For each spoken bubble of a live send into a
huddle (`Messaging.play`), in order:

1. **Join first.** The first line's conversation is resolved before it is said
   (`conversationFor`, the same `resolveChat` the send runs again): speaking
   aloud to people or into a huddle's address walks over first, then waits.
2. **Judge once.** The send asks how it is said (§4.3) once and keeps the
   answer: its pace always, and `floor` when the floor is contested (someone
   else is speaking, waiting, or holds an open turn); a free floor is `NEXT`. A
   text send asks only its pace.
3. **Take the floor.** `CUT_IN` on the first spoken line starts at once, beside
   whoever is speaking, and takes the turn; later lines of that send are `NEXT`.
   Otherwise the line waits its place.
4. **Say it.** Set typing with `mode: "speaking"`, wait its speaking time on the
   sim clock (paused holds it; the shutdown release lets it go, and lets every
   waiter go at once), commit the bubble (heard now), leave `speaking`. The
   send's end closes its turn.

When nobody is speaking, the floor goes to the first of: `NEXT` waiters other
than the turn's own plan, first ready first; then the turn's own next line;
then, only once no turn is open, `WAIT` waiters, first ready first. Taking the
floor takes the turn. A speaker who loses the turn ranks by their own send's
answer, so someone eager since before a newcomer gets back in first.

**Being cut in on.** A cut-in line is heard when it ends, like any line, so the
one talked over hears it through the ordinary attention gate while still
speaking. `STEER` interrupts them as before; the line being said commits the
words its elapsed time covers, at a word boundary, plus "—" (none covered: it is
dropped; all covered: it is whole), with request id `[requestId, index, "cut"]`,
and only while the speaker is still in the huddle. The speech result's `said`
ends with the broken-off text (also `heard`) and `unsaid` holds that line whole
and the rest; the character reads only the counts and `heard`. `QUEUE_NEXT`
talks through it: both lines are heard. A run that ends (its abort signal) drops
the line unheard, as before.

**Membership changes.** Leaving the place says what the speaker was still
waiting to say, at once and over whoever is talking, before they go: a goodbye
sent with the `start_task` that moves them was otherwise lost behind the floor
(`leavePlace` hurries their speeches and waits for them). A send to a huddle the
speaker has already left fails as it did. Huddles no longer merge
([conversations](conversations.md)), and someone saying a line or waiting for
the floor can't be turned into a side conversation: they are talking to the
group.

**Who skips the floor:** players (real-time typing, always heard at once), the
system agent (sends at once, outside the world's time) and recovered plans. Text
chats have no floor.

**Run time.** A brain run's limit (`perception.maxThinkingSeconds`, 180 s)
counts only its model calls, so a `send_message` waiting for the floor, or
saying a long line, spends none of it: no line is dropped for waiting.

### 4.3 The speech judgment

Two questions in the perception rubric (`shared/skills/perception`,
`rubricVersion` 11), asked together in one call by `Perception.judgeSpeech`
through the same decision context and direct call as attention,
`purpose: "perception.speech"`: `pace`, a score over ordered
`{ pace, description }` anchors, every time, for texts too (`speech.medium` says
which); and `floor: CUT_IN | NEXT | WAIT` when someone else has the floor. It is
the speaker's own impulse, not a stimulus: asked outside the attention lock, not
recorded as an attention decision (one `Perception <id>: speech -> …` log line).
Anything unusable takes `NEXT` at pace 1: never the disruptive answer, as
`STEER` is never a fallback. A world rubric without one question asks the other
alone; without both, the same fallback. The Elden Ring and Genshin templates
override the perception skill and carry both questions, worded for notes instead
of phones.

Evidence, from the existing decision context:

| Factor                 | Field                                                    |
| :--------------------- | :------------------------------------------------------- |
| Temperament, mood      | `character.identity`, `soul`, `memory`                   |
| Who has the floor      | `floor.speakingNow`, `whoseTurn`, `othersWaitingToSpeak` |
| Relationship with them | `personalWiki` (seeded with those people)                |
| The conversation       | `recentChannelContext` (the huddle's recent lines)       |
| What they want to say  | `currentSpeech.unsaid`                                   |
| What they are doing    | `currentActivity`, `currentAttention`                    |
| Mood for pace          | the same, plus what the line says                        |

The rubric's gist: `CUT_IN` is for when it cannot wait (anger, alarm, a direct
attack, a lie about them, a heated argument) or a temperament that interrupts by
habit; `NEXT` is ordinary eager conversation; `WAIT` is deference, shyness, a
serious moment, or nothing pressing to add. Normal talk should rarely cut in.

Cost: one decision per spoken send, against one per listener per line for
attention.

### 4.4 Perception

Attention is unchanged. A bubble waiting for the floor is `unsaid` in
`currentSpeech`, so "someone just said what I was about to" is the same judgment
as "this contradicts what I am about to say". The rubric's instructions gained a
sentence: a huddle line arriving while they still have something unsaid was said
over them, `STEER` to stop or drop it, `QUEUE_NEXT` to finish anyway.

### 4.5 What falls out (combinations)

| Combination                                             | Behaviour                                                           |
| :------------------------------------------------------ | :------------------------------------------------------------------ |
| `CUT_IN` + hearing the cut-in + `STEER`                 | Being cut off mid-sentence, heard as "—".                           |
| `CUT_IN` + hearing the cut-in + `QUEUE_NEXT`            | Talking over each other: a shouting match, both lines heard.        |
| Cut-off lines heard + `floor` reads the conversation    | Arguments escalate: broken-off lines make the next cut-in likelier. |
| `floor` reads relationship cards                        | Deference and hierarchy: who waits for whom.                        |
| `NEXT` at every line end                                | Eager interjections between someone's lines.                        |
| `WAIT` + hearing while waiting + `STEER` + new judgment | Holding back, then losing patience.                                 |
| Floor + hearing is a stimulus + `STEER`                 | Dropping a line someone else made moot.                             |
| Speaking time + floor                                   | Short lines get in sooner; monologues cost the whole table.         |
| Brain busy while waiting + `QUEUE_NEXT`                 | What is heard while waiting comes in one consolidated next turn.    |
| Actions skip the floor                                  | Nodding, eating and reacting while someone talks.                   |
| Unpaced player + `STEER`                                | The player can talk over anyone and see who stops.                  |

### 4.6 Expected effect, and what to watch

Calm huddles approach one speaker's worth, ≤ ~150 words/min instead of 319, so
each listener's stimuli and attention decisions fall by half or more at the 4–5
person tables, and brains busy waiting fold what they hear into one turn.
Two-person huddles barely change. Watch the `CUT_IN` share: if ordinary lunch
talk cuts in often, the rubric is wrong, and the table is back to today.

## 5. Deferred and open

- **Being picked next.** A question to someone ("Airi, what do you think?")
  should give them the floor. The `floor` judgment can already weigh being
  addressed; a code rule would need addressing data a line doesn't carry.
- **`speech.unsaid` journal event** for the observer (§3), never a ledger; and
  floor decisions on the timeline (today only a log line).
- **Own-huddle lines without a decision.** Hearing your own conversation is not
  a choice. If attention decisions are still the main cost after the floor,
  own-huddle lines while busy could queue in code and only be judged for
  `STEER`. Measure first.

## 6. Decision log

- **Typing and speaking are one composing time, and thinking is neither**
  (2026-11-05). Texts sent their first bubble the moment the tool was called,
  showed "typing" for every chat the brain had just read until its turn ended,
  and typed later bubbles at 20 characters a second whatever the script. Now
  every bubble, the first included, takes `composingMs` with per-script rates
  for each medium and the same judged pace, and the indicator shows only while a
  bubble is being typed or said. Reading and thinking show as the read receipt
  and the brain's status instead.
- **A run's time limit counts thinking, not waiting** (2026-11-05). Composing
  time made sends long enough to end runs. Plugins can't pause OpenClaw's turn
  timer (its approval pause is driven by a host-owned event stream), but its
  `model_call_started`/`model_call_ended` hooks time every model call, so the
  limit sums those and the host's wall-clock timeout is off for brain runs. The
  pause bookkeeping went with it.

- **Huddles change one person's move at a time, and never merge** (2026-11-05).
  Turning to one person merged both conversations, and the busiest live huddles
  reached 17 and 12 people, which no floor can make conversational. `talk` now
  walks you over to another conversation, splits a side conversation off your
  own when you turn to some of it (the rest see `*turns to talk with …*`), and
  calls in people talking with nobody; `manage_chat` `leave` steps back in
  place. A split is several individual moves, so it needs no group decision, and
  anyone moved can turn back.

- **Pace is judged, and characters are measured by script** (2026-11-05, after
  review). One fixed words-per-minute made everyone talk alike and counted a
  whole Japanese or Chinese sentence as one word (no spaces). Pace is a trait
  and a mood, which Jev already reads for attention, so it is a second question
  in the same call rather than a card field (a description can say "talks a mile
  a minute") or a tool parameter. This makes every spoken send one decision, not
  only contested ones.

- **Urgency, not waiting order, picks the next speaker** (2026-11-05, after
  review). First-come-first-served was simple but nobody talks like that, and it
  ruled out arguments. One three-way judgment gives deference, eagerness and
  interruption from the same evidence characters already have.
- **Judged when the line meets a taken floor, not when the listener hears.**
  Folding urgency into the attention decision would cost no extra call, but it
  is judged 10–20 s before speaking, without the line or the person now holding
  the floor, and "do I cut _her_ off with _this_" needs both. One call per
  contested send is still far below today's decision count.
- **Overlap only by choice.** `CUT_IN` is the only way two lines are said at
  once; the player is the other.
- **Heard when finished, cut off where it stopped.** The person talked over
  notices a cut-in when it lands, through the existing gate, with no new
  stimulus kind; the broken-off text makes the interruption visible to everyone.
- **The floor frees per line.** A per-send floor would let a nine-bubble speech
  hold the table with no way in; per line, interjections and cut-ins use the
  same order as everything else.
- **No thinking delay.** Model latency already exceeds human turn gaps; delay
  would only make replies staler.
- **No speaking cap.** Speech is said in real time, and its cost is the point.
  Typing is uncapped too, since thinking no longer counts as typing.
