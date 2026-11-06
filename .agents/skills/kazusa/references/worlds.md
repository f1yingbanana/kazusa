# World Packages and Versioning

Status (2026-11-05): §1–§3 built (`WorldPackageSchema` in `@kazusa/client`,
`src/world/package.ts`, `src/world-update/`, `apps/web/lib/setup/`,
`scripts/world-package.mjs`); §4 is the agreed design, not built. Read this
before changing a world's `package.json`, how a world is set up or updated, or
anything about versions, forks, history or saves.

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
| `kazusa.template`     | Live worlds only: the template folder (`worlds/<id>`) the world is a copy of.                           |

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

- **Setup** (`apps/web/lib/setup/setup.ts`): lists templates by their
  `package.json`; copies `shared/` and `workspaces/`, writes the template
  snapshot (`world/.template/`), and writes the live `package.json` last, as the
  template's plus `kazusa.template`. That file is the "a world was imported"
  marker (a legacy `world.json` counts too, so an old world is never copied
  over). `writeConfig` merges `kazusa.config` into `openclaw.json`.
- **Credit** (`src/world/package.ts`, `GET /kazusa/world` →
  `WorldMeta.package`): read on each request, so editing the file needs no
  restart. The client's screenshot card credits `displayName`, `author` and
  `homepage` at its foot.
- **Update** (`src/world-update/`, the system agent's `world_update`): finds the
  template by `kazusa.template`, carries `kazusa.renames`, and replaces the live
  `package.json` with the template's (keeping `kazusa.template`), so the live
  `version` becomes the release it took. `apply` backs it up with `shared/`,
  `workspaces/` and the base; `undo` restores it.

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

Agreed 2026-11-05; not built. It replaces the earlier roadmap (isomorphic-git,
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

Two kinds of history that never mix: what is **published** (text, shared,
permanent, on the remote) and what is **played** (local: text commits, and saves
with their databases).

**Remote, one per world.** Only published commits, so its history never holds a
large file, play the creator kept private, or a secret: once pushed, history
can't be cleaned.

- `main` is timeless canon. Tags `v<version>` are releases, made by Publish.
- Each checkpoint is **its own line of versions**, `checkpoint/<id>`: a
  republished chapter is the next commit on its line, whose first parent is the
  chapter's previous version and second parent `main`'s tip when it was made
  (the canon it was built on).
- **Story order is data, not history**: a list on `main` (`kazusa.checkpoints`
  in `package.json`, `[{ id, title }]` in story order). A chapter inserted
  before published ones is a new line plus an entry in the list. Never encode
  story order in parents: an earlier chapter could then never be added.
- Located by npm's `repository` field; identity stays `name` (§1).

**Publishing**, in this order:

1. **Fetch and merge the published tip into the playthrough first**, as "Update
   my game" does (§4.7). A playthrough loaded from a save older than the last
   publish would otherwise look like it deletes everything published since. The
   review then shows only what this playthrough adds, plus the parts where it
   and the published pages disagree; removing something published is a choice
   made there, never a side effect.
2. **Build fresh commits from the exported parts**, never a branch of the
   playthrough: timeless parts onto `main`'s tree, `git commit-tree -p <tip>`; a
   checkpoint's minds and `scene.json` as a whole new tree (a checkpoint is a
   snapshot of minds: its tree is replaced, not merged) with
   `-p <chapter's previous version> -p <main's tip>`. Branching off the
   playthrough and deleting what isn't wanted would publish everything deleted,
   in history.
3. **Append only**: published lines only ever grow at their tips, in publish
   order. Push them (`main`, tags, `checkpoint/*`), nothing else.
4. **Link the playthrough**: a local merge commit whose tree is the
   playthrough's own and whose second parent is the published commit
   (`git merge -s ours`). It tells git the playthrough already contains what it
   published, so the next update or publish diffs against it, not against the
   release the playthrough forked from. Links only point that way: nothing local
   reaches the remote.
5. After a timeless publish, `main` is merged into every checkpoint with the
   part-wise page merge, so starting a chapter always gets the latest canon and
   conflicts reach the creator, not each player.

```
remote main:            v1 ─ C1 ─ C2 ─ C3         C3 lists chapter-1-5
checkpoint/chapter-2:        K1 ─────── K2        K2 republished from an older save
checkpoint/chapter-1-5:                 L1        placed by the list, not by parents
playthrough (local):    v1 ─ p1 … p5 ─ M1 ─ p6 … ─ M2      M = link merge
                                       └ C1          └ C2
```

**The mock remote**, until the platform hosts worlds: one bare repository per
template, `apps/kazusa/.remotes/<name>.git`, built from this repository's own
first-parent history of `apps/kazusa/worlds/<id>`: one commit per commit that
changed the folder (its tree is the folder's tree, with fixed author and the
source commit's date and subject), tagged `v<version>` at the last commit of
each version. Built from the same history everywhere, every tester's world gets
the same commit ids, and pushing these repositories to the platform later keeps
them.

**Local, `world/`**: its own repository, with the remote as `upstream`. A
**playthrough** is a local branch (`play`) whose history starts at the published
commit the world was made from, then text commits: `package.json`,
`openclaw.json`, `shared/`, `workspaces/` (stickers included: canon, rarely
changed). Everything else is excluded in `.git/info/exclude`, so nothing about
the clone is part of a world. Playthroughs are never pushed.

**Git itself**: simple-git over the real `git` binary. Cloud hosts run on real
disks; the Windows installer ships MinGit; macOS needs the developer tools.
Without git, a world plays as before, untracked, and says so at start.

### 4.6 Saves and loading (private)

- **Only with the Gateway stopped**, run by the process that owns it
  (`scripts/dev.mjs`; the cloud host later), never on a timer and never per
  turn. The plugin pauses the clock, waits for every brain to be idle and stages
  a request; the owner stops the Gateway (it drains), runs the operation, writes
  the result and starts it again (about 13 s), like Settings → Updates and
  `.update/pending.json`. All git and save code lives in one module taking a
  world folder (`scripts/world-repo.mjs`), so the cloud host calls the same
  code. Never copy or checkpoint a database from outside a running Gateway: its
  own checkpoints write the main file while the copy reads it, and the copy is
  torn.
- **A save is a commit off to the side** on its own ref (`refs/saves/<name>`,
  `refs/saves/auto-<n>`): its parent is the playthrough's text commit at that
  moment, its tree that text plus the databases (`.state/**/*.sqlite`, minus the
  caches and temporary ones). The playthrough line itself stays text only.
- **Deleting a save** deletes its ref and runs `git gc --prune=now`: database
  versions no other save holds are freed, text history untouched. Autosaves are
  a ring (the last few kept).
- **Storage**: git stores each distinct database once (an unchanged database is
  free in every save) and each changed one as a full copy, compressed. Keep
  compression on: agent and shared databases gzip about 4:1 (20 → 5 MB, 65 → 18
  MB), the memory index 2:1. `.gitattributes` marks `*.sqlite binary -delta`:
  git finds no delta between SQLite versions (measured: a 100 KB change cost
  about 100 MB, and repacking took 23 s for almost nothing). With every database
  changed, a save of the live world (51 characters, 573 MB of SQLite) is about
  150 MB. Copy-on-write clones beside git would cost only the changed blocks on
  APFS, XFS and btrfs but a full uncompressed copy on NTFS, and need their own
  store; if cloud storage ever demands them, it is a change inside the module,
  since saves are private.
- **Before committing**: the Gateway exited cleanly; a leftover `-wal` is
  checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)` through `node:sqlite`), safe
  with nothing else open. `-wal`, `-shm` and lock files are never committed.
- **Never saved**: `.env*`, `*.key`, `logs/`, `cache/`, `tmp/`, `media/`,
  `worktree-projections/`, update backups, `kazusa/system-agent.json` (rebuilt
  each start).
- **When**: an autosave on every clean stop (the Gateway is off anyway), and
  "Save now".
- **Load**: autosave, check out the save's tree, delete every `-wal` and `-shm`
  (an old log over a different database corrupts it), carry the current provider
  keys over, start with the clock paused. The playthrough then goes on from the
  save's **text parent**, never from the save commit: otherwise its databases
  join the playthrough's history and can never be freed.
- **Provider keys** are one row of the shared database: `config_machine_state`,
  `authProfiles.store` (usage in `authProfiles.state`) in
  `state/openclaw.sqlite` (`auth.sharedStore` says `state-db`; the per-agent
  `auth_profile_store` tables are empty). Load reads that row before and writes
  it back after. The full list of credential tables is OpenClaw's own
  (`STATE_SECRET_TABLE_NAMES`, `AGENT_SECRET_TABLE_NAMES`, used by
  `openclaw backup git --exclude-secrets`); a save keeps them, and nothing with
  a save in it is ever pushed.
- **OpenClaw's own backups** (`openclaw backup git`, `backup sqlite`) dump,
  vacuum and verify every database on each run: built for daily disaster
  recovery, too slow for saves.

### 4.7 Updates and chapters

- **Versions** are raised by Publish, never by a commit: a version is a release
  (a tag), and a world holds many commits between two.
- **Update my game**: the Gateway stops, an autosave, a fetch, then `main`
  merges into the playthrough with the part-wise merge, git's merge base
  replacing `world/.template/` and the save replacing the update backups. Steps
  that need the Gateway (map check, re-homing) run after it starts. Players get
  timeless canon: new characters, places, lore, retcons.
- **Start a chapter fresh**: a new playthrough from the checkpoint, the current
  one kept. A checkpoint is never merged into a game in progress: that game
  lived a different week.
- **Story beats** (later): story items the creator marks reach games in progress
  as dated `told by` notes, `· news` History lines or plans, and characters take
  them as news. They can contradict what a player's game did; the update screen
  says so.

### 4.8 Roadmap

1. **Set worlds up right while testers are few** (one PR): git shipped in the
   Windows installer, simple-git, the world-repository module, the mock remote,
   every world adopted before its Gateway starts (history rooted at the
   published commit whose text matches its `.template/`, else a root commit of
   `.template/`; a new world goes the same way, since setup writes
   `.template/`), the excludes, and a text commit before every start and after
   every clean stop. Rooting history at the right release is what can't be fixed
   later.
2. **Saves and loading, locally** (§4.6): the Gateway-only restart on request,
   saves on their own refs, autosave on stop, Settings → Saves, load.
3. **Updates over git** (§4.7): retires `.template/`, the backups and
   `bestAttempt`.
4. **Publish and checkpoints** (§4.3–§4.5): the review, versioning, building and
   pushing commits, consolidation and `scene.json`, "Start Chapter N".
5. **The cloud**: the host owns the Gateway and runs the same module and
   requests; remotes on the platform.
6. **Story beats, seeded chats.**

### 4.9 Open

- Story beats in the first chapters release, or fresh starts only.

## 5. Known edges

- A `package.json` makes npm treat `world/` as its own project root: `npx`
  inside it doesn't find the repo's binaries. Call
  `../../../node_modules/.bin/openclaw` from `world/`.
- `kazusa.config` applies once, at setup; to change a running world's settings,
  edit `openclaw.json` (or ask the system admin), not `package.json`.
- An update replaces the live `package.json` with the template's: a fork's own
  `name`, `author` or `version` would be overwritten. Fine while worlds don't
  fork; §4.5 resolves it (a fork merges, it isn't replaced).
