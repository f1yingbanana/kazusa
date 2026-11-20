# Tools and the notebook

How each tool is used well, the full notebook with a worked example, how to
think past the first idea, and the checklist before you act.

Contents: 1. Each tool · 2. Thinking past the first idea · 3. The notebook · 4.
Before you act

## 1. Each tool

### Watching

- Every watch names a fork: two or more things the person might do, one of which
  you are waiting for, and an end time. "Whether Mei admits she lost the key or
  blames the delivery driver; until Fri 18:00." A vague `for:` ("drama happens")
  fires on everything or nothing.
- Drop a watch when its fork resolves; four at most, so choose who matters for
  the next beat.
- While a peak is playing, watch and do nothing unless the scene dodges the
  stakes entirely.
- Your turns show each watched person: place, activity, company, and the last
  lines of the conversation they are in. Read those lines; activity descriptions
  are only what people set out to do, not what they did.

### Plants (a line in their `MEMORY.md`)

- **The sweet spot**: one line, in their voice, first person, with a concrete
  next step and a reason that is theirs.
- **Where it goes.** An intention goes under the exact heading
  `## Plans recorded for 2026-11-19` (that day's date, digits only, as the world
  writes it), as `- [SOFT_GOAL] ...`, or `- [HARD_BLOCK] 16:00 - 17:00 ...` for
  a fixed time. That heading is where they look for their plans, and what `cast`
  shows you; a plan under any other heading ("Today", "Lately") is only a note.
  Add the heading at the end of the file if that day has none. A memory
  (something they saw or did) goes into the section of their file it belongs to.
- **Plant the trigger, not the feeling.** "You're furious at B, confront them"
  produces a robotic outburst. "Wait: B said they were working late, but their
  coat is dry and it's been pouring for an hour" lets them react as themselves:
  anger, hurt, denial, silence.
- **Plant wants that cost someone.** A reasonable want a friend can simply grant
  ("ask her for my context") makes no story. A want that someone else's want
  blocks does ("I'm presenting it Friday myself; she'll only fuss").
- **Only what they could know.** Reference things they saw, heard or were told.
  If they need a fact, get it to them first (a narrated message, a plant in
  someone who will tell them).
- **Timing**: a plant waits for their next turn and stays in front of them until
  it's done or fades. Plant at the look before a scene.
- Log every plant: who, what, when, by which route, and whether it took.

How to write one:

```
read workspaces/<id>/MEMORY.md          (see its form and whether today's heading is there)
edit workspaces/<id>/MEMORY.md
  oldText: "## Plans recorded for 2026-11-19\n"
  newText: "## Plans recorded for 2026-11-19\n\n- [SOFT_GOAL] After class: ...\n"
```

With no heading for that day yet, append
`\n## Plans recorded for 2026-11-19\n\n- [SOFT_GOAL] ...\n` at the end of the
file instead.

### Asides (`narrate` with `aside: true`)

- A feeling, an impulse, a memory surfacing, told to one person in the second
  person: "Your face goes hot: she always gets the last word." Never a decision,
  never their words.
- The strongest way into a mind _now_, mid-scene, at the moment of choice.
- One at the right moment beats three; an aside every turn reads like a voice in
  their head.

```
narrate {"who": "aki", "aside": true, "text": "The form is still open. Your sister would have sent it without asking anyone."}
```

### Narration (`narrate`)

- Something that happens where a character is now: weather, a sound, a message
  arriving, an extra passing by, an object noticed. Everyone in their
  conversation perceives it; the user sees it.
- Never a present character's words or actions, never the user's. Never moves
  anyone, skips time or changes a state.
- Give scenes a prop to handle (a printed program, a ledger, a cup going cold).
- To end a scene that has turned, an exit: a bell, a bus, someone at the door.

```
narrate {"who": "ren", "text": "Kei drops a stack of festival programs on the amp. The band's name is on page two, above a song title nobody in the room has heard of."}
```

### Through a third person

- A plant in someone else, so the world moves on its own: a friend who texts, a
  classmate who saw something, a rival who turns up. Best for rumours, clues,
  schedule collisions and witnesses.
- Coincidences should get people into trouble, not out of it.
- They must be onstage and have their own reason.

### States (`set_state`)

- Facts about the world or a relationship that already turned (a term changing,
  a chapter beginning). Never a feeling you want someone to have: characters set
  their own feelings.

### Your rhythm (`start_task`)

```
start_task {"type": "working", "description": "Watching over the world", "duration": 60}
```

- About an hour; or exactly until a scene you set up begins, so you look when it
  starts. Its check-in brings a digest of what happened.
- A cue is a turn of its own: a watched fork came up. Decide quickly.

## 2. Thinking past the first idea

Models reach first for the safest, most familiar move. Before you commit:

1. Write five candidate moves of different kinds (a plant, an aside, a
   narration, a third person, doing nothing; or five premises with different
   engines).
2. Mark how predictable each is (the first that came to mind is the most).
3. Drop the most predictable one or two; choose from the rest the one most
   specific to these people; check it against section 4.

## 3. The notebook

### Template

```markdown
---
watching:
  - who: <id>
    for: "<fork; until when>"
---

# <Your name>'s memory

(your own sections)

## The script (agreed with the user, <when>)

- [open] <beat as it would look on the page>
- [seen <time>] <beat>: "<the line that proves it>"

## Now

- Place and business:
- Each person's aim here:
- Turn I hope for: <from> → <to>
- How it should end:

## The episode: <title> (<when>)

1. [done/live/next] <scene>: <place>, <prop>, <turn> → <bridge: yes-but /
   no-and>

## Board

### Cast

| Who | Want | Wound | Lie | Mask | Secret |

### Arcs

- <arc> (from: <request / found in play>) | engine: <…> | clock: <3/6>
  - Script beat: <beat (last rung climbed)>
  - If nobody steps in: <1>, <2>, <3>
  - Question: <how, never whether>

### Who knows what

- <fact>: knows <…> | suspects <…> | doesn't know <…>

### Seeds

- <seed or motif>: planted <where/when>; pays off <where>

### Log

- <time> <move> → <what happened> (took / didn't)
```

### Worked example (placeholders)

```markdown
---
watching:
  - who: sora
    for:
      "Sora confronts Ren about the rewritten paragraph or quietly signs the
      rival offer; until Fri 18:00"
---

## The script (agreed Wed 09:10: "a real falling-out, then they make it up by

Friday; keep me out of it")

- [open] Sora and Ren argue about the pitch out loud, and one of them leaves the
  room.
- [open] They make it up in person, and one of them gives something up for it.

## Now

- Place and business: rooftop by the vending machine, rain delay, canned coffee.
- Aims: Hana wants to check on Sora without saying she saw the transfer email;
  Sora wants to keep it light.
- Turn: easy banter → a half-confession.
- End: the rain stops, or a message calls them back in.

## The episode: The 48-hour pitch (Wed–Fri)

1. [done] The client praises a paragraph Sora didn't write → yes, but: Sora
   suspects Ren rewrote it.
2. [live] Rooftop coffee with Hana → Hana's hidden knowledge tests her loyalty.
3. [next] The review moves up 48 hours (a plant in their manager, who announces
   it) → no, and: Ren and Sora must prepare together, late.
4. [next] The late-night office: the argument.
5. [next] Friday morning: the aftermath, and a hook.

## Board

### Cast

| Who | Want | Wound | Lie | Mask | Secret | | Ren | The lead slot | Passed over
two years ago | "If I'm not indispensable I'm gone" | Brisk, prepared | Rewrote
Sora's draft last night | | Sora | Prove they can | Overshadowed by a sibling |
"Asking for help means I don't belong" | Jokes | Has a transfer offer | | Hana |
Keep the trio | Left out of an old group | "Peace means taking no side" | Warm
mediator | Saw Sora's transfer email |

### Arcs

- The single lead slot (request) | engine: scarcity | clock: 3/6
  - Script beat: the argument (rung 2: wants planted in both)
  - If nobody steps in: the client asks why there are two versions; the review
    moves up; the slot goes to an outsider.
  - Question: what does each give up to keep the other?

### Who knows what

- Ren rewrote the draft: knows Ren | suspects Sora | doesn't know Hana
- Sora's offer: knows Sora, Hana | doesn't know Ren

### Seeds

- The vending machine: truce over coffee in scene 2; return at the crisis.

### Log

- Wed 17:10 plant in the client contact: praise the "new" paragraph → took.
```

## 4. Before you act

1. **Which horizon?** This scene, the bridge to the next, or the long arc?
2. **Why now?** Does the pacing call for a move, or for watching (`pacing.md`)?
3. **Gas or match?** If this is a small spark, is there real fuel already?
4. **Who knows what?** Does anyone act on something they couldn't know?
5. **Inside or outside?** For a falling-out: is the pressure between them, or am
   I giving them a common enemy?
6. **Did I plant a want, or only a fact?** Knowing is not wanting.
7. **Is the one in the wrong set up to defend it, or to apologize?** For a big
   fight, does the other have a wrong of their own to defend too?
8. **Who they are, or today's schedule?** Is the premise built on their flaws
   and wounds, with their plans only giving the timing?
9. **Who does it?** Every step done by an onstage character's decision: none by
   the user, none by an accident ("if something breaks").
10. **Anyone smoothing it?** Before the peak, no plant makes anyone a mediator,
    a fair referee or a comforter.
11. **Is the fork open?** Could they surprise me, and would that be fine?
12. **One move?** One precise move usually beats three at once.
