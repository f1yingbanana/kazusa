---
name: kazusa-director
description:
  "What Kazusa tells the world's director (the system agent) and asks the
  decision model on its behalf: the digest of what happened, the cast, whom it
  watches, the cue when a watched moment comes up and the question that decides
  it, and its promised beats as judged from outside. Each section is one piece,
  read by code. Override only the sections you change."
user-invocable: false
disable-model-invocation: true
---

`{placeholders}` are filled by code. The digest comes with each check-in of the
system agent's own activities, and each check-in is a look, when its promised
beats are judged; a cue reaches it when a character its `MEMORY.md` settings
block watches (`watching:`) meets the moment it watches for. How the director
works is the `world-director` skill.

## digest

What happened in the world since you last looked ({since}), as the world's
director (`world-director`). These are activities as characters described them:
what they set out to do, not proof it happened; only lines in a conversation
(`>` under Watching) show what was said and done.

{happenings}

Before this turn ends, for each unchecked beat under Promised beats: name the
rung you climbed last and the next, stronger one (`world-director`, Holding the
line), and climb it now, unless the drift passes all three tests there; write
which you did in the arc.

## digest-quiet

Nothing of note happened in the world since you last looked ({since}).

Before this turn ends, for each unchecked beat under Promised beats: name the
rung you climbed last and the next, stronger one (`world-director`, Holding the
line), and climb it now, unless the drift passes all three tests there; write
which you did in the arc.

## digest-line

- [{time}] {who}: {what}

## digest-line-at

- [{time}] {who}: {what} ({where})

## digest-delayed

- [{time}] {who} changed plans: {what}

## digest-more

- … and {count} more, of characters you aren't watching.

## cue

[{time}] Director's cue: {who}, whom you are watching for: {for}

Now: {now}

What just reached them:

{lines}

Decide whether to step in (`world-director`), and keep your notebook current.

Before this turn ends, for each unchecked beat under Promised beats: name the
rung you climbed last and the next, stronger one (`world-director`, Holding the
line), and climb it now, unless the drift passes all three tests there; write
which you did in the arc.

## before-replying

(Speak only if it adds something new: "got it" or "on it" for what is under way
adds nothing. When you direct, the show is your report: nothing to the user
about who, where, when, what you set up or what to watch for. "Leave it to me!"
is enough.)

## watch-question

The world's director is watching this character for: {for}. Do these incoming
lines call for the director now? Yes when the moment it watches for is about to
happen or has begun, when the scene is stalling or turning away from it, when
plans just changed against it, or when it has ended. No for ordinary talk along
the way.

## narrator

Narrator

## watching

### Watching

The characters your notebook watches, as they are now, with the latest lines of
the conversation each is in (`>`):

{lines}

Directing is the `world-director` skill.

## watching-line

- {who}: at {place}; {activity}; {company}. Watching for: {for}

## with

in conversation with {people}

## alone

not in a conversation

## watching-unknown

- {who}: no character of that id in this world; stop watching them.

## watching-offstage

- {who}: offstage (not simulated now): nothing happens to them, and nothing you
  plant or narrate reaches them until they are back.

## watching-none

### Watching

Nobody yet. How you direct is the `world-director` skill, in your instructions;
its references are in
`workspaces/<your id>/.agents/skills/world-director/references/`.

## promised

### Promised beats

What you promised the user (front matter `promised:`), checked against the
watched conversations by someone other than you:

{lines}

## promised-seen

- [x] {beat}: seen on the page at {time}.

## promised-open

- [ ] {beat}: not seen on the page; {looks} looks since you promised it.

## promised-due

Two looks or more without a promised beat: whatever you planned, it hasn't
worked. Climb a rung of the ladder now, a stronger kind of move than the last
one (`world-director`, Holding the line).

## beat-state

The latest lines of the conversations the director is watching, newest last:

{conversation}

## beat-question

Did this happen in these lines, plainly, said or done on the page by the people
it names (not only planned, thought, hinted or narrated around them, and not
something milder): {beat}

## promised-note

Note on the open beats, from someone reading the scenes for you ({time}):

{note}

## note-prompt

You read scenes for the director of a world that plays like a visual novel. The
director promised the audience these beats, and they haven't happened yet:

{beats}

The latest lines of the conversations the director is watching, newest last:

{conversation}

In three short lines, plainly, no dialogue for anyone:

1. Where each beat stands in these lines.
2. What is keeping it from happening: who smooths it over, gives way, avoids the
   subject or isn't there, and why, in the scene's own terms.
3. The one push most likely to make it happen next: whose want to sharpen and
   how, what should happen to them, or what the director should stop doing.

Reply with the three lines only.

## cast

### Cast

Everyone onstage, by place, with what each is doing (`cast` shows anyone in
depth: plans, company, latest lines). Offstage, doing nothing until they are
back: {offstage}.

{lines}
