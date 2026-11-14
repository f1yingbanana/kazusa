# World Packages and Versioning

Status (2026-11-05): §1–§3 built (`WorldPackageSchema` in `@kazusa/client`,
`src/world/package.ts`, `src/world-update/`, `apps/web/lib/setup/`,
`scripts/world-package.mjs`, `scripts/world-repo.mjs`); §4 is the agreed design,
built through step 1 of its roadmap (§4.8). Read this before changing a world's
`package.json`, how a world is set up or updated, or anything about versions,
forks, history or saves.

Goal: a world is a thing people make, share, fork and keep playing. It should
carry who made it and which version it is, take its creator's later releases
without losing what play wrote, and one day be saved and loaded. Each step below
has to stand on the one before it, so the early choices are the ones that
matter.

## 1. The manifest: `package.json`

Every world, template or live, describes itself in an npm-style `package.json`.
npm's own fields say what the world is; everything Kazusa needs sits under one
`kazusa` key, the way tools keep their config in a package.

```json
{
  "name": "cute-and-funny-world-of-kivotos",
  "displayName": "Cute and Funny World of Kivotos",
  "version": "0.3.0",
  "description": "The students of Kivotos, from Trinity to Millennium. …",
  "author": "breados17",
  "homepage": "https://openrp.ai/kazusa",
  "private": true,
  "kazusa": {
    "systemAgent": "arona",
    "defaultGroup": "After-School Sweets Club",
    "renames": { "black_market": "black_market_district" },
    "config": {
      "welcome": ["…"],
      "user": { "id": "user:sensei", "name": "Sensei" },
      "world": { "title": "Kivotos" }
    },
    "template": "blue-archive"
  }
}
```

| Field                 | Meaning                                                                                                 |
| :-------------------- | :------------------------------------------------------------------------------------------------------ |
| `name`                | npm's lowercase slug: the world's lasting identity. Never renamed once released.                        |
| `displayName`         | The name people read (setup guide, screenshot credit). Not npm's own field; editors use it this way.    |
| `version`             | Semver, raised with every template release. On a live world: the release it is on.                      |
| `description`         | One or two sentences for the setup guide.                                                               |
| `author`              | npm's author, `"Name <email> (url)"` or `{ name, email, url }`. Credited on shared screenshots.         |
| `homepage`            | Where the world lives; the screenshot credit's link.                                                    |
| `private`             | Always `true`: a world is never published to the npm registry.                                          |
| `kazusa.title`        | The setup guide's label when it shouldn't be `displayName` (the starter: "Start from scratch").         |
| `kazusa.systemAgent`  | The system admin's agent id.                                                                            |
| `kazusa.defaultGroup` | The group the setup guide picks to start with: a value of one of the world's anchors.                   |
| `kazusa.renames`      | Place and concept ids the creator renamed, `{ "old_id": "new_id" }`, so copies follow on update.        |
| `kazusa.config`       | Merged into the plugin's config (`openclaw.json`) once, at setup. Later edits here don't reach a world. |
| `kazusa.template`     | Live worlds only: the template (`worlds/<id>`, its id in `world-sources.json`) the world is a copy of.  |
| `repository`          | Npm's: where the world lives and its updates come from (`{ type: "git", url }`).                        |

Rules:

- **One schema.** `WorldPackageSchema` in `@kazusa/client` is the only
  definition; the plugin and the setup guide both parse with it. Add a field
  there first. Unknown keys are kept (`looseObject`), so a world can carry
  fields an older Kazusa doesn't know.
- **Identity is `name`, not the folder.** Folders are where a template happens
  to be installed; `name` is what a world _is_. Today `kazusa.template` links a
  copy to its template by folder; once templates are repos (§4.5) the link is
  npm's `repository` field and `name`.
- **Raise `version` with every template release** (Publish does, §4.7), or
  copies can't tell they are behind. Patch for fixes to pages, minor for new
  characters or places, major when a copy needs the system admin's help to take
  it (renames, removals).
- **Credit comes from the live world's own file.** A fork that wants its own
  credit changes `name`, `displayName` and `author`; `kazusa.template` still
  says where it came from.
- **No runtime state.** The manifest describes the world as authored. Clock,
  positions, memories and sessions live in stores and `.state/`.

## 2. Lifecycle today

What's built today, being replaced: §4.5–§4.7 is the agreed design (a world is a
git clone; updates stash, check out the release and merge back), and §4.10 says
what's kept.

- **Setup** (`apps/web/lib/setup/setup.ts`, `world-repo.mjs list` and `clone`):
  lists the worlds in `apps/kazusa/world-sources.json` by peeking at each one's
  `package.json` (a shallow clone with no file contents, about a second each),
  and on a pick clones that world's newest release into `world/` (`cloneWorld`:
  cloned beside as `world.cloning`, then its `.git`, `package.json`, `shared/`
  and `workspaces/` moved in, replacing another pick that wasn't set up and
  keeping anything else there, such as `.state/`). The cast is read from the
  clone. `apply` then links the system agent to Kazusa's guides
  (`workspaces/<agent>/.agents`) and writes `openclaw.json` (merging
  `kazusa.config`): the world is set up once that exists. Git's progress comes
  back as JSON lines (`runScript`'s `onProgress`) and is kept in memory for the
  guide's bar (`GET /setup/world`).
- **Credit** (`src/world/package.ts`, `GET /kazusa/world` →
  `WorldMeta.package`): read on each request, so editing the file needs no
  restart. The client's screenshot card credits `displayName`, `author` and
  `homepage` at its foot.
- **Checking** (`world-repo.mjs check`, `checkLiveWorld`, through
  `GET /update/world`, cached 2 minutes): hourly in the client (`useWorldCheck`,
  mounted with the notice) and from Settings → Updates → World's Check again,
  only for the local owner. `ls-remote --tags` gives the newest version tag;
  it's new unless `play` is on it or has it (a world without history compares
  versions). Not downloaded: its size from GitHub's file lists of `play` and the
  release (display only, absent when GitHub can't say) and a link to its release
  page. Downloaded: its notes, the tag's message.
- **Downloading** (`POST /update/world`, `world-repo.mjs download`,
  `downloadLiveWorld`), once the player says so: `git fetch` of the release's
  tag only, with a minimum-speed limit, git's progress kept in memory and served
  with the check. A world from before clones is then moved onto the published
  commit its `.template/` matches (only `play` and the index move; never when it
  has commits of its own), and the snapshot and old update backups go.
- **Ready** (`availableUpdate` in `src/world/package.ts`, `downloadedRelease` in
  `src/world-update/git.ts`, on each request): `GET /kazusa/world` carries
  `world.update` (`{ commit, date, version, notes, url, systemAgent }`) while
  the highest local version tag isn't in `play`'s history. The client announces
  it once and Settings offers Ask <system agent>.
- **Updating** (`src/world-update/`, the system agent's `world_update`: `check`,
  `apply`, `conflicts`, `show`, `finish`; no undo). The release and the base
  (`play`'s commit; none for a world without history: a best attempt, which
  never removes anything) are read straight from git (`commitTree`, text in one
  `cat-file --batch`). `apply`, clock paused: keeps the world as it is in git's
  stash (`keepInStash`: a temporary index, every world file, stored with
  `git stash store`, no file touched), writes the page-by-page merge into the
  files (pictures with `git restore --source`, paths literal), moves `play` to
  the release with the index there (`standOn`), and writes
  `.state/kazusa/world-update/report.json` (conflicts, orphans, the commits from
  and to). `show` reads a file at either commit. `finish` checks the map,
  re-homes and deletes the report. The live `package.json` becomes the creator's
  as is (a world from before clones keeps its `kazusa.template`); renames come
  from it.
- **Repository** (`adoptWorldRepo`, before every Gateway start, from
  `scripts/dev.mjs` and `npm run gateway`; nothing fetched, no file touched):
  makes `world/` a repository for a world from before them (`git init`, no
  commit: its first update finds its base), sets the config every world
  repository has (§4.5), `.git/info/exclude` (only `package.json`, `shared/`,
  `workspaces/`) and `.git/info/attributes`, points `origin` at the world's
  `repository` or its source, and drops an older Kazusa's `upstream` remote and
  `refs/kazusa/*`.
- **Git** (`findGit`): `git/` beside the app, GitHub Desktop's portable build
  (`dugite-native`, pinned with its sha256 in `scripts/package.mjs`, Git
  Credential Manager and Git LFS stripped: they are most of it and nothing uses
  them), else the system's. On macOS without the developer tools, `/usr/bin/git`
  only offers to install them, so that counts as none. simple-git guards the
  environment: our variables (`GIT_EXEC_PATH`, `GIT_TEMPLATE_DIR`,
  `GIT_CONFIG_NOSYSTEM`, `GIT_INDEX_FILE`, author dates) are named in
  `allowEnvironment`, the shipped binary and exec path allowed through `unsafe`,
  and every inherited `GIT_*`, `EDITOR`, `PAGER` and the like dropped.

## 3. Bringing existing worlds along

Worlds made before `package.json` have a `world.json` (the template's, plus
`id`) or, older still, nothing saying where they came from.
`scripts/world-package.mjs` runs before every Gateway start, from
`scripts/dev.mjs` (installed copies start through it with `--packaged`) and from
`npm run gateway`, and is in the release package's file list. It:

1. Leaves a world alone whose `package.json` already has `kazusa.template`
   (removing a stale `world.json` beside it).
2. Otherwise finds the template: the `id` its `world.json` recorded, else the
   one template whose `kazusa.config.user.id` equals the world's player id in
   `openclaw.json`. The player's id is fixed when a world is made and each
   template has its own, so it identifies the template when nothing else does.
3. Writes the template's `package.json` with `kazusa.template`, and removes
   `world.json`. A world it can't place is left as it is: no credit, and
   `world_update` says it isn't a template world.

Keep this until no supported release can produce a world without `package.json`;
then delete the script and the legacy marker in setup.

## 4. Design: canon, play, checkpoints and saves

Agreed 2026-11-05, with repositories, saves and updates redesigned 2026-11-14
(§4.5–§4.7); not built (§4.10). It replaces the earlier roadmap (isomorphic-git,
commits on a timer). Designed from the people who use it first, then fitted with
git.

### 4.1 Who does what

- **Creators** make a world (a template), playtest it, keep building while they
  play, cut **checkpoints** (chapter starts: "Chapter 2") and publish versions.
- **Players** pick a world and a starting point (the beginning or a checkpoint),
  play, save and load privately, and take the creator's updates without losing
  their game.
- **ARONA** merges and explains, in both directions.

A creator is a player who may push `main`: one mechanism (branch, merge `main`,
save) serves both.

### 4.2 Three kinds of truth

A story world's canon has a time axis. Everything a world holds is one of:

| Kind               | True when                             | Example                                              |
| :----------------- | :------------------------------------ | :--------------------------------------------------- |
| **Timeless canon** | from the beginning, every playthrough | Airi's backstory; a place; a belief Airi always held |
| **Story canon**    | from a checkpoint onward              | at Chapter 2 Airi knows the festival was cancelled   |
| **Play**           | in one playthrough only               | Airi had cake on Tuesday                             |

The vocabulary already exists ([memory](memory.md) §3.4): an undated edit is a
retcon (always true), a dated `## History` line an event, a note's
`always known` source is seeded and timeless while `seen it` or `told by` with a
date happened at a time. Separation builds on these rules; don't invent another
marker.

Personal wiki pages and `MEMORY.md` are the heart of a world, not play to be
discarded: what Airi came to believe while the creator played can be canon, from
the checkpoint that captured it.

### 4.3 Published means text; SQLite never leaves the machine

Worlds and checkpoints, everything pushed, are text only. Long-term memory is
already text (`MEMORY.md`, the personal wiki, `days/`), and sleep turns the
day's records into it. So cutting a checkpoint first consolidates every
character (`memory_consolidate`), after which `.state/` holds only mechanics:

| In `.state/`                     | A text checkpoint instead                                                                                |
| :------------------------------- | :------------------------------------------------------------------------------------------------------- |
| Records (`:tasks`, chat ledgers) | Consolidated into day pages, `told by` notes, open threads and plans: the gist, not the wording.         |
| Chats and groups                 | Left out at first. Later, optional `chats/<id>.md` imported into the chat store at start.                |
| Clock, positions                 | `scene.json` in the checkpoint (`clock.startAt` exists); no position means home.                         |
| Current activities               | None: the idle check-in has everyone orient themselves, a new world's cold start.                        |
| Desires, familiarity             | Defaults; familiarity falls back to page dates ([memory](memory.md) §7.7). Exportable later, both small. |
| Memory search index              | Rebuilt from text (one embedding pass).                                                                  |
| Decisions, captures, usage, keys | Never part of a world.                                                                                   |

A checkpoint therefore starts like the next morning of a chapter. Why not ship
the databases: the live world's 51 characters hold 573 MB of SQLite; provider
keys live inside it (`secret_store_entries` keeps the value of a soft-deleted
key); most of it is machinery a player doesn't need; and it would tie every
player to the creator's OpenClaw schema.

Private saves (§4.6) do keep the databases: a player expects to resume
mid-conversation.

### 4.4 Separating canon from play

**A checkpoint promotes a moment.** Everything in every mind when the creator
cuts "Chapter 2" becomes story canon for anyone who starts there.

**Each change since the last publish is sorted into one of the three kinds.**
Defaults come from who wrote it and its form:

| Change                                                                                                                       | Default                                     |
| :--------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------ |
| Creator or ARONA, undated: leads, front matter, sections, `always known` notes, `SOUL.md`/`IDENTITY.md`, world pages, skills | Timeless → `main`                           |
| Creator or ARONA, dated: a note with a date, a `## History` line                                                             | Story → the checkpoint                      |
| Characters: sleep, `remember`, visit stubs, `days/`, `## Lately` and plans in `MEMORY.md`                                    | Play → only into a checkpoint, else private |

**Where the defaults come from**: the diff against the last published commit,
with each note's date and source and the form of each part (memory §3.4). A
journal of who wrote each part (our writers log; anything unlogged is the
creator's) can sharpen this later if the review needs it; it isn't built.

**Publish is a review**: ARONA lists the changes in the three kinds and the
creator moves any of them. Promoting to timeless has ARONA rewrite it as undated
or `always known`; promoting to story moves it into the checkpoint; the rest
stays private. Pages about the player (`user:...`) are flagged: in a checkpoint
they become a relationship the player inherits.

### 4.5 Repositories

Agreed 2026-11-14, replacing earlier versions of this section. The rule: a world
is a plain git clone, and git's own pieces do the work. Nothing of ours sits
beside them: no refs of our own, no snapshot, no cache, no lock or progress
files.

Two kinds of history that never mix: what is **published** (text, shared,
permanent, on the remote) and what is **played** (local, never pushed).

**Remote, one per world.** Only published commits, so its history never holds a
large file, play the creator kept private, or a secret: once pushed, history
can't be cleaned.

- `main` is timeless canon. **Releases are annotated version tags on `main`**
  (`v0.4.0`; the tag's message is the notes, and a GitHub release with the same
  notes is optional), with `version` in `main`'s `package.json`. Work pushed to
  `main` between releases reaches nobody.
- Each checkpoint is a branch, `checkpoint/<id>`, built on the line before it
  (chapter 1 on `main`, chapter 2 on chapter 1, an "if" scenario on its
  chapter). At each release the creator rebases the checkpoint stack onto the
  release commit and force-pushes it (§4.7), so a checkpoint's tip moves only at
  releases and every checkpoint contains its release, version included.
- **Story order is data, not history**: a list on `main` (`kazusa.checkpoints`
  in `package.json`, `[{ id, title, after }]`). A chapter inserted before
  published ones is a new branch plus an entry in the list.
- Located by npm's `repository` field; identity stays `name` (§1).

**Local, `world/`: a clone of the remote.**

- **Setup clones it**: `git clone --branch <newest release tag> <url> world`,
  then branch `play` at that commit. The files and the history arrive together
  or not at all (git removes a clone that fails). Picking another world before
  starting deletes the folder and clones that one. The world is set up once
  `openclaw.json` is written; `origin` says where it came from. No template
  cache (`worlds/`), no copying, no rooting step.
- **`play` points at the creator's commit the world stands on** (a release, or a
  checkpoint's tip). **The game is the uncommitted changes on top of it**: pages
  characters wrote, notes, new cards, the user's edits. Until saves exist (§4.6)
  nothing local is ever committed, so `play` only ever moves to the creator's
  commits, and **the base of the next update is simply `HEAD`**, correct even
  after the creator rebases a line.
- **What the clone tracks**: the creator's files only, `package.json`, `shared/`
  and `workspaces/`. `openclaw.json` (this machine's config, which the Gateway
  is reading) and `.state/` (the databases and runtime files) are local and
  ignored in `.git/info/exclude`: an update's stash must not take the config
  from under a running Gateway or stash hundreds of MB of SQLite, and
  `git status` stays fast. Saves still hold them: a save adds them to its own
  tree explicitly (§4.6). Publishing never can: it builds commits only from the
  exported parts (below), so nothing local reaches the creator's repository
  whatever git tracks here.
- **Repository config, set when it's cloned**: `core.autocrlf=false` (a CRLF
  page would differ from every base), `core.longpaths=true`,
  `fetch.fsckObjects=true`, no signing, a local identity.
- **Our git calls** go through one runner shared by the scripts and the plugin:
  the shipped git (`git/`, else the system's, §2), inherited `GIT_*` variables
  stripped, the repository pinned (`--git-dir`), `--literal-pathspecs` (a file
  called `happy[2].webp` is a name, not a pattern), and creator paths containing
  `..` refused.
- **Progress** (clone, fetch) is git's `--progress`, read by the process that
  runs it (the web server) and served from memory to the page polling it.
  Concurrency is git's own locking: a second writer fails with git's error
  rather than corrupting anything.
- **Disk**: a clone holds each picture twice (an object in `.git` and the file),
  about 2 GB for 1 GB of art. Later: sparse checkout with pictures served from
  git, and a shallow history back to the release the world stands on.

**Publishing** (creators, later), in this order:

1. **Update first**, as "Update my game" does (§4.7), so the creator's world
   stands on the published tip. The review then shows only what this playthrough
   adds, plus the parts where it and the published pages disagree; removing
   something published is a choice made there, never a side effect.
2. **Build fresh commits from the exported parts**, never a branch of the
   playthrough: timeless parts onto `main`'s tree, `git commit-tree -p <tip>`; a
   checkpoint's minds and `scene.json` as a whole new tree (a checkpoint is a
   snapshot of minds: its tree is replaced, not merged). Branching off the
   playthrough and deleting what isn't wanted would publish everything deleted,
   in history.
3. **Release**: bump `version`, tag `main` (annotated, with the notes), rebase
   the checkpoint stack onto it (`git rebase --update-refs main` from the
   deepest chapter; a tree of "if" branches needs a small script), push `main`,
   the tag and `checkpoint/*` (force), nothing else.
4. **The creator's world then stands on the published commit**: `play` moves
   there and their working changes stay, minus what was published. Nothing local
   reaches the remote.

```
remote main:          M1 ── M2 ── R5            R5: release 5 (tag v5)
checkpoint/chapter-1:              └ A1' ── A2'  rebased onto R5
checkpoint/chapter-2:                       └ B1'  rebased onto chapter 1
a player's world:     play = B1 + uncommitted changes
  after updating:     play = B1' + the same changes, merged page by page
```

**Sources**: which worlds a copy offers is a list of providers
(`apps/kazusa/world-sources.json`): `git` repositories now, OpenRP's catalog
later. The setup guide lists them by peeking at each one's `package.json`
(`list`, a shallow clone with no file contents) and clones only the one picked.
Kazusa's own worlds live in `f1yingbanana/kazusa-<name>` on GitHub.

**Git itself**: the real `git` binary (shipped in the installers; macOS needs
the developer tools). Without git, a world can't be set up or updated.

### 4.6 Saves and loading (later)

Not built, and nothing below is written yet: there are no saves, so updates
merge into the working changes with no undo (§4.7). When saves come, they fit
the clone model without changing it.

- **A save is a commit off to the side** on its own ref (`refs/saves/<name>`,
  `refs/saves/auto-<n>`): its **parent is `HEAD`**, the creator's commit the
  world stands on, and its tree is the whole local state: the world as it is
  (every tracked and untracked world file), `openclaw.json`, and the databases
  (`.state/**/*.sqlite`, minus caches and temporary ones), the last two added
  with `git add --force` since the clone ignores them. Built with a temporary
  index (`GIT_INDEX_FILE`), so `play`, the real index and the files are
  untouched. `play` itself never gets a local commit, so the base of an update
  stays `HEAD`.
- **Only with the Gateway stopped**, run by the process that owns it
  (`scripts/dev.mjs`; the cloud host later), never on a timer or per turn. The
  plugin pauses the clock, waits for every brain to be idle and stages a
  request; the owner stops the Gateway (it drains), runs the operation and
  starts it again (about 13 s), like Settings → Updates and
  `.update/pending.json`. Never copy a database from outside a running Gateway:
  its own checkpoints write the main file while the copy reads it.
- **Before committing**: the Gateway exited cleanly; a leftover `-wal` is
  checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)` through `node:sqlite`).
  `-wal`, `-shm` and lock files are never saved.
- **Load**: autosave first, then check out the save's tree into the world (files
  and databases, every `-wal` and `-shm` deleted: an old log over a different
  database corrupts it), move `play` to the save's parent with the index at that
  commit (so the save's differences are working changes again), carry the
  current provider keys over, and start with the clock paused.
- **Saves stay on their version.** A save made before an update sits on the old
  release; loading it puts the world back there, and the update is offered
  again. Saves are never rebased: there's nothing to rebase.
- **Updating with saves**: an autosave first. "Undo the update" is then "load
  that autosave", databases included (positions, chats), so undo comes with
  saves and needs nothing of its own.
- **Deleting a save** deletes its ref and runs `git gc --prune=now`: database
  versions no other save holds are freed. Autosaves are a ring (the last few
  kept). **When**: an autosave on every clean stop, and "Save now".
- **Several playthroughs** (a chapter started fresh beside a game in progress):
  saves are named per playthrough (`refs/saves/<playthrough>/<name>`); switching
  autosaves the current one and loads the other's latest.
- **Storage**: git stores each distinct database once and each changed one as a
  full compressed copy (`.gitattributes`: `*.sqlite binary -delta`; git finds no
  delta between SQLite versions, and repacking them is slow for nothing). Agent
  and shared databases gzip about 4:1; a save of a world with every database
  changed (51 characters, 573 MB of SQLite) is about 150 MB.
- **Never saved**: `.env*`, `*.key`, `logs/`, `cache/`, `tmp/`, `media/`,
  `worktree-projections/`, `kazusa/system-agent.json` (rebuilt each start).
- **Provider keys** are one row of the shared database (`config_machine_state`,
  `authProfiles.store` in `state/openclaw.sqlite`). Load reads that row before
  and writes it back after; a save keeps them, and nothing with a save in it is
  ever pushed.

### 4.7 Updates and chapters

Agreed 2026-11-14.

- **A playthrough follows one line**: `main` for a game started at the
  beginning, `checkpoint/<id>` for one started there. Its version is the release
  `HEAD` is on (`git describe --tags`).
- **Checking**: `git ls-remote --tags --heads origin`, hourly in the client and
  from Check again, only for whoever may change this machine (the local owner,
  who alone gets the check, the notice and the buttons). New when the followed
  line has moved past `HEAD`: for `main`, a version tag newer than `HEAD`'s; for
  a checkpoint, its tip (it moves only at releases), labelled with the newest
  release. The client shows "Kivotos 0.5.0 is out · 1.1 GB · Release notes ↗";
  the link is built from `origin`'s URL and the tag. Git can't tell a release's
  size without downloading it, so **the size is the one piece from GitHub's
  API**: the file lists of `HEAD` and the release
  (`git/trees/<sha>?recursive=1`, two calls), summing the files the release has
  that `HEAD` lacks. Display only: rate-limited or off GitHub, it's simply not
  shown.
- **Downloading**, once the player says so:
  `git fetch --progress origin tag v0.5.0` (or the checkpoint's branch), nothing
  else, with a minimum-speed limit so a stalled fetch fails. **The progress
  bar** is git's own `--progress` (receiving, then resolving), read by the web
  server that runs the fetch and served from memory to the page; setup's clone
  shows the same bar. Git counts objects, not bytes, so the bar moves unevenly
  when pictures vary in size. "Ready" is a newer local tag (or tip) than
  `HEAD`'s; its notes are the tag's message, already local.
- **Updating** (`world_update`, the system agent, clock paused) is
  `git pull --rebase --autostash` in effect, with our page merge doing the
  "pop":
  1. Keep the game in git's stash (a temporary index of every world file, stored
     with `git stash store`; no file touched). That's the recovery point
     (`git stash list`); no undo is offered.
  2. Merge **page by page** (`merge.ts`: each frontmatter key, the lead, each
     `##` section; `## Notes` and `## History` union; a character's own fields
     win on her pages), base = `HEAD`, theirs = the release, ours = the files,
     and write the result: pages, the release's pictures (`git restore`),
     deletions. Both sides changed a part differently: this world's version
     stays and it's reported. A card for a place gone everywhere is dropped if
     it holds nothing the character wrote, otherwise orphaned.
  3. Move `play` to the release with the index there: what differs from it is
     the game again.
  4. The system agent resolves conflicts and orphans in the world's files
     (`show` reads either version of a file), then `finish`: the map must load,
     and stranded characters are re-homed. No commits. A crash at any step
     leaves the stash, so nothing is lost.
- **The base is `HEAD`**, so a creator rebasing a checkpoint stack doesn't
  matter: the old `HEAD` is exactly the commit the files were built on, and it's
  in the world's own repository even after the remote drops it.
- **Merge, not rebase, of the player's side**: the player has no commits, so
  there's nothing to rebase and no merge commit; the number of checkpoints
  doesn't matter, since a player follows one line. When saves exist they stay on
  their release and are never rebased (§4.6).
- **A release that changes no world file** (only the checkpoint list, say) moves
  `HEAD` with nothing to merge.
- **Best attempt**, for a world with no known base: the merge guesses play's
  marks (visit stamps, notes, history, sleep's sections, the layout) and **never
  removes anything**: pages the release lacks are kept and listed. The stash
  holds the whole game first.
- **Migrating existing worlds** happens at their first update, best effort,
  nothing at start: once the release is fetched, the base is the published
  commit the world's `.template/` matches, else `HEAD` if it's a creator's
  commit, else none (a best attempt). `.template/` and old update backups are
  deleted afterwards. A world without a repository gets one (`git init`,
  `origin` from its `repository` or its source) when it first checks.
- **Later or sibling checkpoints** are never merged into a game in progress
  (another week); they're offered as "start it fresh", a new playthrough from
  the checkpoint (§4.6), the current one kept.
- **Story beats** (later): story items the creator marks reach games in progress
  as dated `told by` notes, `· news` History lines or plans, and characters take
  them as news.

### 4.8 Roadmap

1. **Worlds as clones, updates over git** (§4.5, §4.7): setup clones; check,
   download and update as above; migration at first update.
2. **Saves and loading, locally** (§4.6): the Gateway-only restart on request,
   saves on their own refs, autosave on stop and before updates, Settings →
   Saves, load.
3. **Publish and checkpoints** (§4.3–§4.5): the review, releasing (version, tag,
   rebasing the stack), consolidation and `scene.json`, "Start Chapter N".
4. **The cloud**: the host owns the Gateway and runs the same module and
   requests; remotes on the platform.
5. **Story beats, seeded chats.**

### 4.9 Open

- Story beats in the first chapters release, or fresh starts only.

### 4.10 Status

Built 2026-11-14 (PR #70) for `main` only: setup clones, checking, downloading
with git's progress, the update (stash, merge, move `play`), migration of worlds
from before clones at their first download, and the release notes link (§2). One
difference from §4.7's wording: an update doesn't check out the release; it
writes the merge into the files and moves `play` and the index to the release,
which leaves the same result without rewriting every file.

**Later**: checkpoint branches and a playthrough's followed line, "start it
fresh", saves (§4.6, which bring undo), publishing, the disk savings, and worlds
off GitHub (no size shown).

## 5. Known edges

- A `package.json` makes npm treat `world/` as its own project root: `npx`
  inside it doesn't find the repo's binaries. Call
  `../../../node_modules/.bin/openclaw` from `world/`.
- `kazusa.config` applies once, at setup; to change a running world's settings,
  edit `openclaw.json` (or ask the system admin), not `package.json`.
- Setup needs the internet: listing peeks at each world's repository, and the
  one picked is downloaded (Kivotos is about 75 MB, mostly stickers).
- An update replaces the live `package.json` with the template's: a fork's own
  `name`, `author` or `version` would be overwritten. Fine while worlds don't
  fork; §4.5 resolves it (a fork merges, it isn't replaced).
