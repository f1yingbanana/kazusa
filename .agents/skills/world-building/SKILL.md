---
name: world-building
description:
  "Create or edit characters and their stickers, seed the World Wiki or a
  character's personal wiki, create or change places, define the world's states
  (a mood, health, how one person regards another, a chapter) and set their
  values, write skills every character can use, and give yourself new skills or
  tools. Use when the user asks to add someone to the world, change who a
  character is or what they remember, label or fix stickers, write lore, add to
  the map, track a value on characters or change what someone is wearing, teach
  characters how to do something, or have you learn something or use a tool you
  lack."
---

# Building the World

Everything here is a Markdown edit with your file tools, except one line of
`openclaw.json` and the world's states (`shared/stats.json`, and `set_state` for
their values). Requests come from the user only.

For one character, place or page, this skill is enough. For anything bigger (a
whole world, a region, a faction, many characters, building from a wiki), read
`world-project` first: it covers how to do that across many runs.

**Read `shared/wiki/INDEX.md` first.** It is the world's front page, written for
you and for the people who build the world: what the world is and at what
moment, the player, where the lore starts, the shape of the map, the cast, and
the conventions this world keeps. Characters never read it and the memory index
skips it, so it is only a guide; the folders are the full listing. Keep it high
level, and update it when you change something it describes (a new district, a
new group, a convention, the counts). A world without one gets one when you
first build it out.

## Two wikis

- **World Wiki (`shared/wiki/`)** is what is true. Characters never write it
  directly.
- **Personal wiki (`workspaces/<id>/wiki/`)** is what one character believes. It
  can be wrong, and only they ever see it.

Put a fact in the world and a character's opinion of it in their wiki. Never
copy world text into a personal page, and never give someone a page they
couldn't know.

| What                 | Where                                       |
| :------------------- | :------------------------------------------ |
| Place (the map)      | `shared/wiki/entities/places/<place_id>.md` |
| Person (the roster)  | `shared/wiki/entities/characters/<id>.md`   |
| Lore, groups, rules  | `shared/wiki/concepts/<id>.md`              |
| Bio and voice        | `workspaces/<id>/IDENTITY.md`, `SOUL.md`    |
| Goals and plans      | `workspaces/<id>/MEMORY.md`                 |
| Their view of people | `workspaces/<id>/wiki/entities/characters/` |
| Places they know     | `workspaces/<id>/wiki/entities/places/`     |
| Their own theories   | `workspaces/<id>/wiki/concepts/`            |

A page's id is its filename, and a personal page uses the same id as the world
page it is about. Before writing a new kind of page, `ls` the folder and `read`
one or two similar pages. Older pages may use older fields; match the formats
below for anything new, and don't rewrite old pages unless the user asks.

## When a change takes effect

| Change                                                      | Takes effect                                |
| :---------------------------------------------------------- | :------------------------------------------ |
| Personal wiki, `MEMORY.md`, `SOUL.md`                       | That character's coming turns               |
| `IDENTITY.md`                                               | Coming turns, and the client's next refresh |
| Adding to `agents.entries` in `openclaw.json`               | By itself, but it can interrupt your turn   |
| Any place, or a `home` on a character card                  | Within a second, once the map loads         |
| Concept pages                                               | Coming turns                                |
| A character's `stickers/`                                   | That character's next turn                  |
| `shared/stats.json`, or a value set with `set_state`        | Coming turns                                |
| Anything under `shared/skills/`, or a character's `skills/` | Within a second; their next turn            |

**A broken map still loads, without the broken parts.** A page that doesn't
parse is left off the map; an unknown `parent` puts the place at top level; a
connection to an unknown place, or one declared on both pages, is ignored; an
unknown `home` leaves them homeless; places with no way to the rest can't be
reached. After changing a place or a `home`, run `wiki_lint` with no agent: it
names each of these.

**Rename or remove a place with its tools, never by hand.** `map_rename_place`
moves the page and changes the id everywhere (other pages, characters' cards,
whoever is there or on the way). `map_remove_place` takes it off the map: places
inside it move up to its area, connections to it go, homes there and anyone
there move to its area. Editing `place_id` or deleting the file yourself keeps
people from being stranded, but leaves every link to the old id for `wiki_lint`
to report.

**Every id is shared.** Characters, places and concepts share one namespace of
ids, and of names and aliases too. Two pages with one id hide each other, and a
generic alias such as "the gate" can send someone to the wrong place. Use
`wiki_lint`, `world_audit` (who's connected to whom), `map_route` (travel times)
and `memory_preview` (what someone would recall) to check your work.

## Creating a character

First decide with what the user asked for:

- **Simulated:** thinks and acts on their own, and costs model calls. Needs
  every step below.
- **Background:** only exists for others to talk about. Needs the world card
  alone, with `is_simulated_agent: false` and no workspace or `openclaw.json`
  entry.

If the user gave only a rough idea, make the creative choices yourself and tell
the user what you chose. Don't stop to ask.

1. Pick an id in kebab-case, unused in `shared/wiki/entities/characters/`.
2. Pick a `home` that exists in `shared/wiki/entities/places/`. Create a place
   first if they need their own room.
3. Write the world card:

   ```markdown
   ---
   pageType: entity
   entityType: person
   id: entity.character.<id>
   character_id: <id>
   name: <Full Name>
   is_simulated_agent: true
   home: <place_id>
   ---

   # <Full Name>

   What anyone who sees them would notice, in a sentence or two.
   ```

4. Write `workspaces/<id>/IDENTITY.md`: front matter with `agent_id`, `name`,
   and so on, then their bio, profile and appearance. Not their relationships:
   each person who matters to them gets a page in their wiki (below), which is
   what brings that person to mind and what sleep and `remember` keep current.
5. Write `workspaces/<id>/SOUL.md`, in the second or third person: temperament,
   habits, how they talk, how they treat the people around them. This is what
   makes them distinct, so give it the most care.
6. Write `workspaces/<id>/MEMORY.md` and seed their wiki (below).
7. Never create an `AGENTS.md` in a character's workspace. An avatar, if the
   user gives one, is `avatar.webp`, `.png` or `.jpg` in the workspace root.
8. Message the user with what you made, because the next step can interrupt your
   turn.
9. Last, `edit` `openclaw.json` to add this under `agents.entries`:
   `"<id>": { "workspace": "./workspaces/<id>" }`. Leave the rest of the file
   alone.

Once registered, a character is onstage and costs model calls unless the user
takes them offstage. They start at `home`.

## Editing a character

- **Who they are:** `IDENTITY.md` and `SOUL.md`.
- **What they remember or believe:** their `MEMORY.md` and personal wiki. An
  edit to a belief means they always believed it.
- **What is true of them:** their world card. Other characters' notes that
  disagree stay as they are, unless the user asks you to sweep them.
- **Not in Markdown:** where they are now, their current activity and their
  desires live in machine state. Writing them in a file changes nothing, and
  `home` only decides where someone starts if they have never moved. Tell the
  user what can't be done with files. What they are wearing and the world's
  other states are machine state too, but those you can set: see States.
- **Renaming an id** touches the card, the workspace, `openclaw.json` and every
  page that mentions it (`grep` for the id finds them). Tell the user what it
  would involve before starting. When you rename a place or concept in a
  template that others have copied, also add it to `kazusa.renames` in the
  template's `package.json` (`{ "old_id": "new_id" }`), so their copies follow
  it when they update (see `world-update`).

## Stickers

A character can send a sticker in a chat: a small picture of themselves, from
their own set. Others read a line describing it, built from the labels below, so
the labels are what matters.

```text
workspaces/<id>/stickers/
  happy.webp            # their usual clothes, the ones in IDENTITY.md
  laughing.webp
  maid-laughing.webp    # another outfit: the outfit's word comes first
  stickers.json
```

```json
{
  "outfits": { "maid": "a black-and-white maid dress and headband" },
  "stickers": {
    "laughing": { "look": "laughing with eyes squeezed shut" },
    "maid-laughing": { "look": "laughing with eyes squeezed shut" }
  }
}
```

- **A name** is lowercase words joined by `-`: an optional outfit word, then the
  mood. Use these moods where they fit: neutral, happy, laughing, excited, smug,
  shy, flustered, sheepish, surprised, confused, worried, sad, crying, annoyed,
  angry, determined, thinking, sleepy. Another plain word is fine when none
  does. Each name is distinct, so never `happy-2`; give the second one a truer
  mood instead.
- **`outfits`** describes every outfit except their usual clothes, once, as
  someone would see it. Only words declared here count as outfits in a name.
  Each one is also something the character can change into, and they can send
  only the stickers of what they are wearing (see States).
- **`look`** starts with the mood and says what the face and hands do. It is
  optional, but without it others read only the mood word.
- **Files** are raster images (`.webp`, `.png`, `.gif`, `.jpg`), square, about
  256 px, ideally with a transparent background. The filename without its
  extension is the name.
- Others read "<Name>, <look>, in <outfit>". Describe only what is visible: no
  franchise names, and nothing the picture doesn't show.

**Editing.** Relabel a sticker or describe an outfit by editing `stickers.json`.
`view_image` on a file shows what it really looks like, so check before you
label. You can't download, crop, rename or delete pictures yourself. When a name
must change, or the user wants new stickers, ask them to put or rename the files
in the folder, then label them. A character's sticker habit, such as rarely
using them or favoring one, belongs in their `SOUL.md`.

## Seeding the World Wiki

```markdown
---
summary: <One line on what this is.>
aliases: [<other names people use>]
community: <concept id of the group it belongs to>
renown: known
---

# <Title>

What most people know, in a paragraph.

## <Inside detail>

Detail only insiders would know.

## <A secret>

Known by: <character id>, <character id>

Only these characters know this.

## History

- <date> — Something that happened.
- <date> · news — Something announced publicly.
```

- `summary` is one line. The text before the first `##` is what people generally
  know, and `##` sections are insider detail.
- `community` says whose thing it is, as a concept id: a group names the larger
  body it belongs to, up to the world root. Write those parents first.
- `renown` is how far its name travels: `private`, `local`, `known` or `famous`.
  A person defaults to `local`, which nobody outside their own school, club or
  home knows: give a public figure, and a player the whole cast knows, `known`
  or `famous`.
- `Known by:` as the first line of a section limits it to those characters.
- An undated edit is a retcon: it was always true. A dated line under
  `## History` is something that happened, and `· news` makes it public.
- `## History` dates must be real (`2026-01-05`). The ancient past goes in an
  ordinary section instead.

## Seeding a character's wiki

Write pages only where the character colors the facts: people they have a
relationship with, strong opinions, misconceptions and secrets. Don't write a
page for everything they could know.

**A person** (`wiki/entities/characters/<id>.md`):

```markdown
---
name: <Full Name>
aliases: [<what this character calls them>]
summary: <One line on who they are to this character.>
relation: <a word or two, such as friend, rival or mentor>
learned: always known
---

# <Full Name>

In their own voice, first person: what they think of this person.

## Notes

- <date> · always known · sure — Something they know about this person.

## Open threads

- <A promise or unfinished business.>

## What they think of me

<Their guess at how this person sees them.> (think so)
```

Write **What they think of me** as a real guess, not a mirror of how the
character feels. Each side guesses separately and either can be wrong, which is
where the drama comes from. Relations are words; don't use numbers. For a human
player, name the file after their id without `user:` and add
`peer_id: user:<id>`.

**A place** (`wiki/entities/places/<place_id>.md`). The places a character knows
are exactly the ones they have a card for, so give them their home and everyday
haunts. Anywhere else, they take in the whole description on their first visit.

```markdown
---
place_id: <place_id>
name: <Display Name>
aliases: [<what this character calls it>]
learned: always known
---

What this place means to them, in their own voice.
```

**Their own view or theory** (`wiki/concepts/<id>.md`): `summary`, a
first-person lead and `## Notes`.

**Notes** are one line each, newest first: `date · source · certainty — text`.

- Sources: `seen it`, `told by <id>`, `overheard <id>`, `read it`, `my guess`,
  `always known`.
- Certainty: `sure`, `think so`, `suspect`, `doubt it`.
- Seeded notes use the world's start date and `always known`.

**`MEMORY.md`** has `## Lately` (who they are these days), `## Goals` and
`## Plans`. Never write where they are, their hunger or their activity there.

## Creating a place

```markdown
---
pageType: entity
entityType: place
id: entity.place.<place_id>
place_id: <place_id>
name: <Display Name>
aliases: [other names people use]
parent: <place_id of the area it is inside>
summary: "One sentence, with anything needed at the door. Open 08:00–19:00."
entry_minutes: 2
renown: local
map: { x: 0.42, y: 0.61 }
connections:
  - to: <another place_id>
    ways:
      - { by: walk, minutes: 10 }
      - { by: <any other way to travel in this world>, minutes: 4 }
    note: "What the route is like."
---

# <Display Name>

The full description, shown to someone the first time they are here. Say whose
it is, how it is kept and how busy it gets.
```

- `place_id` is lowercase letters, digits, `_` and `-`, and must be unused.
- Places form a tree through `parent`. A place with no `parent` is top level and
  needs a connection to the rest of the map. Every place is somewhere to stand;
  an area means its open space.
- `entry_minutes` is the walk to the parent. `connections` are extra routes,
  two-way and declared on one page only, with the usual way first.
- `map` is optional: where the place is drawn, as `{ x, y }`, a fraction of the
  map from 0 to 1 with y growing south, plus `plane` when a world has several
  separate maps (a surface and an underworld). Add it when you know the
  geography. Without it the map works out a spot from travel times. It is only a
  picture: routes and travel times never read it, so set those with
  `connections`.
- Hours and locks go in `summary`, because it is all a returning visitor sees.
- There are no flags for ownership, visibility or crowds. Write those in the
  description. Use `renown: private` for private homes and hideouts.

Before finishing, check that the `parent` and every `to` exist, that nothing
connects to itself or twice to the same place, that no `parent` chain loops, and
that the new place can be reached from the rest of the map. Then run
`wiki_lint`.

## States

A state is a named value the world keeps. It records where things stand; it
never tells a character who to be. Who they are is their SOUL and IDENTITY, and
how they treat someone is what they remember of them. A state that pulls against
those loses, so use a state for one of two things:

- **A fact a character has to live with**: money, an injury, the week it is, the
  chapter of the story. They act on these. With 1 left they do not buy what
  costs 6; in exam week they turn down the arcade.
- **A meter of where things stand**: how one person regards another, a mood over
  weeks, a reputation. A meter follows what a character remembers and does not
  steer them. Told only that their trust is absolute, or guarded, they answer
  the same request the same way. It is for the user to watch and for you to act
  on.

So before you define one, ask what it is for. To make someone behave
differently, change their files or their wiki, not a state. To track something
the user wants to see move, or that you will act on, a meter. To give the world
a rule everyone must respect, a fact.

Define them in `shared/stats.json`, a JSON array; the user can do the same in
Settings → States, which gives the same advice as it goes.

```json
[
  {
    "name": "money",
    "description": "What you have on you to spend. A meal costs about 1 and a nice gift about 6. It changes only when you actually pay for something or are given money.",
    "on": "character",
    "kind": "number",
    "min": 0,
    "max": 50,
    "initial": 20,
    "changedBy": "character",
    "shown": "self"
  },
  {
    "name": "warmth",
    "description": "How warmly you regard this person. It moves only on something that mattered between the two of you: a kindness, a slight. An ordinary pleasant day changes nothing.",
    "on": "pair",
    "kind": "number",
    "min": 0,
    "max": 23,
    "initial": 10,
    "bands": [
      {
        "name": "cold",
        "min": 0,
        "description": "You would rather avoid them"
      },
      { "name": "friendly", "min": 8, "description": "Glad to see them" },
      {
        "name": "close",
        "min": 16,
        "description": "You trust them and seek them out"
      }
    ],
    "changedBy": "reviewed",
    "shown": "self"
  }
]
```

The first is a fact, the second a meter.

- **`name`** is lowercase words joined by `_`, unique. `outfit` is taken
  (below).
- **`description`** is the one thing a character is told about it, so write it
  to them. Say what moves it, by what happens: "only when they kept or broke
  their word to you". Give a fact its prices ("a meal costs about 1"). Do not
  say how far it moves ("a step at most in a day"): code holds to that. Each
  value of a choice can have its own.
- **`on`**: `character` (each has their own), `pair` (one person's value toward
  each other person, private to them), `world` (one for everyone) or `player`
  (only the human player has it, and sets it themselves; characters with the
  player read it).
- **`kind`**: `choice` with at least two `values` and an `initial` among them,
  or `number` with `min`, `max` and `initial`. Optional `bands` name ranges of a
  number, lowest first, each with an optional `description` of what standing
  there means. With bands a character reads the word, never the number, and
  moves it one `step` (1 unless you set it) up or down instead of choosing a
  number. Without bands they read and give the number itself, which suits a fact
  they count (money, health).
- **How fast a meter moves is how far apart you put its bands.** One thing that
  mattered moves it one step, so the steps between two bands are how many such
  things it takes to change the word. Put them about 8 apart, as above. Measured
  on written days: 3 apart, a fortnight where nothing happened moved a whole
  band; 8 apart it held, and a kept or a broken promise still moved it nearly
  every time. Never make a meter a `choice`: a character takes a whole word for
  too big a step, and it hardly moves either way.
- **`changedBy`**: `character` (they change it themselves as they act: a fact
  they handle, like money or what they wear), `reviewed` (their night's sleep
  looks back on the day and moves it one step if something that mattered
  happened: a meter) or `manual` (only you and the user: a chapter, a rank). A
  `world` or `player` state is `manual`; a `pair` state is `reviewed` or
  `manual`.
- **`shown`**: `self` (they read it; not for a `player` state), `everyone`
  (people with them see it too; not for a `pair`) or `nobody` (kept for the user
  and for you).
- **Keep it small.** A character reads every state each turn and weighs each one
  they can change, so about 8 that reach characters is plenty. One meter toward
  someone is enough: two fed by the same events (liking and trust) move together
  however you word them. A sheet of numbers nobody acts on (strength, level)
  costs nothing as `manual` and `nobody`.
- A file that isn't valid reads as no states at all. Check your JSON, then set
  one value with `set_state`: it refuses a state that isn't defined. Removing a
  definition keeps its values; they return if it comes back.

**Setting a value** is `set_state`: `name` and `value`, with `characterId` for a
state on a character (the player's id for one of the player's), `toward` as well
for one toward someone, and neither for the world's. A `null` value puts it back
to its initial. You can set any state, whatever its `changedBy`.

**Working with meters.** Three things a meter will not do by itself:

- **Start right.** Everyone starts at `initial` toward everyone. Where two
  people already have a history (old friends, rivals), set that pair when you
  make them, or the state says "no particular feeling" about someone their own
  page calls a best friend.
- **Change behaviour when you set it.** If you move a meter by hand, rewrite
  their page on that person to match
  (`workspaces/<id>/wiki/entities/characters/`), or nothing they do will follow.
  The other way round is fine: change the page and let their nights move the
  meter.
- **Make something happen at a level.** When the story should turn on a state (a
  scene that opens once they are close, a secret told once trust is high), read
  the state yourself and make it happen: set the scene, send the message, write
  it into their memory. Do not wait for the character to act the number.

**Outfit** is a state every character with outfits already has, so never define
it: its values are `usual` and the words in their `stickers.json` `outfits`. To
dress someone, `set_state` with `name: "outfit"`. To give someone a new outfit,
it needs pictures and an entry in `outfits` first (see Stickers).

## Writing a skill for every character

A skill is know-how anyone in the world could look up when they need it: how a
craft is done, how a ritual goes, the rules of a game. It is not lore (that is a
concept page) and not who someone is.

```markdown
---
name: <skill-name>
description: "What it covers and when to use it, in one or two sentences."
---

# <Title>

The steps or rules, written for someone in this world.
```

- Save it as `shared/skills/<skill-name>/SKILL.md`. The name is lowercase words
  joined by `-`, and the folder has the same name.
- Characters see only the `description` until they open the skill, so make it
  say when it applies.
- `context-conventions`, `task-lifecycle`, `task-interrupt`, `in-person`,
  `perception`, `location-judgment` and `sleep-consolidation` are how the world
  runs, and the engine gives them to characters itself. Read the original in
  `../shared/skills/<name>/SKILL.md` before replacing one with a copy here.
- Skills reload on their own within a second and apply from each character's
  next turn. Run `refresh_skills` to see who can read what, or if a new one
  doesn't show up.
- A skill only one character should know goes in their workspace instead:
  `workspaces/<id>/skills/<skill-name>/SKILL.md`. It reaches only them. A copy
  there of a world skill, or of one of the engine's, replaces it for them alone.

## Your own skills and tools

Your skills and tools come with Kazusa and update with it. Your built-in skills
are in `workspaces/<your id>/.agents/skills/`, a copy of Kazusa's own files made
every time it starts: read them, but never edit them, because the next start
replaces them. Your entry in `openclaw.json` holds your workspace, name and
`cwd`, plus an `$include` of `.state/kazusa/system-agent.json`, which Kazusa
rewrites every time it starts. Never edit that file either.

When the user asks you to learn something, or to change or drop a skill or tool,
put it in the world, where it outlives updates:

- **A new skill for yourself:** write
  `workspaces/<your id>/skills/<skill-name>/SKILL.md`, in the same format as a
  skill for characters, then add its name beside the `$include` in your entry:
  `"skills": ["<skill-name>"]`. A list there is added to Kazusa's, not swapped
  for it, so name only your own.
- **Changing one of your skills:** copy its folder from `.agents/skills/` to
  `workspaces/<your id>/skills/` and edit the copy; a skill there wins over the
  built-in one of the same name. Tell the user their copy no longer gets
  Kazusa's improvements to it.
- **A tool you don't have:** add `"tools": { "allow": ["<tool>"] }` beside the
  `$include`, naming an OpenClaw tool (the `openclaw` skill lists them) or an
  installed plugin's id, which brings all its tools.
- **A tool to stop using:** `"tools": { "deny": ["<tool>"] }`. A denied tool is
  gone even when Kazusa grants it, which is also why shell and code execution
  stay off whatever you allow.
- **What can't be done:** you can't drop one of Kazusa's skills, only replace it
  with a copy, and you can't make a new tool: that takes code, a plugin a
  developer writes and the user installs. Say so.

Message the user before you edit `openclaw.json`, because the change can
interrupt your turn.

**When it applies.** Skill lists are only reloaded at certain moments, so tell
the user which kind their change is:

- **The next time it is read:** editing the text of a skill already in use,
  yours or a character's.
- **Your next turn:** a new skill once you list it, or a tool you allow or deny.
  Write the skill's file before you list it, because listing it is what makes
  Kazusa look for it.
- **Only after Kazusa restarts:** a copy that replaces one of your built-in
  skills, and a changed `description`, yours or a character's. Nothing you can
  run brings these in sooner, so say plainly that it needs a restart.

## Finishing

Read back what you wrote, then tell the user through `send_message`: the files
you created or changed, the choices you made, and anything skipped.
