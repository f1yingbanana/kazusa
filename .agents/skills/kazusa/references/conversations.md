# Conversations in Person: Joining, Splitting and Drifting Out

Status (2026-11-05): huddles change one person's move at a time (built), and
tuning out (§4) is built and unit-tested, not yet run live. Announcements and
the quiet rule are designed, not built (§5). Designed in the order set by the
kazusa skill §0: simulation, then player, then prompt. Builds on huddles
([location](location.md) §4.6, [messaging](messaging.md)) and the
[floor](floor.md).

Goal: conversations in person form, split and fade the way people's do, with as
few mechanics as possible, each move one person's own.

## 0. The problem, measured

Live world, 2026-11-05 (sim time 2026-11-02 15:39, paused at lunch):

- Of 41 huddles, the only exits ever taken were walking away (108) and moving to
  another conversation (1). Nobody stays at a place and leaves its conversation.
- Five of the six live huddles had been silent for 158 to 201 sim minutes, and
  every member was still in them, still eating where they were.
- Before huddles stopped merging, the two busiest reached 17 and 12 people and
  carried about 1,700 lines between them.

## 1. How people do it

- **About four people per conversation.** A group is one conversation up to
  about four; past that it splits, and no group of more than six was one
  conversation ([Dunbar et al.][dunbar]).
- **A split is one person's turn.** A schism starts with a turn that changes
  topic, opens a new exchange and is aimed at particular people ([Egbert
  1997][egbert]).
- **Joining is gradual**: people stand at the edge of a group first, and the
  group makes room ([F-formations][fformation]). The group, not the newcomer,
  usually fills them in on what was being said ([Pillet-Shore 2010][pillet]).
- **Listening is taking part.** People in a conversation are spoken to or just
  listening; bystanders may overhear; side remarks happen inside a conversation
  without breaking it ([participation framework][goffman-pf]).
- **In public, people notice without engaging**: a glance, then looking away
  ([civil inattention][civil]).
- **Ending is agreed**: one hints the talk is done, the other accepts, then
  goodbyes ([Schegloff & Sacks][closings]).
- **Attention from afar is a summons**: a call that expects an answer, repeated
  louder if none comes ([Schegloff 1968][summons], [Balantani &
  González-Martínez 2025][corridor]).
- **Your own name cuts through**: about a third of people notice it in talk they
  aren't following ([Röer & Cowan][name]).
- **Agent frameworks don't model this.** LLM group-chat frameworks pick who
  speaks next ([Frontiers 2025][mmagents]); none models joining or leaving a
  conversation.

## 2. Behaviors, and what covers them

| #   | Behavior                                    | Covered by                                        | Status       |
| :-- | :------------------------------------------ | :------------------------------------------------ | :----------- |
| 1   | Notice who's around without engaging        | Sightings and the `notice` judgment               | Built        |
| 2   | Walk up to a group and join                 | `talk`, or speaking into its address              | Built        |
| 3   | Wait for a pause before speaking            | Floor (`NEXT`, `WAIT`)                            | Built        |
| 4   | Be greeted and filled in on joining         | The joiner's first line; **With you**             | Built        |
| 5   | Invite someone on their own                 | `talk`; **With you** shows who isn't talking      | Built        |
| 6   | Call someone over across the room           | `talk` (they come to you)                         | Built        |
| 7   | Take turns; cut in when it matters          | Floor                                             | Built        |
| 8   | Talk to one person while others listen      | Lines name them; attention weighs being addressed | Built        |
| 9   | Listen without speaking                     | Staying in the conversation                       | Built        |
| 10  | Turn to some of a group: a side talk        | `talk` with some of your own conversation         | Built        |
| 11  | Big groups splinter past four to six        | Crowd guidance, tuning out (§4), side talks       | This design  |
| 12  | Drift out when not following                | Tuning out (§4)                                   | This design  |
| 13  | Say goodbye, then leave                     | Speaking, then stepping back or walking away      | Built        |
| 14  | Step back to do something else here         | `manage_chat` `leave`                             | Built        |
| 15  | A conversation ends when everyone is silent | Quiet rule (§5)                                   | Designed     |
| 16  | Announce to everyone ("listen up")          | `announce` (§5)                                   | Designed     |
| 17  | Fall quiet to listen to an announcement     | Each listener's attention decision (`STEER`)      | With §5      |
| 18  | Hear your name in a nearby conversation     | Overhearing                                       | Later, on §5 |
| 19  | Notice a loud argument nearby               | Overhearing                                       | Later, on §5 |

## 3. The mechanics

1. **Huddles, one person's move at a time** (built). `talk` walks you over to
   another conversation, splits a side conversation off your own, or calls in
   people talking with nobody; conversations never merge. Speaking into a
   huddle's address joins it; walking away or `manage_chat` `leave` leaves it.
2. **The floor** (built): who speaks when, and how long a line takes.
3. **Tuning out** (§4): whether you are still following your conversation.
4. **Announcements** and **the quiet rule** (§5, deferred).

## 4. Tuning out

### 4.1 Simulation

Someone who has said nothing in a group conversation for a while is either
listening or has drifted off. Which one is theirs: who they are, what they are
doing, who is talking, whether anyone speaks to them. Kazusa never removes them
by rule. The question is asked at the moment a person would drift: while they
are hearing a line of a conversation they have stopped taking part in.

- **Asked** in the same attention call that judges the incoming lines (one more
  question, so no extra call), only when:
  - their brain is idle: a busy one may be answering that very conversation, or
    waiting for its turn to speak there,
  - the incoming lines include their own conversation in person,
  - it has three or more members (a pair can't drift: the other is talking to
    you), and
  - they have said nothing there for `contextEngine.decisionQuietMinutes`
    (default 10) sim minutes, counted from their last line there or their
    (re)joining, whichever is later, or else the first line they heard.
- **Tuned out**: they leave the conversation silently. No line goes to the
  others, because drifting off is not announced and a line would wake everyone.
  One of a pair stays (the conversation may have shrunk while the decision ran),
  and nothing else happens.
- **Everything said there until then goes unheard.** The lines in the batch,
  lines still waiting from there, and lines from before the moment they left
  that arrive later are discarded like ignored lines, unless already handed to
  the brain. The main answer applies to the rest (a text from someone else, a
  check-in), including its reply delay; if nothing is left, the batch is
  ignored.
- **Clashing answers**: waking for lines that all come from that conversation
  means they still follow it, so they stay. With other lines in the batch,
  tuning out holds for that conversation's lines.
- **Turning back** is joining again: `talk`, or speaking into its address. Their
  silence there counts afresh from rejoining.

### 4.2 Player

- The `attention.decided` timeline event carries `tunedOut`, the conversation's
  address, so the observer sees "stopped following" next to the decision.
- The others see the change in **With you** on their next turn: the person is
  still here but no longer "talking with you".

### 4.3 Prompt

- The question and its rubric are `still_following` in the `perception` skill
  frontmatter, with the attention questions. A world override without it never
  asks.
- The decision context gains `quietIn` (`conversation`, `quietMinutes`) only
  when the question is asked.
- The character learns it on their next turn from their `:tasks` ledger, worded
  by `kazusa-deliveries#tuned-out`, so they don't answer as if they had heard
  everything since.
- `in-person` says listening is part of a conversation, and that when you have
  stopped following, you step back.

### 4.4 Code

- `decision-context.ts` (`quietConversation`) decides whether to ask and adds
  the question and `quietIn`.
- `Perception.classify` reads `still_following`; a `TUNED_OUT` answer sets
  `tunedOut` on the decision trace. `drainState` first asks the attached
  conversation source to take them out (`stopFollowing`); only if they left does
  it record `tunedOut` in the state (conversation and time, for late lines) and
  on the decision, and discard what was said there.
- `messaging/register.ts` attaches `tuneOut`: `Messaging.tuneOut` removes the
  person without a line (refusing one of a pair), then the glue writes the
  `:tasks` note. Huddles record when each member joined (`joinedAt`), which
  `chatFacts` passes on for the silence count.

### 4.5 What to watch live

- How often the question is asked, and the share answered `TUNED_OUT`.
- Huddle sizes over a busy scene: they should settle at four to six.
- Anyone tuned out of a line that named them or asked them something: the rubric
  is wrong if this happens.
- Silent huddles that persist: tuning out can't end a conversation nobody speaks
  in (§5, the quiet rule).

## 5. Deferred and open

- **Announcements** (`announce`). A one-way line to everyone at the place who
  has noticed the speaker, plus their own conversation; nobody's membership
  changes, and listeners react in their own conversations or `talk` to the
  speaker. One-way so a crowd can't set off chains of shouting; limited to those
  who noticed the speaker so a big busy place limits itself at no extra cost.
  Behind a config flag, off by default; measure attention decisions per
  announcement first.
- **The quiet rule.** A conversation nobody has spoken in for 15 sim minutes is
  over. It kicks nobody (nobody is talking), and it is the only way the silent
  lunch huddles of §0 end.
- **Overhearing.** Bystanders at the place sometimes catch a conversation's
  line, and their own name more often (§1). It would reuse the announcement's
  audience.

## 6. Decision log

- **Leaving is the character's choice, asked while they hear the conversation**
  (2026-11-05). A forced removal after a silent spell was rejected: listening is
  taking part, and whether someone is still listening depends on who they are.
  The attention decision already judges every line they hear, so asking there
  costs no extra call and comes at the moment people actually drift.
- **Huddles change one person's move at a time, and never merge** (2026-11-05).
  See [floor](floor.md) §6.

[dunbar]:
  https://researchportal.northumbria.ac.uk/en/publications/size-and-structure-of-freely-forming-conversational-groups/
[egbert]: https://emcawiki.net/Egbert1997
[fformation]: https://arxiv.org/pdf/2008.10078
[pillet]: https://scholars.unh.edu/comm_facpub/25
[goffman-pf]:
  https://journals.library.columbia.edu/index.php/SALT/article/download/1377/439/3536
[civil]: https://www.frontiersin.org/articles/10.3389/fsoc.2023.1212090
[closings]: https://conversationanalysis.org/mp-files/opening-up-closings.pdf
[summons]:
  https://conversationanalysis.org/mp-files/sequencing-in-conversational-openings.pdf
[corridor]:
  https://projects.unifr.ch/grips/en/assets/public/files/Balantani&Gonzalez-Martinez(2025)_smallsize.pdf
[name]: https://link.springer.com/article/10.3758%2FBF03196169
[mmagents]:
  https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1582287/epub
