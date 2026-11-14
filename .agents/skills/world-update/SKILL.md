---
name: world-update
description:
  "Bring this world up to date when its creator has released a new version of
  the template it was made from, keeping everything play has written. Use when
  the user says the world was updated, asks to get the latest version of their
  world, or `world_update` check shows changes."
---

# Updating the World

This world is a git clone of its creator's repository. It stands on one of the
creator's releases, and everything play wrote (memories, notes on cards, new
pages, the user's edits) is the uncommitted changes on top. When the creator
releases a new version, Kazusa's client tells the user and, when they say so,
downloads it (Settings → Updates → World); then a button there asks you to bring
it in. Updating merges the new release into this world without losing what play
wrote: what characters remember, the notes on their cards, the people they've
met, the user's own edits and map layout.

`world_update` does the mechanical work across thousands of files. Your job is
the judgment: explaining the update, settling the choices with the user,
resolving what doesn't merge, and checking the result. `show` reads any file as
the new release has it, or as this world's old version had it.

Read this whole skill at the start of every update, even if you've done one
before: each version brings different changes and needs its own choices, and
working from memory of the last one goes wrong.

## Keep a job file

An update spans several runs: you pause to ask the user things, and every run
starts knowing only your files and the recent chat. Keep
`workspaces/<your id>/projects/world-update-<version>.md`, named for the version
you're bringing in (`check`'s `version.template`), from the first check to the
end, and read it first in every run. Each update has its own file; leave the
ones from earlier updates as they are. Choices from an earlier update don't
carry over; ask again if this update needs them.

```markdown
# World update to <template> (<date>)

## The user's choices

- Framing: retcon / in-world / mixed (with what they said, in their words)
- Layout: keep / reset. Who moves: stale / all

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

The **base** is the creator's commit this world last took: the one it was made
from, or the one the last update brought in. The world records it. For every
page, part by part (each frontmatter field, the lead, each `##` section):

- Changed only by the creator: the creator's version.
- Changed only here: this world's version.
- New in the template: added. Removed by the creator and untouched here:
  removed.
- `## Notes` and `## History`: lines from both sides are kept.
- A character's own fields (`learned`, `seen`, `summary`...) on her pages: hers.
  A card's `name` always follows the world page.
- Changed on both sides differently: this world's version stays, and it's
  reported as a **conflict**.

Place ids the creator renamed (`kazusa.renames` in the template's
`package.json`) follow, with every card and position that used them. A card for
a place that no longer exists is **forgotten** if it holds nothing the character
wrote (a bare visit stamp), and **orphaned** if it does.

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
- **In-world:** these things happen now. Record each structural change as a
  `## History` line dated today, the in-world date `clock_now` gives
  (`- <today> — …`, with `· news` if it would be public), on the page it
  happened to, or on its parent or successor if the page itself is gone. Never
  backdate it or say when else it happened ("last week"): that's inventing
  history. Characters then learn it as they visit or hear the news. Leave their
  beliefs as they are: they find out. Use the user's reason. If they gave none,
  ask with the framing question; never make one up.
- **Mixed:** the user picks per change ("retcon the map, but the new students
  transferred in"). Record which is which in the job file.

## 1. Look before touching anything

1. Read your job file if it exists, then run `world_update` with
   `action: "check"`. It changes nothing.
2. Read `shared/wiki/INDEX.md` here, and the new release's with `world_update`
   `show` (`path: "shared/wiki/INDEX.md"`), to see how the world has changed in
   the creator's words.
3. Look at the check:
   - `upToDate: true`: no newer version is downloaded. If the user expects one,
     ask them to download it in Settings → Updates → World, which shows its size
     first, and to tell you once it's done. A release with pictures can take a
     few minutes.
   - `version` is this world's version (`world`) and the downloaded release's
     (`template`), and `notes`, the creator's release notes: use them to tell
     the user what the update is for.
   - `counts` shows files added, updated, merged and removed, and how many are
     conflicts or orphans. `areas` says what kind of files they are, which is
     what to tell the user: `workspaces/*/portraits` are how characters are
     drawn in scenes, `workspaces/*/stickers` their stickers, `shared/backdrops`
     the scenes' backgrounds, `shared/wiki/...` world pages, and
     `workspaces/*/wiki/...` or `MEMORY.md` what characters know. Pictures are
     files, not pages or new content to read. When pages are only `updated`,
     compare one with the new release's (`show`) to say what changed (a new
     field such as `backdrop:`, a rewrite).
   - `renames` lists only the renames this world hasn't taken yet.
   - `newCharacters` are people the new version adds; `removedCharacters`,
     people it no longer has (this world keeps them).
   - `arrangedPlaces`: places with a map position the user arranged;
     `arrangedPlacesTheCreatorMoved`, how many of them the creator positioned
     differently.
   - `ask` lists the choices this update needs from the user, and `next` says
     what to do. An empty `ask` (only files added or updated, nothing removed,
     renamed or contested) needs no framing or layout question: if the user
     asked for this update, tell them what it brings and go on to apply in the
     same turn. If they didn't ask, ask whether to.
4. **Pause for the user's choices** in `ask`, all in one message: what the
   update brings and what it keeps, then only the questions you don't already
   have answers to for this update:
   - **Framing:** retcon, in-world or mixed (above).
   - **Layout** (only if `ask` has it): `keep` their arranged positions, or
     `reset` to the creator's. A rebuilt map can leave an old arrangement
     looking odd; they can re-arrange in the client later.
   - **Who moves** (`rehome`): `stale` moves only characters standing at, or
     travelling through, a place that no longer exists; `all` sends everyone
     home, right when the update changed where people live.

   Save the job file, then end your turn and wait. A question is a stop: never
   call `apply` in the turn you asked, however sure the answer seems.

## 2. Apply

1. Pause the clock: `clock_now` to note the speed, then `clock_set_speed` 0.
   `world_update` refuses to apply while time runs. It stays paused until the
   end.
2. `world_update` with `action: "apply"` and the chosen `layout`. It first saves
   the world exactly as it is (`saved` names the save), then merges the release
   in. Until `finish`, `restore` can put it all back (below).

## 3. Resolve, then ask what only the user can say

`world_update` `action: "conflicts"` lists each file and the parts both sides
changed, as `apply` found them; `editedSinceApply` says whether you've changed
the file since, and `stillThere` whether an orphan is. Read the file here, and
its other versions with `show` (`version: "new"` for the release, `"old"` for
what this world stood on before): the old one shows what each side actually
changed. For each item, decide where its content belongs and apply the framing:

- **A world page:** the creator's facts are the new truth. If this world's
  change was the user's own edit (a description they asked for, a detail they
  added), keep it and work the creator's facts in around it.
- **A character's page or `MEMORY.md`:** her words win. Keep her version, and
  bring in a fact from the creator only as the framing says: retcon, adjust her
  page so she always knew it; in-world, leave it for her to discover.
- **A file that isn't Markdown** (an image, `stickers.json`, `portraits.json`):
  this world's copy stays unless the user wants the creator's. New pictures the
  creator added (stickers, portraits, backdrops) are simply added, and need no
  framing: they are how people and places look, not something that happened.
- **`orphaned`**, with a reason:
  - `the creator removed it; it changed here` on a **world page** (under
    `shared/`): the creator meant it gone. Carry what play added (notes, history
    lines, the user's own words) to where it belongs now (below), then delete
    the page. Keep it only if the user says so: keeping a removed place puts it
    back on the map.
  - The same reason on a **character's own file** (her card, her memory): her
    words stay. A card for a place that still exists stays as it is.
  - `its place no longer exists`: a card for a place that's gone. Find where it
    belongs (below).
- **`keptDeleted`:** deleted here, changed by the creator. Leave them deleted
  unless the user wants them back.

### Finding where something went

Only for the items reported:

1. The old page's name, aliases and summary tell you what it was. `grep` for its
   id and name at once (`old_id|Old Name`) here: after `apply` this world is the
   new release, so a successor's `aliases` often keep the old name, and pages
   that link to it show where it went. The old version of a page (`show`,
   `version: "old"`) and `look_up` help with what it was for.
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

Only once every conflict and orphan is resolved (or waiting on the user, with
your proposal in the job file): finishing closes the update, and what's left
unresolved is easy to forget afterwards. An orphan from before this update
(`its place was already gone before this update`) is resolved the same way.
Never leave two of a character's cards with the same `place_id`: merge hers into
the existing one and delete the orphan.

1. `world_update` with `action: "finish"` and the chosen `rehome`. It refuses
   while the map doesn't load, listing the problems. Fix them (usually a place
   whose `parent` or connection points at something gone), then finish again.
   Finishing moves stranded characters and closes the update.
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
5. Always end by telling the user what changed and what was kept: what you
   resolved and how, and the choices they made. An update the user hears nothing
   about looks stuck. Mark the job file done.

## If it goes wrong: restore, then carry on

`apply` saves the world before it changes anything, and `world_update`
`action: "restore"` (clock paused) puts every world file back exactly as that
save kept it and closes the update. Characters' databases aren't touched, and
nothing from play is lost: everything since `apply` happened with the clock
paused.

- **`apply` was cut short** (Kazusa stopped, an error mid-way): every other
  action then says so. Restore, `check` again, and `apply` again with the same
  choices from your job file. No need to ask the user again; tell them it was
  interrupted and redone.
- **The update went badly** (a resolution you can't make work, the user changed
  their mind): tell the user what happened and offer to restore. Once they
  agree, restore, and note in the job file that the update was abandoned and
  why. They can update again later from a clean start.

Restore only works until `finish`. After that there is no undo, so get it right
before you finish.
