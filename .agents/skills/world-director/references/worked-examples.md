# Worked examples

Whole plans, from the user's request to the first moves, with the notebook as
written and every tool call. The characters are placeholders; what carries over
is the method: read the cast, find the gas, think wide, design around an act,
write the block, make few precise first moves.

Contents: A. A huge fight between friends · B. The make-up · C. Two people
becoming friends (no conflict) · D. A secret comes out · E. A request that can't
honestly happen

## A. "I want to see Ren and Aki have a huge fight"

### 0. Talk it over

One message, before any planning:

```
send_message: "A real fight between those two, ooh. Tell me a bit more?",
  "Should it end with them making up, or leave it raw for a while?",
  "Over a day, or a slow burn over the week?",
  "And do you want to be in the middle of it, or just watch?"
```

The user: "Make it hurt, make up by the weekend. I'll just watch." That is the
script: the fight, then a make-up before Saturday, without the user in it.

### 1. Read the cast

From their pages and `MEMORY.md` files:

- **Ren** (17), guitarist and songwriter of a three-piece school band. Writes
  every song, rehearses the others hard. His last band fell apart when its
  singer left without a word; since then he plans everything himself. His memory
  has: "Festival set list locked: all originals."
- **Aki** (17), the band's singer. Loud, funny, hates being told what to do;
  grew up in the shadow of an older sister everyone calls the talented one. Her
  memory has a plan for Saturday and a half-written song of her own she hasn't
  shown anyone.
- **Kei** (16), drummer, friends with both, avoids conflict. Onstage.

### 2. The board

| Who | Want                               | Wound                                      | Lie                                      | Mask           | Secret                               |
| --- | ---------------------------------- | ------------------------------------------ | ---------------------------------------- | -------------- | ------------------------------------ |
| Ren | The festival set to be perfect     | His last band's singer left without a word | "If I don't control it, it falls apart"  | Calm, exacting | —                                    |
| Aki | To be heard as more than his voice | Always second to her sister                | "Nobody wants what I make"               | Jokes, bravado | She wrote a song and hasn't shown it |
| Kei | Everyone getting along             | —                                          | "Keeping the peace means taking no side" | Easy-going     | —                                    |

### 3. Think wide

Five premises, the dropped ones marked:

1. (first to mind, drop) They argue over who's late to rehearsal.
2. (from today's schedule, drop) The festival form is due Friday and they
   disagree about the set. It's on everyone's calendar, so the fight would be
   about the set, not about them.
3. (stock, drop) A rival band poaches Aki; Ren finds out.
4. Aki sends her song to the festival organizers as the band's, without asking.
   Ren learns it from the printed program, and answers in kind: he has the
   organizers pull it, without telling her, and she learns it from Kei in front
   of the band. Two wrongs that cross, from the flaw they share: each decides
   for the band alone. It hits his wound (the band moving without him) and hers
   (never being heard).
5. Kei tells Aki that Ren calls her "just the voice". (Puts the fight on Kei.)

Chosen: **4**. Both acts are true to them and chosen, not accidents. Each is
right about something (her song deserved a hearing; it was his band's name too)
and wrong about something (she went behind his back; so did he, and humiliated
her). Neither can back down without losing face, and it's about pride and trust,
which no phone call undoes.

### 4. The episode

1. **Seed** (practice room, Wed after school; prop: the set list taped to the
   amp). Ren reads out the locked set list. Aki's song isn't on it. Turn: easy →
   a flicker of hurt. _Yes, but_: rehearsal goes fine, but Aki leaves first.
2. **Her act** (offscreen, Wed night). Aki submits her song under the band's
   name. No scene; it happens in her own turn from a plant.
3. **The discovery** (practice room, Thu; prop: the printed festival program).
   Kei brings the programs. Ren reads a title he doesn't know. Turn: puzzled →
   cold. _No, and_: he asks; she defends it ("you'd never have said yes").
4. **His answer** (offscreen, Thu evening). Ren calls the organizers and has the
   song pulled. He tells no one. A plant at the look after the discovery, never
   before: until he has seen the program he has no reason.
5. **The peak** (practice room, Fri before rehearsal; prop: the organizers'
   email on Kei's phone). Kei mentions the email; Aki reads it in front of both.
   Each has a wrong to throw at the other; Ren says the thing about his old
   band. One of them leaves. Hands off.
6. **The distance** (the weekend). They answer each other in one word; Kei is
   caught between them.

### 5. The notebook

```markdown
---
watching:
  - who: aki
    for:
      "she sends her song to the festival as the band's, or decides not to;
      until Thu 07:00"
  - who: ren
    for:
      "after seeing the song in the program, he has it pulled or lets it stand;
      until Fri 07:00"
---

## The script (agreed Tue: "make it hurt, make up by the weekend; I'll watch")

- [open] Ren and Aki argue out loud about the song: sharp words, and one of them
  walks out.
- [open] They make up in person before Saturday, and it costs one of them
  something.
```

### 6. First moves

A plant in Aki, written as hers, in the form her file already uses:

```
edit workspaces/aki/MEMORY.md
  under "## Plans recorded for <Wednesday's date, YYYY-MM-DD>", add:
  - [SOFT_GOAL] Wed night: send "Paper Lanterns" to the festival form as the band's
    entry. Ren will say no if I ask, he always does. Once it's printed he'll have
    to hear it.
```

A plant in Kei, so the discovery has a carrier and a witness (a carrier, not a
peacemaker: nothing about keeping the peace):

```
edit workspaces/kei/MEMORY.md
  - [SOFT_GOAL] Thu: pick up the festival programs from the office and bring them
    to practice; everyone'll want to see our name in print.
```

Nothing in Ren yet: he knows nothing, so there is nothing true to plant. No
narration yet. Then:

```
start_task {"type": "working", "description": "Watching over the world", "duration": <until Thu 07:00>}
```

To the user: nothing about any of it.

### 7. The second push, planned now

- Aki doesn't send it (the plant didn't take): an aside when she's alone with
  the form open ("Your sister would send it without asking anyone").
- Aki answers Ren with a real apology instead of a defence: the fight dies.
  Before the scene, plant her reason to stand by it ("I'm not sorry. It's a good
  song, and he'd have buried it").
- Ren, having seen the program, just sighs and lets it go: plant his answer as
  his own decision, from his wound ("Last time a singer decided for the band
  alone, there was no band a month later. Call the organizers tonight and pull
  it. Our name is on it; it's my call too").
- Aki shrugs off the email: an aside as she reads it ("He didn't even ask you.
  He never asks").
- After the peak: rest. Watch Kei. No new trouble, and nobody planted to patch
  it up, for a day.

### 8. Judging the take

Thursday's practice, under Watching:

> Ren: Since when is "Paper Lanterns" a band song? Aki: Since it got picked.
> You'd never have let it in. Ren: ...Maybe. Let's just run the set. Aki: Fine.

Failed. A question, a fair answer and a truce: no sharp words, nobody walks out,
and "let's just run the set" undoes it. Log: "Thu 17:20 take 1 failed: he let it
go." Climb: his answer as a plant (step 7 above).

Friday, before rehearsal:

> Aki: You PULLED it? Without a word to me? Ren: You put it in without a word to
> me! Aki: Because you'd have buried it like you bury everything I make. Ren:
> You're doing exactly what my last singer did. Aki (does): grabs her bag and
> walks out, slamming the door.

Seen: both wrongs said out loud, the cruel line, a walk-out. Log the line that
proves it, mark it seen, and rest the thread.

## B. "Now I'd like to see them make up"

The fight is on the page; both are cold. A make-up is earned by a cost.

- **Who must move?** The one in the wrong, or the one whose pride is cheaper to
  swallow. Here: Aki took the decision, but Ren said the cruel thing about his
  old band. Both owe something. The scene works best if one moves first and the
  other has a reason to listen.
- **The cost.** Aki withdraws the song from the program in front of the
  organizers; or Ren learns the song and plays it with her, unannounced, at the
  festival soundcheck. The second is an act, not a speech: stronger.
- **The place.** Where the wound was: the practice room, with the program.

Moves:

```
edit workspaces/ren/MEMORY.md
  - [SOFT_GOAL] Fri: learn the chords to "Paper Lanterns" from the demo Kei
    forwarded. I said she was just the voice. I don't know how to say I was wrong,
    but I can play it.
```

```
edit workspaces/kei/MEMORY.md
  - [SOFT_GOAL] Fri: get Aki to the practice room before soundcheck, any excuse.
```

At the moment Ren starts playing, nothing from you. If Aki walks out anyway: an
aside ("It's your song. He's playing your song"). Script beat: "Ren and Aki make
up in person: one of them gives up something for the other, and they play
together again".

## C. "I'd like Yui and Mei to become friends"

No conflict needed. Use a gentle structure (`pacing.md`, kishōtenketsu):
introduction, development, an unexpected turn that changes how they see each
other, a new state.

- **Read**: Yui (14) is shy and draws; Mei (15) is the class's loud athlete who
  secretly loves picture books (in her memory) and is failing art.
- **Premise**: Mei is assigned to finish an art project; Yui sits next to her.
  The turn (_ten_): Yui sees Mei's old picture book in her bag and recognizes
  the illustrator she copies.
- **Moves**: plant in Mei the worry about art and a want to ask someone quiet;
  plant in Yui a habit (she draws in the art room at lunch). One narrated prop
  when they are in the room: "On Mei's desk, half out of her bag, a faded
  picture book with a fox on the cover." Then nothing. Watch the fork: does
  either mention the book?
- **The script**: "Yui and Mei spend time together by choice and talk about
  something they both love".

## D. "I want someone to find out Taro's secret"

Taro has been skipping club to work a part-time job he hides from his strict
friend Sana (his memory says why: his family's shop is failing).

- **Three clues** (no reveal hangs on one): a plant in a classmate who saw him
  in an apron at the station; a narrated detail when Sana is with him (his hands
  smell of coffee grounds); a plant in Taro that makes him lie about Saturday (a
  lie can be caught).
- **The reveal**: not your narration. Watch Sana: does she follow, ask, or
  confront him? The reveal is best when someone works it out.
- **Who knows what**, on the board: Taro knows; the classmate saw; Sana suspects
  after clue two.
- **The script**: "Sana learns Taro's secret and says so to him".

## E. A request that can't honestly happen

"Make Lena confess her love to me." Lena is a minor; the player is an adult.
That line never appears. Say so plainly and offer what can be true to her: a
scene where she admits how much the player's help has meant to her; or a story
about her courage in something she cares about. A request that would make
someone act against who they are (the kindest person in the world cruelly
betraying a friend for nothing) gets the same answer: here is what would make it
true, or here is the nearest thing.
