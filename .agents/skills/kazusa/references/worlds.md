# World Packages and Versioning

Status (2026-11-05): §1–§3 built (`WorldPackageSchema` in `@kazusa/client`,
`src/world/package.ts`, `src/world-update/`, `apps/web/lib/setup/`,
`scripts/world-package.mjs`); §4 is the plan, not built. Read this before
changing a world's `package.json`, how a world is set up or updated, or anything
about versions, forks, history or saves.

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
  copy to its template by folder; once templates are repos (§4.3) the link is
  npm's `repository` field and `name`.
- **Raise `version` with every template release**, or copies can't tell they are
  behind (§4.1). Patch for fixes to pages, minor for new characters or places,
  major when a copy needs the system admin's help to take it (renames,
  removals).
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

## 4. Roadmap

In priority order. Each is worth having on its own, and each makes the next
possible.

### 4.1 Update notices (next; no git)

Compare the live `version` with its template's (semver). When the template is
newer, say so where the player looks (a status-bar item, the system admin's
welcome back) and point at the system admin, who runs `world_update`. Needs:
templates raising `version` (§1), and a read of both files, on the plugin side
so the client gets it from `/kazusa/world`.

### 4.2 History inside each world (git, local)

`world/` is git-ignored by the Kazusa repo, so it can be its own repository.
`git init` at setup, a commit of the imported template, and commits before and
after each `world_update` (replacing `.state/kazusa/world-update/backups/` and
giving a real undo). Track authored text only: `package.json`, `shared/`,
`workspaces/`, `openclaw.json`; ignore `.state/` (and `.template/`, until §4.3
replaces it). Installed copies can't assume git is installed: use a pure-JS
implementation (isomorphic-git) rather than shelling out.

### 4.3 Templates as repositories (git, upstream)

Each template its own repository, named by its `name`, located by npm's
`repository` field. Setup clones it into `world/` with the template as the
`upstream` remote; `world_update` fetches and merges. Git's merge base replaces
the `world/.template/` snapshot; Kazusa's part-wise page merge (each frontmatter
key, lead and section) stays, as a git merge driver for `*.md`
(`.gitattributes`), since line merges are wrong for pages. Templates leave the
Kazusa repo (fetched on demand, not submodules), which also makes a community
world just a URL. A fork is a clone with a new `name` and `author`.

### 4.4 Save and load (last, hardest)

Authored text versions well; the simulation doesn't. Clock, stores, sessions and
memory indexes are SQLite databases under `.state/`, written continuously while
the Gateway runs. Committing them churns large binaries, and checking out under
a running Gateway corrupts them. A save therefore needs: the clock paused,
brains idle, a database snapshot (SQLite's backup API, or an instant
copy-on-write clone on APFS/ReFS), stored outside git or in LFS, and a commit or
tag that names it. Loading restores both and restarts the Gateway (about 13 s),
so it is quick but never instant. Design this only after §4.2, with the
Gateway's stop and drain behaviour measured.

## 5. Known edges

- A `package.json` makes npm treat `world/` as its own project root: `npx`
  inside it doesn't find the repo's binaries. Call
  `../../../node_modules/.bin/openclaw` from `world/`.
- `kazusa.config` applies once, at setup; to change a running world's settings,
  edit `openclaw.json` (or ask the system admin), not `package.json`.
- An update replaces the live `package.json` with the template's: a fork's own
  `name`, `author` or `version` would be overwritten. Fine while worlds don't
  fork; §4.3 resolves it (a fork merges, it isn't replaced).
