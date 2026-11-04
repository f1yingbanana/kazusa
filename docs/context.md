# Memory and context

Every time a character thinks, Kazusa sends their model one request: who they
are, how they behave, where they are and what's on their mind, what happened to
them lately, and what just reached them. That request is their **context**. This
page explains what fills it and what the settings in **Settings → Context** (and
each character's **Memory and context** section) change.

## What a turn sends

In order, from what never changes to what changes every turn:

1. **Who they are**: their `SOUL.md`, `IDENTITY.md` and `MEMORY.md`, the skills
   they can read, and Kazusa's conventions. The same on every turn.
2. **What happened lately**: their records of the last while (everything they
   did, saw, said and were told), oldest first. New records join at the end.
3. **How to act now**: the guidance for this moment (choosing an activity, or
   being interrupted in one; being with someone in person).
4. **Their recent tool calls**, so they don't repeat a mistake.
5. **The situation**: the time, their activity, where they are, what comes to
   mind, how they feel, and who is waiting for a reply.
6. **What just happened**, the reason they're thinking now.

The order matters for cost. Model providers keep the start of a request they
have just seen and charge much less to read it again, but only up to the first
thing that changed. Kazusa keeps everything that is the same from turn to turn
at the front, so only the new end costs full price.

## The settings

They are grouped as on the page: the size of a turn, what a character remembers,
what comes to mind, and cost tuning.

### Turn size: maximum context

The upper limit of one turn, everything included (default 64,000 tokens): their
identity files, rules and tools, what comes to mind, their memory, the
situation, and room for the reply. Models often allow far more (some a million
tokens), and a busy character's day can reach 100,000 tokens or more, so this is
what keeps a turn's cost in check. If the model's own limit is smaller, that one
applies.

**Use the model's whole window** removes the limit: a turn may then send
everything the model allows. A character's settings show what their model
allows. With memory also set to use all the room left, a busy character's turns
can grow very large, and so can their cost.

Everything else shares this limit. The parts with their own limits below take
what they need first, and memory gets the rest, unless you give it a limit of
its own.

### What they remember

- **Memory window** (default 24 hours): how far back their records reach.
  Anything older is not in the turn, but they can still remember it when
  something reminds them (`recall`), or from what their nightly sleep wrote into
  their memory.
- **Use all the room left** (on by default): memory takes whatever the maximum
  leaves after everything else. Turn it off to set a **memory size** in tokens;
  a limit costs less per turn and makes them forget sooner.
- **Recent actions** (default 600 tokens): a short digest of their last tool
  calls, so they don't repeat a mistake.

#### Forgetting step and room to grow

These two, also under **What they remember**, decide how old memories are let
go. They keep the start of the request the same for as long as possible, so the
provider can keep reusing it:

- **Forgetting step** (default 4 hours): the records begin at a whole step of
  this many sim hours at or before the short-term limit (with 24 hours and a
  4-hour step, a character remembers 24 to 28 hours back). So the start moves
  once per step, not on every turn.
- **Room to grow** (default 75% kept): when the records outgrow their room, the
  oldest are dropped until they fill this share of it. The start then stays put
  while new records fill the rest, and only moves again when they outgrow it.

A bigger step and a smaller share keep more of each turn cached (cheaper,
faster), at the cost of a little less memory right after a trim. In a simulated
week at 64,000 to 128,000 tokens, the defaults moved the start about 5 times a
day instead of every waking hour, and cut the records the provider had to read
at full price by about two thirds.

### What comes to mind

Brought up from their wiki and surroundings each turn, by what is going on:

- **Wiki memories** (default 800 tokens): how much of what they know about the
  people, places and things in the moment comes to mind (the "On your mind" part
  of a turn), from their own wiki and what the World Wiki says they would know.
  The people and places lists below are counted on their own.
- **People they know** (default 20): the people most in their life, listed so
  they can reach them. "Most in their life" is what they have done together,
  recently and often (talking, texting), so a friend they talk to every day
  stays on the list and someone met once drifts off it.
- **Places** (default 16): their home, then places named in what just happened
  or in their plans, then the places they go to most; and, separately, as many
  of the places around them.

What brings memories up is what they notice: what was just said to them, who is
there, where they are. When an activity ends and nothing else is going on, they
think of what they just did and what they planned for today, so the end of class
brings up the friend they promised to meet. Of what comes up, the people and
places they know best come first.

Nothing is listed twice: someone in front of them, or already in what they
recall, isn't repeated among the people they know, and the same goes for places.
To start an activity somewhere, a character can name a place, or use their own
words for one they know; if the words could mean several, they are asked which.

## World and character settings

The world's settings apply to everyone. Any character can override any of them
(Customize in their inspector); each override is independent, and **Use world
default** puts it back. Settings are saved in the world's state, not in
OpenClaw's config file, so changing them never restarts anything; the next turn
uses them.

The plugin config in `openclaw.json` can set the starting values the world's
settings fall back to: under `plugins.entries.kazusa.config`, `contextEngine`
(`maxContextTokens`, `shortTermHours`, `ledgerMaxTokens`,
`toolHistoryMaxTokens`, `ledgerGridHours`, `ledgerTrimTo`), `memory`
(`maxTokens`, `rosterLimit`) and `location` (`listLimit`).
