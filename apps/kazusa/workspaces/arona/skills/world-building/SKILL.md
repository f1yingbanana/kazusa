---
name: world-building
description:
  "Create or edit characters, seed the World Wiki or a character's personal
  wiki, and create or change places. Use when the user asks to add someone to
  the world, change who a character is or what they remember, write lore, or add
  to the map."
---

# Building the World

Everything here is a Markdown edit with your file tools, except one line of
`openclaw.json`. Requests come from the user only.

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

| Change                                        | Takes effect                                |
| :-------------------------------------------- | :------------------------------------------ |
| Personal wiki, `MEMORY.md`, `SOUL.md`         | That character's coming turns               |
| `IDENTITY.md`                                 | Coming turns, and the client's next refresh |
| Adding to `agents.entries` in `openclaw.json` | By itself, but it can interrupt your turn   |
| Any place, or a `home` on a character card    | Only after the user reloads the plugin      |
| Concept pages                                 | Coming turns                                |

The reload command is for the user, since you cannot run it:
`openclaw plugins reload kazusa --wait`. If it doesn't take, they restart the
Gateway. Always say when one is needed.

**A broken map stops the whole location system on the next reload.** An unknown
`home`, `parent` or connection target breaks every character, not just one.
Check each id you use with `ls` before writing it.

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
   and so on, then their bio, profile, key relationships and appearance.
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
takes them offstage. They start at `home` after the reload.

## Editing a character

- **Who they are:** `IDENTITY.md` and `SOUL.md`.
- **What they remember or believe:** their `MEMORY.md` and personal wiki. An
  edit to a belief means they always believed it.
- **What is true of them:** their world card. Other characters' notes that
  disagree stay as they are, unless the user asks you to sweep them.
- **Not in Markdown:** where they are now, their current activity and their
  desires live in machine state. Writing them in a file changes nothing, and
  `home` only decides where someone starts if they have never moved. Tell the
  user what can't be done with files.
- **Renaming an id** touches the card, the workspace, `openclaw.json` and every
  page that mentions it. Tell the user what it would involve before starting.

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
- `Known by:` as the first line of a section limits it to those characters.
- An undated edit is a retcon: it was always true. A dated line under
  `## History` is something that happened, and `· news` makes it public.

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
- Hours and locks go in `summary`, because it is all a returning visitor sees.
- There are no flags for ownership, visibility or crowds. Write those in the
  description. Use `renown: private` for private homes and hideouts.

Before finishing, check that the `parent` and every `to` exist, that nothing
connects to itself or twice to the same place, that no `parent` chain loops, and
that the new place can be reached from the rest of the map. Then tell the user
to reload the plugin.

## Not built yet

The memory module is designed but not implemented. Write in the formats above,
since they are what it will read, but don't promise what it will do:

- Concept pages, `community`, `renown`, `Known by:`, `## History` and `· news`
  have no effect on characters yet. If a character must know something now, put
  it in their `MEMORY.md` or personal wiki too.
- `wiki_lint`, `knowledge_explain`, `memory_consolidate` and `memory_restore`
  don't exist yet, even if the `kazusa` guide mentions them. Check your work by
  reading the files back.

## Finishing

Read back what you wrote, then tell the user through `send_message`: the files
you created or changed, the choices you made, anything skipped, and whether a
reload is needed.
