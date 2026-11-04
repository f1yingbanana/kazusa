---
name: world-update
description:
  "Bring this world up to date when its creator has released a new version of
  the template it was made from, keeping everything play has written. Use when
  the user says the world was updated, asks to get the latest version of their
  world, or `world_update` check shows changes."
---

# Updating the World

This world is a copy of a template in `../worlds/<id>/`. When the template's
creator releases a new version, the user's copy doesn't change by itself.
Updating merges the creator's new version into this world without losing what
play wrote: what characters remember, the notes on their cards, the people
they've met, the user's own edits and map layout.

`world_update` does the mechanical work across thousands of files. Your job is
the judgment: explaining the update, settling the choices with the user,
resolving what doesn't merge, and checking the result. Never edit the template
in `../worlds/` (it's the creator's), and never edit `.template/` by hand.

## Keep a job file

An update spans several runs: you pause to ask the user things, and every run
starts knowing only your files and the recent chat. Keep
`workspaces/<your id>/projects/world-update.md` from the first check to the end,
and read it first in every run:

```markdown
# World update to <template> (<date>)

## The user's choices

- Framing: retcon / in-world / mixed (with what they said, in their words)
- Layout: keep / reset. Who moves: stale / all. Best attempt accepted: yes / no

## Reasons the user gave

- <change>: <their reason, word for word>

## Items

- [x] <file>: <what you did and why>
- [ ] <file>: <your proposal>, waiting on <question>

## Next step

<exactly where to pick up>
```

Write the user's answers down the moment you get them. Before asking anything,
look in this file and the recent chat: if they already told you (a reason, a
choice, "just keep mine"), use it and don't ask again.

## How the merge decides

`.template/` holds the template as it was when this world was made or last
updated. That record is the **base**. For every page, part by part (each
frontmatter field, the lead, each `##` section):

- Changed only by the creator: the creator's version.
- Changed only here: this world's version.
- New in the template: added. Removed by the creator and untouched here:
  removed.
- `## Notes` and `## History`: lines from both sides are kept.
- A character's own fields (`learned`, `seen`, `summary`...) on her pages: hers.
  A card's `name` always follows the world page.
- Changed on both sides differently: this world's version stays, and it's
  reported as a **conflict**.

Place ids the creator renamed (`renames` in the template's `world.json`) follow,
with every card and position that used them. A card for a place that no longer
exists is **forgotten** if it holds nothing the character wrote (a bare visit
stamp), and **orphaned** if it does.

**Without a base** (`bestAttempt: true` in the check), the merge guesses what
play wrote from its marks: visit stamps, notes, history, sleep's sections, the
map layout. A page with none of them takes the creator's version; a character's
page with any of them keeps her text and reports the differences as conflicts.
Nothing here is removed, and world pages the template lacks are listed as
`notInTemplate`, because they may be the user's own or may be gone upstream.

## Pages that don't merge one to one

Most pages do. These don't, and they come back as conflicts and orphans:

- **Content moved:** a place split in two or folded into another, an id renamed
  without being listed, a section renamed, a group merged into another.
- **A memory filed by name:** a card a character wrote under a place's name, not
  its id, so it matches nothing.
- **A fact changed under a memory:** someone's home moved, a place closed, a
  club was reorganized, while characters remember it the old way.
- **The user's own edit against the creator's rewrite** of the same page.

Each needs two things: where the content belongs now, and how the change should
feel to the people in the world (framing, below).

## Framing: retcon or in-world

Ask the user once how characters should experience the update:

- **Retcon:** the world was always like this. Edit without dates: no
  `## History` lines, no news, no notes saying anything changed, and never an
  in-world reason. Where a character's page contradicts the new truth, edit it
  minimally so she always believed it (an edit to a belief means she always
  believed it), but keep memories of things that happened in play, moved to
  wherever the place or person now is.
- **In-world:** these things happened. Record each structural change as a dated
  `## History` line (`- <today> — …`, with `· news` if it would be public) on
  the page it happened to, or on its parent or successor if the page itself is
  gone. Characters then learn it as they visit or hear the news. Leave their
  beliefs as they are: they find out. Use the user's reason. If they gave none,
  ask; never make one up.
- **Mixed:** the user picks per change ("retcon the map, but the new students
  transferred in"). Record which is which in the job file.

## 1. Look before touching anything

1. Read your job file if it exists, then `shared/wiki/INDEX.md` here and
   `../worlds/<id>/shared/wiki/INDEX.md`, to see how the world has changed in
   the creator's words.
2. Run `world_update` with `action: "check"`. It changes nothing.
   - `bestAttempt: true`: this world has no record of the version it was made
     from. Tell the user plainly that the update is a best attempt that can go
     badly, worst of all if this world was never really a copy of this template;
     `overlap` is the share of pages they have in common, and below about 0.5
     they probably aren't the same world. Only go on if they accept.
   - `counts` shows files added, updated, merged and removed, and how many are
     conflicts or orphans.
   - `newCharacters` are people the new version adds; `removedCharacters`,
     people it no longer has (this world keeps them).
   - `arrangedPlaces`: places with a map position the user arranged.
3. **Pause for the user's choices**, all in one message: what the update brings
   and what it keeps, then only the questions you don't already have answers to:
   - **Framing:** retcon, in-world or mixed (above).
   - **Layout** (only if `arrangedPlaces` is more than 0): `keep` their arranged
     positions, or `reset` to the creator's. A rebuilt map can leave an old
     arrangement looking odd; they can re-arrange in the client later.
   - **Who moves** (`rehome`): `stale` moves only characters standing at, or
     travelling through, a place that no longer exists; `all` sends everyone
     home, right when the update changed where people live.
   - **Best attempt**, if it is one.

   Save the job file, then end your turn and wait.

## 2. Apply

1. Pause the clock: `clock_now` to note the speed, then `clock_set_speed` 0.
   `world_update` refuses to apply while time runs. It stays paused until the
   end.
2. `world_update` with `action: "apply"`, the chosen `layout`, and
   `bestAttempt: true` only if the user accepted it. It backs up the world's
   files first and reports the backup.

## 3. Resolve, then ask what only the user can say

`world_update` `action: "conflicts"` lists each file with its three versions:
`live` (this world, a path from here), `template` and `base`. Read them; the
base shows what each side actually changed. For each item, decide where its
content belongs and apply the framing:

- **A world page:** the creator's facts are the new truth. If this world's
  change was the user's own edit (a description they asked for, a detail they
  added), keep it and work the creator's facts in around it.
- **A character's page or `MEMORY.md`:** her words win. Keep her version, and
  bring in a fact from the creator only as the framing says: retcon, adjust her
  page so she always knew it; in-world, leave it for her to discover.
- **A file that isn't Markdown** (an image, `stickers.json`): this world's copy
  stays unless the user wants the creator's.
- **`orphaned`**, with a reason. `the creator removed it; it changed here`: a
  character's card for a place that still exists can stay.
  `its place no longer exists`: find where it belongs (below).
- **`keptDeleted`:** deleted here, changed by the creator. Leave them deleted
  unless the user wants them back.
- **`notInTemplate`** (best attempt only): world pages the template lacks. Keep
  the user's own; for anything that looks like the creator's old content, ask.

### Finding where something went

Only for the items reported:

1. The old page's name, aliases and summary tell you what it was. `grep` for its
   id and name at once (`old_id|Old Name`), here and in the template
   (`path: "../worlds/<id>"`): a successor's `aliases` often keep the old name,
   and pages that link to it show where it went. The template's `INDEX.md` and
   `look_up` help with what it was for.
2. Read the likely successors before deciding.
3. Carry the character's words to the successor: if she already has a card for
   it, add what she wrote there (her lead if that card's is empty, or her lines
   under `## Notes`); if not, make the card from hers with the new `place_id`
   and `name`. Then delete the orphan.

### When to stop and ask

Decide everything you can yourself and record it in the job file. Pause only for
what the user must decide:

- The user's own edit can't live with the creator's change.
- A character's memory has nowhere to go, and dropping it would lose something
  that happened in play.
- A character the creator removed is still registered here (keep, or retire?).
- In-world framing and a change with no reason from the user.

Ask them all in one message, each with what you propose. Save the job file first
(each open item with your proposal and the question), then end your turn. When
they answer, record it, apply it and carry on.

## 4. Finish

1. `world_update` with `action: "finish"` and the chosen `rehome`. It refuses
   while the map doesn't load, listing the problems. Fix them (usually a place
   whose `parent` or connection points at something gone), then finish again.
   Finishing moves stranded characters and records the new version as the base.
2. Check the result:
   - `wiki_lint` with no agent: zero errors.
   - `world_audit`: does everyone still have places and people? Every name in
     `knowNobody`, `knowNoPlaces` or `agentsWithoutCard`, and more than one
     group in `socialGroups`, is a problem: report each to the user, even when
     the update didn't cause it.
   - `map_route`: a few everyday journeys, such as a home to a school and to a
     hub, should take believable times.
3. `unregistered` lists new characters with no entry in `openclaw.json` yet.
   Registering someone starts them thinking, which costs money, so ask the user
   first. To register, follow `world-building`, and do it last.
4. Restore the clock to the speed you noted, only when the user wants time to
   run again.
5. Tell the user what changed and what was kept: what you resolved and how, the
   choices they made, where the backup is, and that `world_update` `undo` can
   put the files back (positions finishing moved stay put). Mark the job file
   done.

## Undoing

`world_update` with `action: "undo"`, with the clock paused, restores every file
from the last backup, including the base. Characters moved by finishing stay
where they are; move them with their own tasks or ask the user.
