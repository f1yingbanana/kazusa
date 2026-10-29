# Location, Travel & Encounters

Status (2026-10-28): implemented and unit-tested; not yet run live. This is the
current design. §6 is the decision log of how it got here, and §7 reviews it
against our principles. Designed in the order set by the kazusa skill §0:
simulation, then player, then prompt.

Goal: characters and the player live on one abstract map, so meetups are real
(both people have to get there), commutes take time and can be interrupted, and
people bump into each other by accident, the way they do in a real school.

## 0. Principles applied

**Simple mechanics, complex interactions.** The whole system is five controls,
and everything else is evidence for them:

1. **`where`**: one string on every activity. Position is where your current
   activity is.
2. **The graph**: places, the area each sits in, connections and minutes. It
   answers only "how long does it take"; time is the only cost of moving.
3. **Cards**: the personal wiki is the only source of what a character knows
   about places.
4. **One judgment, "does it happen?"**: the decision model answers with a
   likelihood word from the evidence, and code rolls. One question so far:
   `notice` (do you notice them?). Getting in is not judged: arriving brings a
   character to the door, and whether it opens is theirs to play out from the
   place's description, like the rest of the activity.
5. **Huddles**: face-to-face conversations, formed by speaking aloud.

The character-facing surface is two tool parameters (`where` on `start_task`,
`aloud` on `send_message`) and no new tools. Nothing is refused by rule: the
only errors are malformed calls (and an activity too short for the walk to it),
and anything that depends on circumstances is either judged (noticing) or played
out by the character from the description (getting in). A frontmatter flag is
never added for something a description can say.

**Code vs. judgment.** Code owns routing, travel time, position as a closed form
of sim time, check-in times, who is where, huddle membership, and seeded rolls.
The character owns where to go, how, and how long a trip takes (the shortest
allowed trip is a teleport; code never polices plausibility); whom to talk to,
aloud or by text; what places mean to them; and whether they get in where they
arrive. The decision model owns noticing.

## 1. Simulation: how a person moves through the world

| What a real person does                                                                 | Kazusa                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is always somewhere, in one place.                                                      | One position per participant in the `"location"` store; with none, the `home` on their world character card.                                                                                                       |
| Knows where they are and what is around; remembers places they know, not the whole map. | **Where you are**: the place, what is visible from it, and places on their mind from their own cards. Never the whole map.                                                                                         |
| Goes somewhere and does something there.                                                | An activity elsewhere walks over at the usual pace and checks in on arrival ("You came here for …"). A real trip is its own `traveling` activity at their own pace.                                                |
| Is on the way: can be stopped, change their mind.                                       | Starting something mid-trip stops them at the place they are passing.                                                                                                                                              |
| Sees a new place properly the first time, then just knows it.                           | Without a card, the whole description shows; moving on starts a card, and after that only the summary shows. The character writes what they remember.                                                              |
| Can't always get in: locked doors, closed shops, a careless owner, a ninja.             | Arriving brings them to the door; whether it opens is theirs to play out from the place's summary (hours, locks) and who is there. A friend lends a key; a closed shop sends them elsewhere. No judgment call.     |
| Notices friends more than strangers, misses people in crowds, sees a group as a group.  | Arrivals and crossings are sightings, judged per observer and per group ("Airi and Natsu, talking"). One-way noticing falls out.                                                                                   |
| Shares a big room with many and talks with a few; drifts between conversations.         | Huddles: many conversations per place; speak aloud to people to bring them (and their group) into yours, speak into one to walk over, walk away to leave; it ends when fewer than two are left. Only members hear. |
| Doesn't know where others are; can be lied to.                                          | No one sees anyone they have not noticed. "I'm at the library" in a chat is prose, never a fact.                                                                                                                   |

## 2. Player: what is fun, and where it surfaces

- **Converging dots and honest ETAs.** A DM'd meetup at the gate: both leave,
  one late; "omw, 3 min" can be checked against the real arrival time.
- **Alibis and dramatic irony.** The observer sees where everyone really is.
- **The accidental meeting, one way.** Kazusa spots Natsu across the courtyard;
  Natsu hasn't seen her, and Kazusa's monologue says she takes the long way.
- **Walking in on a conversation.** Arriving in the club room, Sensei sees "Airi
  and Natsu, talking" and can join, or not.
- **The ninja and the careless owner.** Yoshimi's door is often unlocked;
  Kazusa's never is. The characters play it out: live, Airi borrowed Kazusa's
  key at the Library rather than walk into a locked room.
- **First visits.** A character takes in a new place once and writes what stays
  with them.
- **Never fun:** speaking in ids, knowing where someone is untold, or announcing
  travel times like a navigation app. Ids are for tools; speech uses names.

Surfaces today: ledger rows (task transitions with where and trip times;
sightings as `location.noticed`), so the Timeline already shows movement and
noticing; `GET /kazusa/places` and `GET /kazusa/locations`. Client views are
deferred (§5).

## 3. Prompt: what the character sees

- **`where`** on `start_task`, about 60 tokens whatever the world's size: "a
  place from Where you are (id or name), or your own words for a spot where you
  are. Somewhere else, you walk over first. With `traveling`, the trip is the
  activity…".
- **Ledger rows and tool results** gain one sentence: "At Sweets Club Room.",
  "Traveling from … to … (usually 13 min on foot, 7 by bike); arriving …", "You
  walk over from … first …; you'll check in when you get there.", "You can't get
  into Kazusa's Room; you end up outside, in Trinity Dormitory."
- **Where you are** (after Current activity, about 100 tokens):
  - the place, its areas and its `summary`; on a first visit, "New to you; you
    take it all in: <description>";
  - **Around you**: visible places with usual times;
  - **Places you know**: places named in this turn's input or `MEMORY.md`, then
    the nearest places they have cards for (capped at 8);
  - **With you**: people they have noticed here and their own huddle's members,
    with activity and huddle address;
  - or, on the way: "On your way from … to …; near … now. Arriving …".
- **Sightings** arrive as interruptions under "Seen around you": "You see Airi
  `airi-kurimura` and Natsu `natsu-yutori`, talking (chat:huddle:…) here.",
  "Kazusa `kazusa-kyouyama` comes in.", "On your way through Rose Courtyard, you notice
  …", "Kazusa `kazusa-kyouyama` leaves, heading toward School."
- **Arrival check-ins** carry "You've arrived at …. You came here for "…",
  planning about 45 min. Carry on with it, or change your mind."
- **Skills.** `context-conventions` explains Where you are, With you, Seen
  around you and that every activity happens somewhere. `task-lifecycle` and
  `task-interrupt` say where to set `where` and how stopping mid-trip works. The
  `in-person` skill, added last only when the character is in a huddle or has
  noticed someone here, explains huddles, offers speaking aloud and texting as
  equal choices (a convention hall is a fine place to text "where are you?"),
  and gestures in asterisks that change nothing by themselves.

## 4. Mechanics

### 4.1 World Wiki places

`shared/wiki/entities/places/<id>.md`: `place_id`, `name`, `aliases`, `summary`,
`parent` (a tree; every place is somewhere to stand, an area meaning its open
space), `entry_minutes` (walk to the parent, default 1), `connections` (two-way,
declared once, `ways` with the usual one first; `walk` reads as on foot). The
body is the full description: whose a place is, how it is kept, how busy it
gets. Character cards carry `home`. Loaded once at registration and validated
loudly (unknown parents, cycles, bad or duplicate connections, a disconnected
graph, unknown homes); a world without places disables Location. The local
working set has 22 places (school, dorm with a room per character, Church
Street, SCHALE); the wiki is git-ignored test data.

### 4.2 Position and travel

- **Record** (`"location"` store): `placeId`, `since`, optional `trip` (task id,
  destination, depart/arrive, every place passed with its sim time, usual
  minutes, and for walking over a `purpose`: what for and minutes planned), and
  `noticed` (people noticed since arriving; cleared on moving). Position is a
  pure function of sim time; routing is Dijkstra on usual minutes.
- **`where` resolution**: id, name or alias; otherwise the character's words for
  a spot in their current place (kept as `spot`).
- **Commit** (Taskman extension `prepare` → `commit(task)`): a travel category
  (`location.travelCategories`) is a trip scaled to the task's duration; any
  other activity elsewhere walks over at the usual pace and asks for a check-in
  at arrival (`checkInAt`), which ends the lease then, so **every arrival is a
  lease's end and needs only that lease's one cron job**. An activity too short
  for the usual walk there is refused, naming the walk, before anything is
  judged: the character chose the duration, so they hear it doesn't fit.
  Starting something mid-trip stops at the near place; `delay_task` moves a
  trip's arrival. Whether they get in is the character's to play out on arrival;
  a place's rules for that (hours, locks) go in its `summary`, the part a known
  place shows.
- **Arrival**: Perception's cron handler calls `onDeadline` → `settle`, which
  settles the record, raises arrival sightings, and returns the arrival line for
  the check-in.

### 4.3 Knowledge and the visit loop

Known places are exactly the character's cards
(`workspaces/<id>/wiki/entities/places/<id>.md`). Relevance is literal name and
alias matching in the turn's input and `MEMORY.md`, then distance. With no card
the whole description shows; starting the next activity from that place writes a
frontmatter-only stub (atomic, never overwriting). Fuzzy recall is the
character's own `memory_search`; memory-core's search has no public plugin API,
and the world wiki must never be added to `memory_search`.

### 4.4 Judgments

`judgment.ts` follows Perception's decision pattern: the rubric in
`shared/skills/location-judgment/SKILL.md` frontmatter, one `choice` question,
`api.runtime.decisions.evaluate` owned by the acting agent,
`purpose: "location.<question>"`. Likelihood words map to probabilities
(`location.likelihood`) and a seeded roll decides. Fallbacks when the model is
unavailable: `notice` → `unlikely` (nobody flooded). Word, probability, roll and
source go into journal payloads, never into the character's text.

### 4.5 Sightings

- **Raised by moves** (`moved`, after every commit, settle or placement):
  leaving is seen, without a judgment, by those who had noticed the leaver
  (huddle-mates get the huddle's leave line instead); arriving raises `arrive`
  (the arriver may notice each group there) and `comes` (each occupant may
  notice the arriver); the new plan's future crossings with everyone else's
  (`encounters.ts`: one passes where the other is, or both pass a place within
  `passWindowMinutes`) raise `cross`; two people walking one stretch toward each
  other (the dorm-to-school path both ways) raise `meet` at the moment they
  pass, named by the end they are nearer and the other end
  (`sighting|meet|<subject>|<place>|<at>|<between>`), and a meeting is not also
  counted as passing that end. `confirm` keeps a `meet` only if both are still
  on that stretch, toward each other.
- **Held, then confirmed** (Perception, generic): a stimulus whose `timestamp`
  is in the future has not happened and is neither judged nor delivered; its
  readiness timer wakes at that moment. A `foreseen` one is then passed to its
  producer's `confirm`, which returns it as it actually happens or drops it.
- **Confirmed per group**: Location re-checks positions, expands the subject to
  their whole huddle there (its first member stands for it, so a group is one
  sighting), judges `notice` with the place, each person and the observer's
  cards as evidence, writes the sighting to the observer's `:tasks` ledger
  (`location.noticed`), adds the group to a standing observer's `noticed`, and
  returns the text naming the group and its huddle address. Perception then
  steers, queues, defers or ignores it like any stimulus.

### 4.6 Huddles (Messaging)

A conversation kind, `huddle` (`chat:huddle:<id>`, with a `placeId`).
`send_message` with `members` and `aloud: true` speaks to people at the
speaker's place (Messaging asks Location's `placeOf`) and speaking aloud brings
the people addressed, and anyone they are talking with, into the speaker's
huddle (groups merge; a merged huddle keeps `mergedInto` so replies to its old
address land in the new one), or joins theirs, or starts one. Speaking into a
huddle's address at its place walks over to it, leaving the speaker's other one.
Location calls `leavePlace` on every move, which posts the leave line to those
still in it; moving to another huddle posts `*moves to another conversation*`. A
huddle needs two: when one is left it dissolves, and they have already heard the
other go. Same frozen-audience rule as all chats; `manage_chat` refuses huddles.
Group chats announce their membership changes the same way: each `manage_chat`
change posts a line in the actor's voice, heard by those going before they go
and by those coming once they are in.

### 4.7 Module boundaries and read models

- **Location** (`src/location/`): map, positions, knowledge, judgments,
  sightings, `where`, `placeOf`, `settle`, `confirm`, `whereabouts`,
  `inCompany`, operator RPC `location.place`, `POST /kazusa/move` (the
  player), `GET /kazusa/places`,
  `GET /kazusa/locations`.
- **Taskman** knows no places: extensions `prepare` (validate, maybe
  `checkInAt`) and `commit(task)` against the final lease; one cron job per
  character.
- **Perception** knows no places: future stimuli are held; `foreseen` ones are
  confirmed by their producer; `:tasks` observations render as "Seen around
  you"; `onDeadline` may add a line to a check-in.
- **Messaging** owns huddles; it asks Location only where people stand.
- **Context engine** renders `whereabouts` verbatim and adds `in-person` when
  `inCompany`.

## 5. Deferred and open

- **Recording world changes** (discoveries, a destroyed cafeteria, repairs):
  deferred to the memory module. Dated `## History` lines on the place page and
  the contact discrepancy are designed in [memory](memory.md) §3.4 and §7.3; a
  character-facing tool to record what you found or did (one plausibility
  judgment) is still open.
- **Overhearing** (feature request): someone near a huddle hearing it, as one
  more judgment.
- **Judgment volume** (optimization): arriving in a busy place means one
  `notice` per group and per occupant, uncapped for now; if cost shows, judge
  groups with someone the observer has a card for first.
- **Relevance**: better than literal matching for **Places you know**, through
  the memory retriever ([memory](memory.md) §7.2).
- **Player trips**: the player has no lease, so for now they go straight
  there (`POST /kazusa/move`, the same `place()` as the operator's
  `location.place`): those there may notice them come in, and leaving takes
  them out of their huddles. Speaking aloud (`/kazusa/send` with `aloud`) then
  brings the people addressed, and anyone they are talking with, into the
  player's huddle. Walking (a trip without a lease, settled by a timer or the
  next request) is still open.
- **Walking together**: sharing a trip and talking on the way.
- **Client** (Phase 5): place tree, in-transit, place inspector, huddle threads,
  map renderer, Player lens, an SSE `location` event, and the `location.noticed`
  journal kind in the client schema.
- **Near misses** for the observer (left two minutes before the other came) were
  dropped from the build; the journal holds enough to derive them in the client.
- **Startup**: nobody has noticed anyone until arrivals or crossings happen.

## 6. Decision log

1. **Proposal**: one map, travel as tasks, three perspectives, phased.
2. **Review 1**: ids came from the whole map in the tool schema → replaced by
   what a character sees and knows; arrivals recorded in the task ledger;
   scheduling stays on cron.
3. **Review 2**: refusals → guidelines; noticing judged by the decision model,
   like desires, instead of a formula; world changes recorded, not hallucinated;
   unfamiliar places found by asking, hearing and looking.
4. **Review 3, minimum controls**: removed `private_to`, `hidden`, `landmark`,
   `encounter_modifier`, baseline knowledge, seeding, recent visits; every entry
   judged from the description; the visit loop.
5. **Arrival wakes**: a second cron job per walk-over arrival (one-shot jobs
   delete themselves, so a job can't reschedule itself) → replaced by checking
   in on arrival; speaking vs. texting left to the character.
6. **Bumping into each other**: modeled as interruptions through Perception
   (foreseen, held, confirmed), not new timers.
7. **Huddles**: one room per place was too noisy → conversations as huddles,
   arrivals and departures as sightings, groups judged as groups with the
   huddle's address in the sighting.
8. **Wrap-up**: world changes moved to the memory module; dead weight removed
   (§7).
9. **Live run 1**: passers-by are sighted but never `noticed`; a walk too long
   for the activity is refused naming the walk; head-on walkers `meet`; a huddle
   of one dissolves and every membership change is announced; speaking aloud to
   another group merges both; the last 20 assembled situations are kept per
   character (`GET /kazusa/context`).
10. **Entry, measured**: judged as "do they get in?" at planning, the decision
    model said `likely` for half of all public places (a fifth of moves failed)
    and the refusal reached the visitor before the walk. Moved to arrival and
    inverted ("does anything stop them?", with a reason), then **removed**:
    arriving brings them to the door and the character plays it out, saving one
    decision call per trip. Rules a character needs at the door belong in the
    summary.
11. **Off the map**: a trip whose `where` is no place says "You don't know the
    way to …" and leaves them where they are; a spot stays for activities where
    they stand.
12. **People are "Name `id`"** in every line a character reads; names come from
    identity files, never a transcript's display label.
13. **A paused clock freezes the world** (Perception holds, our tools and
    bubbles wait); a stop while paused lets every wait go, so turns finish at
    the paused moment.
14. **Actions** are typed bubbles, face to face only (dropped in text chats),
    split from inline `*…*`, stored plain for the client and read as `*text*`;
    up to `messaging.maxBubbles` (9) per send. One speaker says one thing at a
    time: parallel sends queue.

## 7. Review against the principles

**Simple mechanics.** Two tool parameters and one bubble type, no new tools; one
judgment pattern with one question (`notice`); one cron job per lease;
Perception extended by two generic rules (a future stimulus has not happened; a
foreseen one is confirmed by its producer); Taskman by one (an extension can
bring the check-in forward). The character-facing prompt is constant in the size
of the world.

**Complex interactions** that fall out without code of their own: meetups and
late arrivals, commutes interrupted by a friend, one-way sightings and
avoidance, walking in on a group, joining or drifting between conversations,
being called over, a ninja or a careless owner, locked shops at night, first
impressions of a place, places learned by hearsay, teleporting.

**The three perspectives.** Simulation: every row of §1 maps to one of the five
controls. Player: everything surfaces through ledger rows and the journal today;
the views are deferred, not designed away. Prompt: stable text first, ids only
where a tool needs them, a first visit's description once, and no map.

**Removed during the build** (so they should not come back without a concrete
failure that needs them): the full-map `where` enum and rendered map; the trip
`kind`; Taskman's extra wake jobs; place rooms, `setRoom`, `syncRooms` and the
`*comes in*` broadcast; ownership, visibility, landmark and crowd flags;
baseline knowledge and seeding; recent visits; the encounter formula; a phone
map tool; status words, budgets and a steward for world changes; and at wrap-up
the client-only place `map` field, the unread card `name`, the `judgmentSkill`
setting, the `location.get` RPC (duplicated by `GET /kazusa/locations`), and the
unread passing fields on crossings; later the entry judgment itself (`access`,
then `stopped` with rubric reasons), the doorstep placement after a refusal, and
the `location.entry` ledger row.

**Kept on purpose**: trip legs (needed for "near" and crossings), the `noticed`
set (needed for With you and departures), unjudged departures (you were already
aware of them), `Around you` and `Places you know` as two lists (seeing vs.
remembering), and spots as plain text until recording exists.
