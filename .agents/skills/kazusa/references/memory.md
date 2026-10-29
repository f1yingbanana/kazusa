# Memory, Knowledge & Sleep

Status (2026-10-29): design, not implemented. Supersedes `memory-and-sleep.md`.
Designed in the order set by the kazusa skill §0: simulation, then player, then
prompt. §4–§6 are written for the people who use it (content creator, ARONA, the
character); §7 is the engine.

Goal: a character knows what someone in their position would know, recognizes
people and places without being asked, can try to remember or look something up,
holds beliefs that may be wrong and says where they came from, and sorts the day
out in their sleep. The world's author edits Markdown and nothing else.

## 0. Principles applied

- **One memory: the wiki.** A character's memory is their personal wiki plus
  `MEMORY.md`. Days are wiki pages too. There is no second memory system
  (memory-core, `memory/` diaries, vector store as truth).
- **Markdown is the only source of truth.** The search index is a cache in
  `.state/`, rebuilt from file hashes. Deleting it is always safe.
- **Knowledge is graded, not binary.** What a character knows about a world page
  is a _depth_ (none, heard of, familiar, intimate) derived in code from who
  they are and how well known the thing is. Exclusive lore is the extreme end,
  not the model.
- **Personal wikis hold only experience and divergence.** Common knowledge is
  derived, never copied into 150 workspaces.
- **Prose is never a fact.** Characters never write the world wiki. World
  changes come from the author, ARONA, or (later) tools.
- **Code vs. judgment.** Code owns depth, retrieval, contact, dates, sources,
  file writes and caps. The character owns impressions, opinions, certainty,
  synthesis and what to write down.
- **Sim time everywhere.** Every note carries a sim date. Nothing is scheduled
  on the wall clock.
- **Words, not numbers.** Certainty and relations are words, like desires.

## 1. Simulation: how a person knows and remembers

| What a real person does                                                          | Kazusa                                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Knows their own club and dorm inside out, their school well, rivals by name only | **Depth** from anchors (club, home, school) and the page's renown (§3.3).                                                         |
| Recognizes a face or a place instantly, with feelings attached                   | **Prefetch**: retrieval before every brain turn, no tool call (§7.2).                                                             |
| Sees what is actually there, and notices when it changed                         | **Contact**: the world page of what they stand in or face, and its dated changes since they last saw it (§7.3).                   |
| Has something on the tip of the tongue                                           | `recall`.                                                                                                                         |
| Checks the school portal, asks around online                                     | `look_up`: public world pages only.                                                                                               |
| Believes gossip, misreads people, holds theories                                 | Notes with a source (`told by natsu-yutori`) and a certainty word. Canon never corrects them silently.                            |
| Guesses what others think of them, and is often wrong                            | **What they think of me** on every people page: a guess with a certainty word, never a mirror of their own view (§3.5).           |
| Writes down only what would hurt to forget                                       | `remember`, rarely, in the moment.                                                                                                |
| Sleeps on it: keeps the gist, revises opinions, dreams                           | **Sleep consolidation**: one offline pass per real sleep that rewrites views, adds notes, writes the day page and a dream (§7.5). |
| Forgets details, keeps a general sense                                           | Notes per page are capped; sleep folds the oldest into the page's current view.                                                   |
| Woken at 3 am, sleeps badly                                                      | A wake cancels the pass; nothing is applied until the next sleep.                                                                 |

Naps shorter than `memory.sleep.minMinutes` (default 180) don't consolidate.

## 2. Player: what is fun, and where it surfaces

- **Callbacks.** A character brings up something Sensei said days ago: the
  `user:sensei` page is a seed in every direct chat with the player.
- **Opinions that drift.** After a fight, Kazusa's view of Yoshimi changes; the
  client shows each character's page on a peer with a per-sleep diff.
- **Gossip with provenance.** "Natsu told me the patisserie is closing (I think
  so)" next to the world page that says otherwise: dramatic irony.
- **Misreadings.** Kazusa thinks Yoshimi finds her cold; Yoshimi's page says she
  admires her. The client shows both pages and both guesses side by side, so the
  player sees misunderstandings coming before the characters do.
- **Discovery.** Walking into Angel 24 after the fire: "The shutters are down.
  It was open when you were last here."
- **The diary.** Day pages are the character's own gist of the day, the most
  readable thing we produce. A Diary tab per character.
- **The morning after.** A dream row on the timeline, a calmer tone, a decision
  reconsidered.
- **Never fun.** "According to my notes…". The conventions skill forbids citing
  notes as notes.

## 3. The model

### 3.1 Files

```text
shared/wiki/                          WORLD WIKI (canon; author and ARONA write)
├── concepts/<id>.md                  lore, institutions, communities (schools, clubs)
├── entities/places/<id>.md           the map (Location)
└── entities/characters/<id>.md       roster: home, school, club, knows

workspaces/<agent_id>/                PERSONAL (the character's mind)
├── SOUL.md | IDENTITY.md             voice and bio (unchanged)
├── MEMORY.md                         always loaded: who I am lately, goals, plans
└── wiki/
    ├── entities/characters/<id>.md   people (same id as the world card)
    ├── entities/places/<id>.md       places (same id as the world place)
    ├── concepts/<id>.md              views on world concepts, or their own
    └── days/<YYYY-MM-DD>.md          one per sim day, written in sleep

.state/kazusa/memory-index.sqlite     derived index (cache, rebuildable)
```

A page's id is its filename. A personal page with the same id as a world page is
the character's view of that thing; one with no world counterpart is the
character's own concept ("Natsu's romance theory"). Removed: `memory/` (diaries
become `days/`), `memory/relationships/` (moves to `entities/characters/`),
`reports/`, `syntheses/`, and the YAML `claims:` schema.

### 3.2 Page anatomy

Every page, world or personal, is read in **layers**, which double as levels of
detail in the prompt:

| Layer | Where in the file                             | Shown at depth |
| ----- | --------------------------------------------- | -------------- |
| L0    | `summary` in front matter (else 1st sentence) | heard of       |
| L1    | the lead: text between the H1 and first `##`  | familiar       |
| L2    | `##` sections                                 | intimate       |

**World page:**

```markdown
---
summary: Gehenna's student disciplinary body; feared and overworked.
aliases: [Prefects, the Prefect Team]
community: gehenna_academy # whose thing this is (a concept id)
renown: known # how far its name travels: private | local | known | famous
---

# Prefect Team

Everyone in Gehenna knows them: armbands, patrols, Hina at the head… (L1)

## Inner workings

Shift rotations, the budget fights with Pandemonium Society… (L2)

## Ako's ledger

Known by: hina-sorasaki, ako-amau

Only these two know it exists…

## History

- 2026-10-24 — Hina suspends all patrols after the riot.
- 2026-10-25 · news — The suspension is announced on the school portal.
```

- `Known by:` as the first line of a section restricts that section to the
  listed characters, whatever their depth. In front matter, `known_by` does the
  same for the whole page.
- `## History` holds dated in-world events (§3.4). Undated edits anywhere else
  are retcons.
- Community pages are concepts with a `community` too: a club names its school,
  a school names the world root. Places inherit `community` from their `parent`
  chain, so only a campus root needs it.
- World character cards: `home`, `school`, `club` (names or ids, resolved
  through aliases), optional `knows: { black_market: familiar }`. Their lead is
  what anyone who sees them notices.

**Personal page:**

```markdown
---
summary: Open all night; the side gate from the dorm is fastest.
learned: been there # how they first knew it: been there | told by <id> | read it | always known
seen: 2026-10-24 # last sim date of contact (code-owned)
---

# Angel 24

My go-to for strawberry milk after club. Lately I'm not sure it'll last.

## Notes

- 2026-10-24 · seen it · sure — Shutters down, "closed for repairs" on the door.
- 2026-10-22 · told by natsu-yutori · suspect — They might drop strawberry milk.
- 2026-10-20 · seen it · sure — Open all night.
```

- **Notes** are one line each: `date · source · certainty — text`.
  - Sources: `seen it`, `told by <id>`, `overheard <id>`, `read it`, `my guess`,
    `always known` (seeded).
  - Certainty: `sure`, `think so`, `suspect`, `doubt it`.
  - Newest first. Old notes stay: they are the history of the character's
    thinking. A malformed line stays as plain text with a lint warning.
- **People pages** add `relation` (words: "close friend", "clubmate", "rival"),
  an `## Open threads` list (promises, unfinished business) and
  `## What they think of me` (§3.5). No `familiarity`/`affinity`/`trust`
  numbers.
- **Day pages** (`days/<date>.md`): `summary` (one line), `touched: [ids]`
  (people, places and concepts of the day, which become graph edges), the gist
  as the lead, optional `## Dream`.
- **`MEMORY.md`**: `## Lately` (who I am these days), `## Goals`, `## Plans`
  (promises with dates). No machine state (location, hunger).

### 3.3 Knowledge depth

`depth(character, worldPage)` is one of `none < heard of < familiar < intimate`,
computed in code as the **highest** of:

1. **Anchors** from the character's world card. A page is under an anchor if the
   anchor is the page itself or appears on its `parent`/`community` chain.

   | Anchor                             | Depth    |
   | ---------------------------------- | -------- |
   | `club`                             | intimate |
   | home area (the `parent` of `home`) | intimate |
   | `school`                           | familiar |
   | `knows: { <page id>: <depth> }`    | as given |

2. **Renown** for everyone else: `private` and `local` give none, `known` gives
   heard of, `famous` gives familiar. Defaults: places `local`, characters
   `local`, concepts `known`.
3. **`known_by`** (page) gives intimate.
4. **Experience**: having a personal page with that id gives at least familiar
   (they've been there or met them).

`private` pages ignore anchors and renown: only `known_by`, residents (`home`)
and experience reach them. Use it for dorm rooms and hideouts.

Depth gates what is eligible for prefetch, `recall` and `look_up`, and the
deepest layer shown. Contact (§7.3) is separate: standing in a place shows it
whatever the depth.

### 3.4 Retcon vs. in-world event

- **Undated edit** (anywhere but `## History`): a retcon. It was always true,
  and everyone with the depth to know it always knew it. No discrepancy is
  shown. Characters' existing notes that contradict it stay unless edited.
- **Dated `## History` line**: an event at that sim date. Known only through
  contact (they see it), hearsay (someone tells them) or `· news` (everyone at
  depth heard of or above learns it on that date).

### 3.5 What they think of me (second-order beliefs)

Kazusa's page on Yoshimi holds two different things: what Kazusa thinks of
Yoshimi (the lead) and what Kazusa _guesses_ Yoshimi thinks of her. The guess is
its own section, with a certainty word:

```markdown
## What they think of me

Probably finds me cold and a bit scary; laughs it off around the others. (think
so)
```

- **Asymmetric by construction.** Each side's guess lives only in their own
  wiki, and no code path ever shows one character another's wiki. Kazusa can
  like Yoshimi and believe Yoshimi resents her. Both can be wrong.
- **Never a mirror.** The guess is built from evidence (what the other person
  said and did, how they reacted, what others said about them), not from the
  character's own feelings. Without this, models default to assuming mutual
  warmth, and every character ends up polite and alike.
- **Who writes it**: seeding (ARONA, deliberately not mirroring the lead), sleep
  (revised from the day's evidence), and the author. `remember` can add a note
  about it in the moment ("she flinched when I raised my voice").
- **Where it shows**: one clause after the person's line in **On your mind**
  ("…you think she finds you cold"). The `context-conventions` and `in-person`
  skills say, in about 40 tokens: how someone treats you follows from what
  _they_ think of you, which you can only guess; don't assume it matches how you
  feel; read their intentions from what they say and do, act on your guess, and
  change it when they surprise you.

## 4. Content creator: doing things

Everything is a Markdown edit. Changes are live within about a second (the file
watcher reindexes changed chunks only). World data is gitignored in this repo:
keep your world in its own folder or repository for history.

**Create a new world**

1. Community pages in `concepts/`: the world root, then schools
   (`community: <root>`), then clubs (`community: <school>`).
2. The map in `entities/places/` (see `location.md` §4.1). Set `community` on
   each campus root; rooms inherit it. Mark homes `renown: private`.
3. Character cards in `entities/characters/`: `home`, `school`, `club`, and a
   lead describing what people see.
4. Lore in `concepts/`: `summary`, `community`, `renown`. Put what outsiders
   would know in the lead and insider detail in `##` sections.
5. Check lint (Gateway log, client Wiki panel, or ask ARONA).
6. Ask ARONA to seed each character (§5).

**Add a concept, place or person mid-run.** Drop the file in. It reaches
characters at their depth immediately, as if it always existed.

**Make something exclusive.** A `##` section starting `Known by: a, b`, or
`renown: private` with `known_by` on the page.

**Give someone an unusual background.** `knows:` on their world card
(`knows: { black_market: familiar, sukeban_gangs: intimate }`). Describe the
person; the rule applies it everywhere.

**Something happens in the world.** Add a dated line under `## History`; add
`· news` if it is public announcement. Characters discover it by being there or
being told.

**Retcon a world fact.** Edit the text without a date. If some characters should
also have always believed it, edit their notes or ask ARONA to sweep (§5).

**Retcon what a character believes.** Edit their page: lead, notes or open
threads. Your edit wins over any concurrent write, and sleep builds on it.

**Plant a common misconception.** A section on the world page, e.g.
`## What people say`, with `Known by:` or a narrower page. Characters at that
depth read it as what they know; the canon sections stay hidden.

**Check what someone knows.** The explainer: pick a character and a page to see
depth and why ("familiar: same school; renown known"), or a character alone for
their footprint ("38 intimate, 120 familiar, 300 heard of"). Client Wiki panel,
`GET /kazusa/knowledge/explain`, or ask ARONA.

**Rename or remove a page.** The id is the filename. Lint lists dangling links
and orphaned personal pages. Keep the old id in `aliases` to preserve links, and
rename personal pages with the same id (ARONA can sweep).

## 5. ARONA: seeding, backfill and repair

ARONA writes Markdown with her file tools (scoped to `apps/kazusa`, so both
wikis) and cannot run shell or Gateway RPCs. The memory module therefore gives
her tools of her own, allowlisted for her only:

| Tool                              | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `wiki_lint`                       | Lint both wikis, or one character's.                     |
| `knowledge_explain(agent, page?)` | Depth and the rule that gave it, or the whole footprint. |
| `memory_consolidate(agent)`       | Run a sleep pass now (for backfill from ledgers).        |
| `memory_restore(agent, run)`      | Restore the preimages of one sleep pass.                 |

**Seed a new character**

1. Read their `SOUL.md`, `IDENTITY.md` and world card. `wiki_lint` until
   `school`, `club`, `home` and `knows` resolve.
2. `knowledge_explain(agent)` for their footprint; read the intimate and
   familiar pages that matter to them.
3. Write personal pages only where the character _colors_ the facts:
   - people they have a relationship with (lead in first person, `relation`,
     open threads, and a `What they think of me` guess that does not simply
     mirror the lead);
   - strong opinions on concepts ("the rivalry is stupid, but Hina scares me");
   - misconceptions (`think so`, `suspect`) and secrets they hold.

   Notes are dated at world start with source `always known`. Never copy world
   text; never give them a page they couldn't know (check depth or `known_by`).

4. Write `MEMORY.md`: lately, goals, plans.
5. `wiki_lint`, spot-check with `knowledge_explain`, and list the files written
   for Sensei to review.

**Backfill the current world** (one-off, phase 2)

- World: add `summary` to every concept; infer `community` from the schools a
  page links or mentions and list the ambiguous ones for Sensei; set `renown`;
  move character cards' `## Public Background` into the lead; mark homes
  `private`.
- Personal: move `memory/relationships/*.md` into `wiki/entities/characters/`;
  move root-level pages into `concepts/`; convert interaction logs into notes;
  replace number fields with `relation`; turn `memory/*.md` diaries into
  `days/`; strip machine state from `MEMORY.md`.

**Sweep after a retcon.** Find personal pages and notes about a page id
(`wiki_lint` reports them) and edit the ones Sensei names.

**Repair a bad night.** `memory_restore(agent, run)` with the run id from the
`memory.consolidated` journal event.

Rules: requests come from Sensei only; a character's dialogue never authorizes a
wiki edit.

## 6. The character: what they see and do

**Prefetched in the situation message**, after **Where you are**:

```text
### On your mind
Natsu `natsu-yutori` (close friend): philosophical troublemaker who calls you
"Boss Cath Palug"; you think she sees you as her reluctant boss and enjoys
needling you. Still need to stop her saying it in front of the club.
  · Oct 22, she told you Angel 24 might drop strawberry milk (you suspect so).
Angel 24 `angel_24_trinity`: your go-to for strawberry milk after club.
Also: Sweets Club room `sweets_club_room` · Airi `airi-kurimura` (clubmate, calm)

### People you know
Airi `airi-kurimura` (clubmate) · Natsu `natsu-yutori` (close friend) · …
```

Contact appears inside **Where you are** ("The shutters are down… It was open
when you were last here.").

**Tools** (replacing `memory_search`, `memory_get`, `read`, `edit`, `write`):

| Tool                                         | Does                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `recall(query)`                              | Searches their own wiki, days and `MEMORY.md`, plus world pages at their depth. Returns L1, labelled "yours" or "everyone knows". |
| `look_up(topic)`                             | Searches world pages with renown `known` or `famous`, up to L1. Recorded in `:tasks` so sleep can keep it as `read it`.           |
| `remember(about, note, source?, certainty?)` | Appends one dated note now. `about` is a name or id (an unknown person starts a page) or `me` (`MEMORY.md` plans).                |

**Conventions** (`context-conventions`, about 120 tokens): people and things you
know come to mind here; when something is on the tip of your tongue, `recall`
it; speak from memory, never as someone reading notes; during the day,
`remember` only what you'd regret forgetting before you sleep (a new person, a
promise, a shock); sleep sorts out the rest. Plus the second-order belief
paragraph from §3.5, also in `in-person`.

## 7. The engine (`src/memory/`)

### 7.1 Pages and index

- **Parser** (Zod): front matter, layers, sections with `Known by:`, notes,
  history, links (`[[id]]`, backticked ids, front-matter references). Shared by
  both wikis and lint.
- **Index**: one process-wide cell (`Symbol.for("kazusa.memory")`) owning
  `.state/kazusa/memory-index.sqlite` through the SDK's `node:sqlite` opener:
  - `pages` (id, scope `world` | `agent:<id>`, path, hash, layers, community
    chain, renown, known_by);
  - `chunks` (L0, L1, each section, each note) with an FTS5 table (BM25) and an
    embedding BLOB;
  - `aliases` (name/alias → id) and `edges` (parent, connections, community,
    home, school, club, `touched`, links).
- **Embeddings** through OpenClaw's configured provider
  (`plugin-sdk/memory-core-host-engine-embeddings`, `memory.search` config),
  cached by chunk hash. Vectors are compared by brute-force cosine over the
  eligible set (a few thousand chunks); `sqlite-vec` (SDK loader) if it grows.
- **Freshness**: full hash scan at startup; one recursive watcher on
  `shared/wiki` and `workspaces/*/{wiki,MEMORY.md}`, debounced 500 ms; our own
  writes update the index synchronously. A model change re-embeds everything.
- **Depth** is computed per (character, page) from the index and cached until
  either page or the character's card changes.

### 7.2 Retrieval (prefetch)

Runs in `assemble()` for the brain and, without the semantic signal, in the
decision context for Perception.

1. **Eligible set**: the character's personal pages, plus world pages at depth
   heard of or above (sections filtered by `Known by:`; `## History` lines only
   if seen, told or `news`).
2. **Signals**, each producing a ranked list:

   | Signal   | Input                                                                                                                                   |
   | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | Seeds    | current place and trip destination, people noticed or in the huddle, stimulus senders, chats awaiting reply, the current task's `where` |
   | Mentions | alias matches in the stimulus, the last ledger records, the task description                                                            |
   | Keywords | BM25 over the stimulus                                                                                                                  |
   | Semantic | embedding of stimulus + task description (one provider call per brain turn)                                                             |
   | Graph    | one hop from seeds and mentions; personal edges before world edges                                                                      |
   | Salience | open threads, recent `seen`/notes (sim time), today's day page                                                                          |

3. **Fuse** by weighted reciprocal rank; seeds are pinned.
4. **Group by id**: a personal page and the world page with the same id are one
   entity. The personal page leads; world text fills in only where the personal
   page has no lead (a Location stub), at the character's depth.
5. **Render by tier** under `memory.maxTokens` (replaces
   `personalWikiMaxTokens`/`Articles`): top entities at L1 with open threads and
   the newest notes, the next ones as L0 in an "Also:" line. **People you know**
   is the roster: personal people pages by recency, about 8 tokens each,
   `memory.rosterLimit` (default 20).
6. **Log** the rendered ids per turn (for sleep input and the context read
   model).

Location's **Places you know** uses the same retriever restricted to places; the
mental-map rule (known places are exactly the cards) is unchanged.

### 7.3 Contact

- **Place**: Location already shows the full description when there is no card.
  New: if the world page has `## History` lines dated after the card's `seen`,
  **Where you are** states them in world words; code then sets `seen` and
  appends a `seen it · sure` note. Stub creation stays in Location.
- **People seen**: the lead of their world card.
- **Hearsay** needs no mechanism: chats and huddles are in the ledgers with
  attributed senders, and sleep turns them into `told by` notes.

### 7.4 Writes

| Writer                    | What                            |
| ------------------------- | ------------------------------- |
| Location / contact (code) | stubs, `seen`, `seen it` notes  |
| `remember` (character)    | one note, or a `MEMORY.md` plan |
| Sleep apply (code)        | the validated pass output       |
| Author, ARONA             | anything                        |

Every code write is an **operation** (append note, replace lead, replace open
threads, set field), not a file rewrite: read, apply, and if the file's hash
changed since the read, re-read and re-apply; then tmp + rename. Operations
never touch text they don't own, so a human edit made at the same moment
survives.

### 7.5 Sleep consolidation

- **Trigger**: a Taskman `afterCommit` extension. A task whose category is in
  `memory.sleep.categories` (default `["sleeping"]`) and planned for at least
  `memory.sleep.minMinutes` (180) starts a pass. Taskman stays ignorant of what
  sleep means.
- **Runner**: `api.runtime.subagent.complete` with the character's model, one
  tool-free call, no session, no ledger; `:brain` stays free so Perception keeps
  working.
- **Instructions**: `shared/skills/sleep-consolidation/SKILL.md`.
- **Input** (one message, about 8–12k tokens): name and a `SOUL.md` excerpt; the
  desires line; every ledger record since the watermark (dropping the oldest
  over budget); `MEMORY.md`; the full personal pages of every entity in the
  records or rendered that day; ids and summaries of the rest; pages over the
  note cap with their oldest notes marked _fading_. No world text beyond what
  the records show.
- **Output** (Zod), operations not files:

  ```ts
  {
    day: { summary: string; gist: string; touched: string[] };
    pages: Array<{
      id: string;                         // existing, or a new slug
      kind?: "person" | "place" | "concept"; // required when new
      name?: string; aliases?: string[];
      summary?: string;                   // L0
      view?: string;                      // L1 lead, replaces
      relation?: string;                  // people
      openThreads?: string[];             // replaces
      theyThinkOfMe?: { guess: string; certainty: Certainty }; // people, replaces
      notes?: Array<{ source: string; certainty: Certainty; text: string }>;
      links?: string[];
    }>;
    self?: { lately?: string; goals?: string[]; plans?: string[] };
    dream?: string;
  }
  ```

- **Validation**: `told by`/`overheard` must name someone who spoke in the input
  records; a new page needs at least one grounded note; ids must be valid slugs;
  `theyThinkOfMe` only for people who appear in the records. The skill asks for
  the guess to be argued from what that person did, not from the character's own
  view of them. Invalid items are dropped and logged, not the whole pass.
- **Apply**: preimages of every touched file and the watermark go to a
  `"memory"` keyed store (one run id); operations per §7.4; fading notes past
  `memory.notesPerPage` (default 30) are removed once their page's view was
  rewritten; the day page is written (a second sleep the same day appends).
- **Surface**: a `memory.dream` row in `:tasks` at the sim time the pass ends; a
  `memory.consolidated` journal event (agent, window, run id, pages and notes
  changed, new pages, `interrupted`).
- **Waking**: a `WAKE`/`STEER` during sleep aborts the pass (nothing applied,
  watermark kept). A deadline that arrives while the pass runs is held by
  Perception, bounded, until it settles.
- **Cost**: about 10k input and 1.5k output tokens per character per night.

### 7.6 Read models

`GET /kazusa/wiki` (both wikis, per character), `GET /kazusa/wiki/lint`,
`GET /kazusa/knowledge/explain?agent=&page=`, `GET /kazusa/memory/runs?agent=`;
SSE `memory` on every write. The client Wiki view shows the world page next to
each character's page, notes with sources, depth with its reason, per-sleep
diffs, day pages as a Diary, and lint.

## 8. Replaced and removed

| Today                                                | Becomes                                           |
| ---------------------------------------------------- | ------------------------------------------------- |
| memory-core: `memory_search`, `memory_get`, dreaming | our index, `recall`, sleep; memory slot off       |
| `session-memory` hook, `memory.search.sources`       | off                                               |
| `readPersonalWiki` (literal regex, senders `[]`)     | §7.2                                              |
| Location's literal **Places you know** relevance     | §7.2, places only                                 |
| `read`/`edit`/`write` on the character surface       | `recall`, `remember` (ARONA keeps file tools)     |
| `memory/` diaries, `memory/relationships/`           | `wiki/days/`, `wiki/entities/characters/`         |
| `claims:` YAML, `reports/contradictions.md`, numbers | notes with source and certainty, `relation` words |
| seeded `AGENTS.md`/`USER.md` in workspaces           | deleted; `agents.defaults.skipBootstrap: true`    |

Update with the first implementation: the kazusa skill (§2 storage table, §3.3
personal wiki, §3.6 knowledge, which wrongly says memory search has no plugin
API: `plugin-sdk/memory-host-search` exists), `references/file_schemas.md` §4–5
and `references/context_engine.md`.

## 9. Phases

1. **Hygiene**: `skipBootstrap`; delete workspace `AGENTS.md`/`USER.md`; turn
   off dreaming and the `session-memory` hook.
2. **Format and depth**: parser, lint, depth, `knowledge_explain`, `wiki_lint`,
   the explain/lint read models.
3. **Backfill** (ARONA, §5): world `summary`/`community`/`renown`; personal
   migrations.
4. **Index and retrieval**: SQLite index, watcher, lexical + graph signals,
   replacing `readPersonalWiki` and Places-you-know relevance; the roster; an
   evaluation set from `/kazusa/context` snapshots with expected pages.
5. **Embeddings**: the semantic signal, measured against the evaluation set.
6. **Tools**: `recall`, `look_up`, `remember`; drop memory-core and character
   file tools; conventions text.
7. **Sleep**: trigger, input, schema, validation, apply, preimages,
   `memory_consolidate`/`memory_restore`, journal, wake hold.
8. **World history**: `## History`, contact discrepancies, `news`.
9. **Client**: Wiki/Diary views, diffs, explainer, lint.

## 10. What's hard

1. **Retrieval quality.** Fusion weights and cut-offs are guesses without the
   evaluation set; keeping it current is the real cost of owning retrieval.
2. **Entity linking.** Nicknames ("Cath Palug"), first names alone, shared
   family names (Momoi and Midori Saiba). Graph proximity to the current seeds
   breaks ties.
3. **Drift over many nights.** Telephone-game impressions, inflating certainty,
   growing pages. Caps, grounded sources, preimages and per-sleep diffs are the
   guards; watch them live. Also watch for guesses drifting back into mirrors of
   the character's own view (§3.5): compare the two sections across a cast.
4. **Concurrent writers.** `remember`, sleep, Location and a human editor on one
   file: operations plus the hash check (§7.4).
5. **Depth correctness.** Defaults that surprise the author. The explainer is
   the mitigation; without it, authoring by rules is just a different headache.
6. **Plumbing.** One watcher under repeated plugin registration, recursive
   watching on Linux, embedding latency in the turn path (lexical fallback on
   failure), a full re-embed on model change.

Not hard: BM25 (FTS5), vectors at this scale, the graph from front matter, the
note format.

## 11. Open questions

- Sightings name everyone (`location.md` §4.5), so strangers' names leak. Should
  an unknown person be "a Gehenna student with a red armband" until introduced?
- Verify before building: `subagent.complete` with the deployed model; that
  `MEMORY.md` bootstrap injection works with the memory slot off; the embedding
  provider factory signatures.
- Are the anchor depths right (school → familiar)? Tune after backfill with the
  footprint view.
- Should `look_up` cost time (a short task) rather than being free?

## 12. Decision log

- **No memory-wiki**: a vault is global or per-agent, never both; vault init
  writes `AGENTS.md` into the workspace; its tools are out of world.
- **No memory-lancedb-pro**: it is a memory-slot plugin built for an assistant
  remembering a user. It has no graph, indexes only `MEMORY.md`, `memory/` and
  sessions, runs decay and dreaming on wall-clock time, and its write side
  (extraction, dreaming) can't be bent to sleep in a character's voice without a
  fork. The pieces we'd use (hybrid search) are a small part of it; the SDK
  already exposes embeddings, SQLite and chunking.
- **No memory-core**: its index can't share one world wiki across agents without
  embedding it per agent, and its dreaming has the wrong clock, voice and
  selection signal.
- **Depth over exclusive lore** (openrp's model): binary common/exclusive can't
  say "a Trinity student has heard of the Prefects but can't find their office".
- **Notes over `claims:` YAML**: one readable line carries date, source and
  certainty, and an author can edit it without learning a schema.
- **Day pages over diaries**: days become graph nodes linked to what they
  touched, so "when did I last see Airi" is a walk, not a search.
- **Second-order beliefs as their own section** (2026-10-29): characters guess
  what others think of them instead of assuming it mirrors their own feelings.
  This keeps interactions from going uniformly polite and alike, and it costs
  only a section and a skill paragraph because personal wikis are already
  private and asymmetric.
