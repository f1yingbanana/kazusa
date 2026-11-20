# The director: a world that is written as it plays

The design agreed on 2026-11-20. **This is the big picture. When implementation
gets hard or blocked, come back here before changing course:** keep what this
page says the feature is for, and find another way to the same result rather
than a smaller goal.

## Why

Today the world moves only through each character's own goals. Nobody holds the
arcs, so nobody knows that Tuesday's small kindness should pay off on Friday,
and memorable scenes happen only by chance. A visual novel gets its moments from
an author who set every scene up. We can't author ahead, but we can do what a
game master does: keep the threads, watch where the audience is, and set things
up as play goes. Kazusa's advantage is that it can also draw whatever picture a
moment earns (event CGs, `references/scenes.md` on `feat/event-cg`), so what
matters is that the moments are significant and come at the right time.

The director is the system agent, for now: one mind for the whole world.

## 1. Simulation: how a human director works

A game master or a showrunner, not a puppeteer.

- **A notebook.** A handful of arcs (premise, cast, stakes, where it is heading,
  the next beat that would move it), who they are watching and until when, and a
  log of what they planted. Not a script.
- **Attention follows the audience.** The player is the audience. Scenes with
  the player get close attention; offscreen threads get a look now and then; a
  scene the director set up is tuned in when it starts. Offscreen threads matter
  because they reach the player: news, a message, someone bringing it up.
- **Motivation, never lines.** The director steers through the world: an idea,
  an intention or a memory a character finds in themselves and acts on as their
  own (inception), a message an offstage character decides to send, an event at
  a place, a state. It never writes a character's lines or speaks as them, and
  characters stay free to react.
- **Restraint.** Small earned turns, not melodrama; rest between peaks; quiet
  days make the turns land. It adapts when the player goes another way and does
  not push the same thing twice. Canon and the content rules bind it like anyone
  (with a character who is a minor, nothing romantic or physical).
- **Requests.** "I want to see X unfold" becomes an arc to work toward; how it
  unfolds stays a surprise.

What is code and what is judgment:

| Code (deterministic, cheap)                                 | Judgment                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| The director's rhythm: its own tasks (exists)               | Arcs, what to plant, when to step in: the director         |
| A digest of what happened since it last looked (new, small) | Whether a moment needs the director now: Jev, riding along |
| Reading its watch list, capped; rate limits (new, small)    |                                                            |

## 2. Player: what makes it fun

- **The world feels written.** Setups pay off, a character arrives with a
  reason, offscreen threads reach the player, a small scene turns out to be the
  turning point of a larger arc.
- **A sense of progress.** Arcs move by beats; relationships and states change
  (the director can `set_state`); quiet days make the turns land.
- **Requests without spoilers.** The player asks the system agent for a
  scenario, then lives it without knowing how it will come about. Asked what it
  is planning, it can be coy.
- **Agency.** The player can always decline in the scene; the director adapts
  rather than railroading.
- **Event CGs follow arcs.** Later, the director marks which beat of an arc
  earns a picture: the significance a visual novel gets from authored scenes.
- **For the builder:** everything the director does is in the system agent's
  sessions, and every plant is logged in its notebook.

## 3. Prompt: what each model sees

### The director (the system agent), in its existing session

Directing, reviews and the user's chat stay in one mind (single-threaded
consciousness; no new session code). The user reads its work where they already
talk to it.

- **Notebook = its `MEMORY.md`.** On every one of its turns (an opening file),
  and nothing rewrites it: the system agent never sleeps and the memory audit
  skips it. It stays compact (opening files have a size limit). Sections the
  skill defines:
  - front matter `watching:` — the characters it is watching, **at most four**
    (code reads only the first four), each
    `{ who: <agent id>, for: <what to watch for, and until when> }`. Code reads
    only this front matter.
  - `## Arcs` — premise, cast, where it is heading, next beat.
  - `## Planted` — who, what, when.
- **Instructions = the `world-director` skill** (the system agent's skills,
  world-agnostic): arcs and pacing, what makes a visual-novel scene (a heart you
  can see: something done together, not only said), how to plant, restraint, the
  content rules, keeping the notebook.
- **Rhythm = its own tasks.** It starts "keeping an eye on the world" for about
  an hour of sim time; when that ends it wakes, reviews, starts the next. To
  tune in at 17:00, it ends its task at 17:00. No code.
- **What is happening = the Cast and Watching sections** on each of its turns
  (everyone onstage by place and activity, the watched with their latest lines;
  `cast` gives anyone in depth), and a **digest in its task check-in**: what
  started or changed plans since its last look, from the journal the timeline
  reads. Activities are what people set out to do, not proof; the lines say what
  happened.

### Characters: unchanged, except a planted line

- A plant is a line in their `MEMORY.md` (an opening file, read every turn):
  first person, as their own intention or memory, nothing meta. They read it
  next turn. Each edit costs that character one prompt-cache miss.
- Their nightly sleep review may fold a plant into a goal or drop it: an idea
  takes or fades, as ideas do.

### Jev: riding along, for the watched only

- Not every character: the attention decision is the busiest call in the system.
  Only characters in `watching:`, and only their own `for:` line.
- Those attention calls get one more yes/no: does this call for the director
  now? (The arc's moment is coming; the scene is stalling or drifting from it;
  the plan changed against it; it ended.)
- One point covers both onscreen and offscreen: everything said to a watched
  character passes through their attention decision, the player's lines and
  other characters' alike.
- On yes, a short cue reaches the director (who, what just happened, why it is
  watched), at most once per character per few sim minutes (new code).

### Narration (added 2026-11-20, at the user's request)

Planting waits for a character's next turn; a scene needs a way to act now. The
director's one tool, `narrate { who, text }` (system agent only), tells
something that happens where a character is, signed `narrator`, never a member
of any chat. In a conversation in person, every member hears it and the player
sees it on screen (`Messaging.narrate`: the one exception to chat membership);
someone on their own gets it as a line on their own. Only what nobody present
does or says: weather, a sound, a passer-by, news arriving. It also steers from
the side: narrate to a watched character's friend (a call, bad news) and the
friend's own message reaches the scene. Characters read narrator lines as real
and nobody's words (`context-conventions`).

## Minimum build (what the first PR ships)

1. Skills: `world-director` (the system agent's craft, with references),
   `director-conventions` (its perspective in place of a character's, with no
   needs or feelings), `kazusa-director` (what code tells it), and in
   `context-conventions` the narrator line and "Disagree, and stay hurt".
2. Its turns: the `world-director` skill in its system prompt every turn; the
   Cast and Watching sections; its own closing reminder (no spoilers to the
   user); a digest of what happened in each check-in of its own activities.
3. Tools for the system agent: `narrate` (the one exception to chat membership;
   `aside: true` for one character alone) and `cast`.
4. The feedback loop: `watching:` riding on attention decisions with a cue; the
   director judges each take itself, by the skill's taste ("judging a take").
5. A bugfix: a memory section rewrite keeps a `---` block inside it.
6. Planting, requests, rhythm, the notebook itself: no code.

Not yet: event CGs under the director (they stay with the beat check and the
drawing step on `feat/event-cg`), a UI for arcs, a separate director agent.

## To verify first

- The system agent's task deadlines wake it while the clock runs.
- How long a director turn takes against a scene's pace (a plant may land a beat
  or two late: fine for steering).
- A planted line is read on the character's next turn.

## Lab test

The user asks the director for a scenario over a few sim hours, with two
characters, one of them with the player. Do they plan, watch, tune in, adapt
when the plan changes, and land the scene? A judge reads the transcripts and the
director's session.

## Risks

- World building and directing share the system agent's session: its context
  grows (compaction handles it).
- Contrivance: the skill favours small turns.
- A noisy cue: conservative wording, rate-limited.
- Plants that don't fit who a character is: every plant is logged.

### D2 (2026-11-20, same world, from Wed 22:52): the rerun with the revised skill

- **The skill wasn't in front of it when it decided.** It reads `world-director`
  once with a tool; later turns keep only a summary of past tool calls, so the
  rules were gone at every look and cue ("I read it at 06:30… that's fresh.
  Skip"). Fix: while it directs (it watches someone, or its notebook has an Arcs
  heading), the context engine adds the skill's body to the system agent's
  cached system prompt every turn (`DirectorService.guide`).
- **Its watch list had silently stopped parsing.** It writes `for:` lines like
  "08:20 LOOK — … Watch: …"; an unquoted ": " breaks the YAML, so from Wed
  ~18:34 the front matter read as empty: no cues, no Watching section, and (with
  the fix above) no skill. Fix: when YAML fails, `watchingIn` reads the same
  shape line by line; the skill's template quotes `for:`.
- With both fixed (Thu 12:00 on): Watching, cues and the injected skill work; it
  narrates into each twin's lunch and plans the confrontation for their meeting
  after the last bell ("the collision will happen there"). It updates its
  watches on every cue, which costs a turn each.
- The lab's missing characters (Yuzu, Aris: wiki pages, no agents) became its
  favourite plot device ("the ghost chair"): a lab artifact that skews runs.
- **Climbing the ladder with narration only.** With a per-turn checklist in the
  digest and cue ("for each promised beat not yet on the page: next rung, climb
  it now"), it escalated mid-scene: the arithmetic on the audit sheet, then the
  authority's RESUBMIT closing the twins' easy way out. Sharp narration, but
  pressure from outside: the twins closed ranks and went hunting for their
  president together.
- **Why it never planted, in its own words** (asked directly): narration gives
  instant feedback while a plant waits a turn; writing into their crowded files
  "felt like speaking over them"; and "knowing is not wanting": it kept showing
  them facts. It then made its first real plants, both excellent: colliding
  wants in each twin's own voice ("I'll offer it myself… but if she takes it
  fast… that cuts" / "I have to say that ask out loud and take her offer").
  Skill additions: plant before the scene and narrate during it; a plant is a
  motivation, not speaking over them; outside pressure unites, inside pressure
  divides.
- **Plants reach the mind, not always the mouth.** Midori's plant showed on the
  page ("if someone has to own the gap, it's me"). Momoi's did not: her activity
  update says she "said it anyway", but she never sent it. The digest showed
  that update, and the director took it as the ask made. Fix: the digest now
  says activities are intentions, and the skill's review starts with checking
  the page.
- **It talks itself into a result.** At 17:32 it judged Midori's deferral to
  fail all three tests; at 17:53 it wrote "DRIFT ACCEPTED, falling-out firing as
  distance" over a friendly dinner for two. The promised falling-out never
  happened on the page in about 25 sim hours.
- Open after D2: the director model (the world's default, a fast model) may be
  too weak to hold a line against its own rationalizations; characters avoid
  conflict in speech even with a want planted (a stronger nudge, a dated plan,
  or a cue to the director when a planted act doesn't appear); the lab's missing
  characters skew every run (use a lab where the cast's friends exist);
  real-time cost (each cue is a director turn of 1–2 minutes).

### D3 (2026-11-20, Thu 18:16–20:20): Yuuka and Noa, with an outside verdict

Built for this run: `promised:` beats in the notebook's settings block, checked
by the decision model against the watched conversations (in person and by text,
last 90 sim minutes) at every look and cue, shown on every director turn (seen,
or looks without it, and "climb a rung now" after two); `narrate` with
`aside: true` (a feeling or impulse to one character only, mid-scene); the
ladder's rule that each move must be a stronger kind than the last; the settings
block found anywhere in the file (it put it mid-file); `narrate` refusing
offstage characters.

- **The director now judges and escalates.** First turn: plants in both, a
  checkable `promised:` list ("Yuuka and Noa have it out loud — sharp words over
  the record, one of them walks away hurt"). Then, look after look: an aside to
  Noa at her moment of choice, a narrated ten-minute filing deadline, the record
  failing to file, the printed page on Sensei's desk, the 20:00 lock closing it
  under both names, asides to both at the hurt, a plant in a third person. Its
  notes stayed honest: beat 1 open, "the exchange is cold", next rung named.
- **The characters walk it back.** Every push became candour and grace: "The
  real one: I raced it so the week would end caught" / "Verbatim is how I say a
  thing mattered" / "Thank you". The beat checker kept beat 1 open (correctly).
  Our conventions don't ask for niceness ("you need not be agreeable"); the
  characters' model reconciles by default.
- Minor: the checker ticked "Sensei is inside it" from the director's own
  narration around Sensei (question now says "by the people it names, not
  narrated around them"); it planted and narrated into characters who were
  offstage or not in the lab (now refused, skill says only the onstage can act).
- Next: the falling-out now depends on the characters being able to stay angry.
  Options: a convention line that people can stay hurt, stubborn or angry and
  that a disagreement can outlast the conversation (affects every character); or
  director moves at the level of acts and misunderstandings rather than
  feelings.

### D4 (Thu 20:20 to Fri 09:03, same show): arguing characters, mood, the note

Built: a `context-conventions` paragraph, "Disagree, and stay hurt, like a
person" (push back, say the sharp thing, a hurt lasts until something real
changes it; making up is a moment of its own); a `mood` state in the lab world
(`on: character`, `changedBy: character`: settled, stung, hurt, angry; it
doesn't lift because someone was pleasant); a written **note** at each look on
the open beats (a separate text model reads the watched conversations of the
last day: where each beat stands, what is in the way, the one push likely to
help), shown under Promised beats; a "past the top" rule for the ladder; the
director's settings block now survives the bedtime review (`withSection` keeps a
`---` block found inside a rewritten section; the director had put it under
Long-Term Goals, and its night's review wiped it).

- **The note works.** First note: beat 1 "never fired — Noa smoothed it over by
  treating Yuuka's protest as more material for the record… Yuuka gave way
  because Noa's verbatim keeping read as care", and a concrete push. The
  director turned it into sharper plants in both for the next morning's
  hand-over, kept its rung accounting, rejected the night's warm texting truce
  as "smoothed over" (failing its own tests), and asked itself what comes after
  the top rung.
- **Characters used the mood state**: both set `mood: stung` and lowered
  composure in the evening's exchange; Yuuka's lines got an edge ("…Tch.").
- **Still no falling-out between them.** At the morning hand-over Yuuka's
  grievance turned on Sensei ("His was… nothing pointed at him… The record only
  ever catches me"), Noa agreed, and they traded copies. The director's own arc
  (beat 2: Sensei's empty counter-signature) made Sensei the wound, so the two
  friends shared an outside target: "outside pressure unites", from its own
  plot. Next: the director should pick a premise where one of the two wrongs the
  other (the skill's colliding wants), and check its arc for a shared outside
  target before it builds pressure on it.
- Infrastructure: the session scratchpad was wiped mid-run (lab tools now in the
  lab's `.lab-tools/`); the note came back empty until it had room to reason
  (4,000 tokens, low effort) and until it read the last day rather than 90
  minutes.

## Calibration (after D4): why no argument yet, and how we test from here

**Working, and verified live:** the notebook, watches, cues riding on attention,
digests, narration and asides, plants that characters act on, promised beats
judged from outside (Jev) with a written note, the director's honest accounting
and its escalation once the rules were in front of it every turn.

**Not working:** the one thing all of it is for. Four runs, about two sim days,
dozens of director moves, and no falling-out between two characters asked to
have one.

**Why, ranked:**

1. **The actors can't play the scene.** Every lever goes through the character's
   own model, and it turns tension into understanding every time: plants took,
   asides landed, both set `mood: stung`, and each exchange still ended in
   grace. A director can't get from actors what actors can't do, and we never
   tested that layer on its own. The state lab already showed the mechanism: a
   state as a line barely changes behaviour; the prose a character reads (their
   history) does. This is a simulation bug before it is a director bug: real
   friends do argue.
2. **The director's conflicts are procedural, and its pressure is external.**
   Records, memos, signatures, deadlines: much mechanism, little feeling.
   Outside pressure (an authority in D2, Sensei in D4) gave the two a common
   target. Its plants were reasonable wants ("ask for my context beside the
   line") that a reasonable friend can simply grant. A fight needs a personal
   wound (a broken promise, credit taken, a secret exposed, a public slight) and
   a want the other can't grant without losing something.
3. **The method.** Live end-to-end runs were the only instrument: about an hour
   of real time per data point, confounded (memories carried from earlier runs,
   characters missing from the lab, stale activities, clock jumps,
   infrastructure bugs found mid-run), several changes between runs, no
   baseline, and me as the judge. Live runs were the right tool for the
   infrastructure bugs they found; they are the wrong tool for a behavioural
   question. Tuning the skill after each failure grew it to ~2,800 words of
   rules, some pulling against each other.
4. **Untested: the model.** Characters and director run on the fast default;
   whether a stronger character model argues is unknown.

**The calibrated method:** test each layer where it is cheap, with a baseline,
before running the whole.

1. _Character capacity_ (a replay lab like the state lab): real captured turns
   at a moment of grievance, the other side's lines fixed, one model call per
   sample, 12+ samples an arm, blind labels (argues / hurt, withdraws / smooths
   it over). Wound scenarios and neutral controls, so the fix doesn't make
   everyone bicker. Arms: today's prompt, the argue convention, prose history,
   model.
2. _Lever lift_, same harness: plant vs aside vs narration on the same moment.
3. _Director judgment_, offline: notebook + scene snapshots, scored on the move
   it picks (personal or procedural premise, inside or outside pressure, rung).
4. Then one short end-to-end run on a fresh copy of a world whose cast exists,
   scored the same way each time (promised beats landed, sim time to land, moves
   made, blind naturalness).
5. Prune the director skill to the rules the labs show matter.

### Lab 1: can a character argue? (`scripts/testing/argue-lab`, 2026-11-19)

Replays one real captured turn (the state lab's capture and routes) with a
scenario spliced in: four clear wrongs a friend does (a broken promise, credit
taken, a secret told, a public slight) and three neutral controls, for Yuuka
(with Noa) and Koyuki (with Yuuka); today's conventions with or without the
"Disagree, and stay hurt" paragraph; six replies each; labelled blind by the
model (HOLDS, RELENTS, HURT, SMOOTHS, NONE) and spot-checked by hand.

| Wounds, first reply (n=48) | holds | relents | smooths |
| -------------------------- | ----- | ------- | ------- |
| base                       | 50%   | 46%     | 4%      |
| argue paragraph            | 71%   | 29%     | 0%      |

| Second reply (n=48 each) | holds | relents |
| ------------------------ | ----- | ------- |
| brush-off, base          | 73%   | 27%     |
| brush-off, argue         | 83%   | 17%     |
| real apology, base       | 29%   | 69%     |
| real apology, argue      | 38%   | 60%     |

Neutral controls: no difference between arms (the few "holds" were labeller
noise and one timing slip in a scenario). **The first-ranked cause above is
wrong:** a character wronged plainly argues, stays hurt when brushed off and
softens to a real apology. The paragraph helps (+21 points holding, +10
persisting) without making anyone bicker. What the live runs lacked is the wrong
itself: nobody ever plainly wronged anyone. The other side was as reasonable as
the first, and the director's premises (records, signatures, deadlines) and
plants (reasonable wants) never made anyone do something hurtful. Next: can a
plant make a character commit a believable wrong against a friend (the lever on
the wrongdoer), and does the director pick premises built on one?

## Craft sources (research, 2026-11-20)

The `world-director` skill is built on these; read them before changing how it
directs.

- Fronts (impulse, grim portents, stakes questions) and the MC's agenda ("play
  to find out", "think off-screen", never name your move): Dungeon World /
  Apocalypse World, e.g. https://roll20.net/compendium/dw/Fronts,
  https://gnomestew.com/the-gms-agenda-and-principles/
- Progress clocks for offscreen threads:
  https://bladesinthedark.com/progress-clocks
- Strong starts, secrets and clues, potential scenes:
  https://slyflourish.com/lazy_gm_resource_document.html
- Three Clue Rule (three routes to every beat; proactive moves when play
  stalls):
  https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule
- Scene and sequel (goal, conflict, setback; reaction, dilemma, decision):
  https://www.helpingwritersbecomeauthors.com/scene-structure/
- Build, peak, relax pacing (Left 4 Dead's AI Director):
  https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf
  ; storyteller waves with breathing room (RimWorld):
  https://rimworldwiki.com/wiki/AI_Storytellers
- Beat-based drama management toward a tension curve (Façade):
  https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf
- Story sifting and curation: finish stories already half-formed (Ryan,
  Kreminski):
  https://emshort.blog/2019/05/21/curating-simulated-storyworlds-james-ryan/ ,
  https://ojs.aaai.org/index.php/AIIDE/article/download/18903/18668/22669
- Storylets and salience:
  https://emshort.blog/2019/11/29/storylets-you-want-them/
- Suggestions agents choose to take (Versu):
  https://www.cs.uky.edu/~sgware/reading/papers/evans2014versu.pdf ; traits
  without action make no stories (Dwarf Fortress).
- LLM directors: abstract acts with prerequisites and recast roles (StoryVerse,
  https://arxiv.org/html/2405.13042v2); plain-language triggers misfire unless
  concrete (Drama Llama, https://arxiv.org/html/2501.09099v1); director
  outlines, actors improvise from memory (IBSEN,
  https://aclanthology.org/2024.acl-long.88.pdf).
- LLM biases to counter: early climaxes, uniformly positive stories, repeated
  beats (https://arxiv.org/abs/2407.13248 , https://arxiv.org/pdf/2501.00273);
  goal-less play drifts and NPCs are passive
  (https://ianbicking.org/blog/2024/04/roleplaying-by-llm).
- Lines and veils:
  https://blog.roll20.net/posts/guest-blog-an-introduction-to-lines-and-veils

Not verified: Valve's exact state names, Façade's beat weights, Riedl's
accommodation/intervention terms, visual-novel route design (community sources
only), Tian et al.'s figures (secondary summaries).

## Results

### D1 (2026-11-20, sleep lab, sim Wed 16:53–22:52): "Momoi and Midori fall out over their game and make up, with me in it"

Cast onstage: the system agent and the twins (a trimmed lab: their friends Yuzu
and Aris exist as wiki pages but not as agents, so messages to them bounced).

- **Turn 1 without the skill:** it never opened `world-director` (it isn't in
  the system agent's `SOUL.md` skill list, which is world content), saved the
  plan with `remember`, watched nobody, and narrated an event in the club room
  into the twins' dorm-room conversation (it couldn't see where anyone was).
  Fixes: the narrate tool tells it to read the skill and narrate only where the
  character is; the lab's `SOUL.md` lists `world-director` (the world template
  needs the same line); **Watching** is shown on its turns (place, activity,
  company, the conversation's latest lines; ids that aren't characters or are
  offstage flagged).
- **With the skill:** a real notebook (`watching:` front matter with checkable
  `for:` conditions and end times; an arc with want, "if nobody steps in",
  question, next beat, clock; threads; spotlight). Its own activities gave it
  hourly looks with digests; **cues fired** on the watched lines (5 in the run)
  and it updated its watches each time. Narrations landed in the right place and
  the twins took them as real (a memo, a follow-up, an audit sheet flagging
  Midori's art folders): "somebody bleeds either way", a pencil stopping
  mid-stroke.
- **No falling-out.** The twins resolved every pressure cooperatively in the
  same scene (the LLM niceness bias the research predicts). The director never
  planted: first it treated narrations as plants, then (after the skill said a
  plant is an edit of their `MEMORY.md`) it judged a plant unnecessary and
  "scheduled the collision" for the next day's meeting. It also reported every
  move to the user despite "don't tell me how" (skill now: the show is the
  report). Skill additions from this run: behind-schedule hard moves, colliding
  wants planted in both sides, plants make people act / narration sets the
  stage.
- **Why it never pushed harder** (its own reasoning): at 20:31 it believed
  planting _is_ narration ("planting 'colliding wants' is done via narration of
  environmental cues"), reading "narrate only what nobody present does" as a ban
  on influencing wants. At 21:51 it found Momoi had written the numbers down,
  called the worry "already planted", and reframed the request: "My debut show
  refuses its own script… that's better writing than mine." The skill caused
  this: the arc's open question was "Do they fall out?" and the skill said "you
  don't decide the answer" and "follow them, don't drag them back"; nothing said
  a request is a commitment. Fixed: a request is a promise (promised beats are
  not in question; only how, when and at what cost); plants are the strongest
  move, with a concrete read-then-edit procedure; characters are kind by
  default, so anything against that grain needs a plant; knowing is not wanting;
  "follow where they go" is about the user only.
- The system agent still reads `SOUL.md` (the character-card hook skips it), but
  directing no longer depends on it: its turns always carry a Watching section
  that names `world-director`, even when it watches nobody.
- Infrastructure: one director turn timed out (88 s, provider); the Gateway was
  once restarted before the old one had exited (wait for the PID, not the port).
- Open: whether plants work at all (none made yet); whether a director that
  defers to the characters' choices can still deliver a request; the notebook's
  growth against the opening-file size limit; the director never brought the
  user into the scene (its "Sensei in the room" arc stayed 1/4).

### Planning trials (2026-11-19, a clean world, five kinds of request)

A fresh copy of the world's template (no play history), paused at Tue 08:41 with
Yuuka, Koyuki and Noa onstage; five worlds in parallel, each sent a different
request (a huge fight, a friendship, a secret, a comedy, a mystery); only the
director's first turn, graded blind.

- Every run read `worked-examples.md` and one reference for the request's kind,
  and reasoned from them openly ("structure like worked example A").
- Fixed between rounds: plants under the exact
  `## Plans recorded for YYYY-MM-DD` heading (the old example's date didn't
  match the code); the whole plan in the notebook before any plant (one run kept
  it only in its reasoning); a closing reminder of its own (spoilers to the
  user); only the Cast may be planted (it planted Rio, offstage); plain words
  (its plants brought back the register of records and procedure the user had
  found unreadable).
- Blind grade, round 3: 6, 5, 5, 5, 4 out of 10. Good premises from canon and
  the live morning; the turns hinge on facts held by no character (only in the
  notebook), plants aren't checked against each other or the clock, and Noa
  finds the answer before the scene in four of five.
- Where the register comes from: the Seminar trio's own cards (about ten times
  the cast's average of record-keeping words; Noa's quotes are nearly all about
  recording), the morning's first exchange, and the director copying it into
  plants. Not Kazusa's skills.

### After review (2026-11-19): the director is the referee

The user's call: a director looks at a scene and is satisfied or not; Arona was
too easily satisfied. That is her taste, fixed in her prompt, not by a second
model watching her. Removed: `promised:` in the settings block, the
decision-model check of beats at each look and cue, the text model's note, the
`director-beats` store and the Promised beats section. Added to
`world-director`: "Your taste: judging a take" (on the page, at full strength,
not undone, theirs; real takes it wrongly accepted), a step to judge the take at
each look, the script as prose in the notebook, and talking a request over with
the user before planning (the shape, never the surprise). The cue and check-in
close with "judge the take".
