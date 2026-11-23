# Memory, Knowledge & Sleep

Status (2026-10-30): built; sleep is off by default and untested on a real
model. See [the checklist](memory-checklist.md). Supersedes
`memory-and-sleep.md`. Designed in the order set by the kazusa skill §0:
simulation, then player, then prompt. §4–§6 are written for the people who use
it (content creator, ARONA, the character); §7 is the engine.

Goal: a character knows what someone in their position would know, recognizes
people and places without being asked, can try to remember or look something up,
holds beliefs that may be wrong and says where they came from, and sorts the day
out in their sleep. The world's author edits Markdown and nothing else.

**Changed 2026-11-19 (one page per character, who knows in levels):** a
character's World Wiki page is who they are, read whole on their turns in place
of `IDENTITY.md` and `SOUL.md` (no longer read); their inner voice is a section
`Known by:` them, the only `Known by:` there is. Who knows any page is one
field, `known`: each group and how well its members know it (`heard of`,
`knows`, `close`), with `everyone` for every character (§3.3). Only a group (a
page with `group: true`) can know a page. It replaces `renown`, `known_by`,
`community`, the world-configured `memory.anchors` (deprecated, ignored) and the
`club`/`school` fields; `knows`, `title` and `full_name` are gone (`name`,
`aliases`). A secret only some others know goes in each of their own wikis. Read
older mentions below in that light. An older world (pages under `entities/`) is
read the older way (`memory/legacy.ts`, deprecated), its characters'
`IDENTITY.md` and `SOUL.md` included, until it updates to a release of its
template in the two-folder layout (`world_update` moves every page and folds the
cards into the pages). There is no upgrade by hand.

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

| What a real person does                                                          | Kazusa                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Knows their own club and dorm inside out, their school well, rivals by name only | **Depth** from the groups a page names, how well each knows it, and home (§3.3).                                                          |
| Recognizes a face or a place instantly, with feelings attached                   | **Prefetch**: retrieval before every brain turn, no tool call (§7.2).                                                                     |
| Sees what is actually there, and notices when it changed                         | **Contact**: the world page of what they stand in or face, and its dated changes since they last saw it (§7.3).                           |
| Has something on the tip of the tongue                                           | `recall`.                                                                                                                                 |
| Checks the school portal, asks around online                                     | `look_up`: public world pages only.                                                                                                       |
| Believes gossip, misreads people, holds theories                                 | Notes with a source (`told by natsu-yutori`) and a certainty word. Canon never corrects them silently.                                    |
| Guesses what others think of them, and is often wrong                            | **What they think of me** on every people page: a guess with a certainty word, never a mirror of their own view (§3.5).                   |
| Writes down what would hurt to forget: a promise, someone new, a change of heart | `remember`, in the moment; small talk is left to sleep.                                                                                   |
| Sleeps on it: keeps the gist, revises opinions, dreams                           | **Sleep consolidation**: the turn that goes to bed goes over the day: rewrites views, adds notes, writes the day page and a dream (§7.5). |
| Forgets details, keeps a general sense                                           | Notes per page are capped; sleep folds the oldest into the page's current view.                                                           |
| Always has family, friends and home in mind; a café seen once fades              | **People you know** and **Places you know**, ranked by familiarity: recency and frequency over sim time (§7.7).                           |
| Woken at 3 am, sleeps badly                                                      | What they had gone over by then is kept; back in bed the same night, the day is not gone over again (§7.5).                               |

Naps shorter than `memory.sleep.minMinutes` (default 180) don't consolidate.

## 2. Player: what is fun, and where it surfaces

- **Callbacks.** A character brings up something Sensei said days ago: their
  page on `sensei` is a seed in every direct chat with Sensei, played or not.
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
├── characters/<id>.md                the cast: who they are, `in`, `home`
└── concepts/<id>.md                  everything else: lore, groups (`group: true`),
                                      places (`place_id` and the map's fields)

workspaces/<agent_id>/                PERSONAL (the character's mind)
├── (who they are: their World Wiki page; SOUL.md and IDENTITY.md are not read)
├── MEMORY.md                         always loaded: who I am lately, goals, plans
└── wiki/
    ├── characters/<id>.md            people (same id as the world page)
    ├── concepts/<id>.md              places and views on world concepts, or their own
    └── days/<YYYY-MM-DD>.md          one per sim day, written in sleep

.state/kazusa/memory-vectors.sqlite   embeddings (cache, rebuildable)
```

A page's id is its filename. A personal page with the same id as a world page is
the character's annotation of that thing: what they think of it and what they
noted, never a copy of the world page, which they read alongside it; one with no
world counterpart is the character's own concept ("Natsu's romance theory").
Removed: `memory/` (diaries become `days/`), `memory/relationships/` (moves to
`entities/characters/`), `reports/`, `syntheses/`, and the YAML `claims:`
schema.

### 3.2 Page anatomy

Every page, world or personal, is read in **layers**, which double as levels of
detail in the prompt:

| Layer | Where in the file                             | Shown at depth |
| ----- | --------------------------------------------- | -------------- |
| L0    | `summary` in front matter (else 1st sentence) | heard of       |
| L1    | the lead: text between the H1 and first `##`  | familiar       |
| L2    | `##` sections                                 | intimate       |

**Two folders, components, links (2026-11-20).** A wiki has two folders:
`characters/` (the cast, each tied to an agent workspace) and `concepts/`
(everything else). What a concept is comes from its components, its fields, not
its folder, so a school is one page that is both a place and a group:

| Component | Fields                                                                             | Makes it                                  |
| --------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| place     | `place_id`, `parent` (its area), `entry_minutes`, `connections`, `map`, `backdrop` | somewhere to be, on the map               |
| group     | `group: true`                                                                      | something people are in, that knows pages |

There are no other relations in front matter: a club's school, a rival, an
event's cast are `[[id]]` or `[[id|words]]` links anywhere in the text. They are
the knowledge graph, read in tiers: a character follows a link only from a part
of the page they can see (the summary if they have heard of it, the opening if
they know it, the sections if they are close). A place's area is also an edge.

**World page:**

```markdown
---
summary: The academy's night patrol; feared and overworked.
aliases: [the Watch, Night Watch]
group: true
known: # who knows it, and how well: heard of | knows | close
  everyone: heard of
  northgate_academy: knows
---

# Night Watch

The patrol of [[northgate_academy|Northgate]]: lanterns, armbands, a captain who
never sleeps… (L1)

## Inner workings

Shift rotations, the budget fights with [[student_council]]… (L2)
```

A character's page names the groups they are in and how involved:
`in: { night_watch: close, northgate_academy: knows }` (`heard of` is an
associate). Involvement caps what they get through a group: a page a group knows
`close` reaches its close members whole, its members to the opening, its
associates to the summary. Two members know each other as well as the less
involved of them, and their prompt says it is "through" that group; `known` adds
others (`everyone: knows` for a public figure, `harbor_college: heard of` for a
rival school). Only a group can be named in `known` or `in`. Someone's groups
show on their entry ("In: Northgate Academy, Night Watch") to whoever knows the
group (`knows` or closer), so page text needn't repeat them; a group known only
by name keeps its members to itself (older worlds: never shown).

- `## History` holds dated in-world events (§3.4). Undated edits anywhere else
  are retcons.
- World character pages: `in` (the groups they are in, and how involved),
  `known` (the groups that know them, beyond those) and `home`. Their lead is
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
- **`MEMORY.md`**: `## Lately` (who I am these days), `## Long-Term Goals`,
  `## Plans recorded for <date>` (promises). No machine state (location,
  hunger).

### 3.3 Knowledge depth

`depth(character, worldPage)` is one of `none < heard of < familiar < intimate`,
computed in code as the **highest** of:

1. **The page's `known`.** Each group it names reaches that group's members:
   `heard of` gives heard of, `knows` familiar, `close` intimate, capped by how
   involved each member is. `everyone` reaches every character.
2. **Membership.** A character is in every group their own page's `in` names:
   `heard of` (associate), `knows` (member) or `close` (close member). They know
   that group's page as well as their entry says.
3. **Home**: their `home`, the place it is in and everything in that give
   intimate, except someone else's home that no group knows (their own room).
4. **Experience**: having a personal page with that id gives at least familiar
   (they've been there or met them).

A page with no `known` (a dorm room, a hideout) is known only to those who live
there or around it, and to those who have been there. The Wiki shows each page's
groups at the top, with who in the cast is in a group (`GET /kazusa/wiki/reach`
gives the names for each depth and a group's members).

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

Everything is a Markdown edit. Changes reach the next turn, with no restart. The
world and workspaces are tracked in git, so every edit has a diff and history.

**Create a new world**

1. The world's root page in `concepts/`, then its groups there (`group: true`):
   schools, their clubs, each with the `known` that say who knows it
   (`everyone: heard of` for a school anyone has heard of).
2. The map in `concepts/` (see `location.md` §4.1), each place with the groups
   that know it. Homes list none.
3. Character pages in `characters/`: `in` (a club `close`, a school `knows`: the
   groups they are in and how involved), `home`, and an opening saying what
   people see.
4. Lore in `concepts/`: `summary`, `known`, and `[[links]]` to what it relates
   to. Put what outsiders would know in the opening and insider detail in `##`
   sections.
5. Check lint (Gateway log, client Wiki panel, or ask ARONA).
6. Ask ARONA to seed each character (§5).

**Add a concept, place or person mid-run.** Drop the file in. It reaches
characters at their depth immediately, as if it always existed.

**Make something exclusive.** Narrow its `known` to the groups who know it, or
leave it out so only those who live there or have been there know it. A secret a
few people share goes in each of their own wikis.

**Give someone an unusual background.** Write it into their own wiki: a personal
page on the black market makes it familiar to them.

**Something happens in the world.** Add a dated line under `## History`; add
`· news` if it is public announcement. Characters discover it by being there or
being told.

**Retcon a world fact.** Edit the text without a date. If some characters should
also have always believed it, edit their notes or ask ARONA to sweep (§5).

**Retcon what a character believes.** Edit their page: lead, notes or open
threads. Your edit wins over any concurrent write, and sleep builds on it.

**Plant a common misconception.** Say it in the summary, which everyone who has
heard of it reads (the lead reaches only those who know it), and keep the truth
in a section only those close to it get; or seed it as a note in the believers'
own wikis.

**Check what someone knows.** The explainer: pick a character and a page to see
depth and why ("familiar: northgate_academy: knows"), or a character alone for
their footprint ("38 intimate, 120 familiar, 300 heard of"). Client Wiki panel,
or ask ARONA (`knowledge_explain`).

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
| `memory_consolidate(agent)`       | Have them go over the day now, in a turn of their own.   |
| `memory_restore(agent, run)`      | Restore the preimages of one night's sleep.              |

**Seed a new character**

1. Read their `SOUL.md`, `IDENTITY.md` and world card. `wiki_lint` until
   `school`, `club`, `home` and `knows` resolve.
2. `knowledge_explain(agent)` for their footprint; read the intimate and
   familiar pages that matter to them.
3. Write personal pages only where the character _colors_ the facts:
   - people they have a relationship with (lead in first person, `relation`,
     open threads, and a `What they think of me` guess that does not simply
     mirror the lead). Relationships live only here, never in `IDENTITY.md` or
     `SOUL.md`: a page is what brings a person to mind and what sleep and
     `remember` keep current;
   - strong opinions on concepts ("the rivalry is stupid, but Hina scares me");
   - misconceptions (`think so`, `suspect`) and secrets they hold.

   Notes are dated at world start with source `always known`. Never copy world
   text; never give them a page they couldn't know (check depth).

4. Write `MEMORY.md`: lately, goals, plans.
5. `wiki_lint`, spot-check with `knowledge_explain`, and `world_audit`: nobody
   in `knowNobody`, and one society in `socialGroups`, not one per club (people
   know their leaders, classmates and neighbors). List the files written for
   Sensei to review.

**Backfill the current world** (one-off, phase 2)

- World: add `summary` to every concept; infer `known` from the schools a page
  links or mentions and list the ambiguous ones for Sensei; move character
  cards' `## Public Background` into the lead; give homes no `known`.
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

| Tool                                              | Does                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `recall(query)`                                   | Searches their own wiki, days and `MEMORY.md`, plus world pages at their depth. Returns L1, labelled "yours" or "everyone knows".          |
| `look_up(topic)`                                  | Searches world pages `everyone` has heard of, up to L1. Recorded in `:tasks` so sleep can keep it as `read it`.                            |
| `remember(about, note, source?, certainty?, on?)` | Appends one dated note now. `about` is a name or id (someone new starts a page) or `me` (`MEMORY.md`, under `## Plans recorded for <on>`). |

**Conventions** (`context-conventions`, about 120 tokens): people and things you
know come to mind here; when something is on the tip of your tongue, `recall`
it; speak from memory, never as someone reading notes; in the same turn,
`remember` what is worth keeping past today (a plan or promise, someone new,
something that changes how you see someone or how they see you); small talk is
left to sleep. Plus the second-order belief paragraph from §3.5, also in
`in-person`.

**A turn is one moment** (`src/turn.ts`): at most one activity per 2 minutes,
blocked in code, and a character may still talk or look things up after it. At
most two lookups per run. A send that repeats this run's words is blocked.
Records are capped (`contextEngine.ledgerMaxTokens`, 3000) and append-only, past
brain turns are not replayed, and the situation sits before the turn under way,
so tool results stay last and the model doesn't answer its own prompt twice.

## 7. The engine (`src/memory/`)

### 7.1 Pages and index

- **Parser** (Zod): front matter, layers, sections with `Known by:`, notes,
  history, links (`[[id]]`, backticked ids, front-matter references). Shared by
  both wikis and lint. Prettier wraps long lines, so a note, history line or
  open thread continues on its indented lines, and `Known by:` is its whole
  first paragraph.
- **Index** (`index.ts`): one process-wide cell (`Symbol.for("kazusa.memory")`)
  holding parsed pages by scope (`world` | `agent:<id>`) and an in-memory FTS5
  table of chunks (L0, L1, each bullet or paragraph of a section, each note).
  Names and edges are read from the parsed pages.
- **Embeddings** (`embeddings.ts`): an OpenAI-compatible `/embeddings` call with
  the plugin's `memory.embedding` settings, cached by chunk hash in
  `.state/kazusa/memory-vectors.sqlite`. New chunks embed in the background; a
  turn only waits for its own query (3 s at most, then keywords only). Vectors
  are compared by brute-force cosine over the world and that character's pages.
- **Freshness**: no watcher. Each retrieval stats that character's wiki, and the
  world at most once a second, and re-reads what changed, so an edit reaches the
  next turn. This avoids a watcher owner under repeated plugin registration and
  recursive watching on Linux. A model change re-embeds everything.
- **Depth** is computed per (character, page) from the index and cached until
  either page or the character's card changes.

### 7.2 Retrieval (prefetch)

Runs in `assemble()` for the brain and, without the semantic signal, in the
decision context for Perception.

1. **Eligible set**: the character's personal pages, plus world pages at depth
   heard of or above (never a part `Known by:` its own character; `## History`
   lines only if seen, told or `news`).
2. **Signals**, each producing a ranked list:

   | Signal      | Input                                                                                                                                   |
   | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | Seeds       | current place and trip destination, people noticed or in the huddle, stimulus senders, chats awaiting reply, the current task's `where` |
   | Mentions    | alias matches in the stimulus, the last ledger records, the task description                                                            |
   | Keywords    | BM25 over what they think about (below); a page only keywords found must share two query words (half of them if merely heard of)        |
   | Semantic    | embedding of what they think about (one provider call per brain turn: later builds reuse it)                                            |
   | Graph       | one hop from seeds and mentions: their own links first, then what it is part of (`parent`), a person's groups, its links, its parts     |
   | News        | `· news` from the last 3 sim days on pages they could know (2 at most)                                                                  |
   | Salience    | open threads, recent `seen`/notes (sim time), today's day page                                                                          |
   | Familiarity | what the other signals found, by familiarity (`familiarity.ts`); a prior that never adds a page                                         |

   **What they think about** (`searchText`) is what they perceived: the
   `- [...]` lines of the delivery, never Kazusa's wording around them. With
   nothing perceived (a check-in), it is the activity that ended and today's
   plans in `MEMORY.md` (`plansOn`): what was that, and what's next. A page that
   keywords alone found needs `MIN_KEYWORD_WORDS` (2) query words, by FTS's
   stemming (`wordsMatched`), or half of them when it is merely heard of; their
   own pages need one. Tuned on the 104-case set (`fixtures/cases.ts`): every
   wanted keyword-only hit kept, about 70% of the unwanted dropped.

3. **Fuse** by weighted reciprocal rank; seeds are pinned.
4. **Group by id**: a personal page and the world page with the same id are one
   entity, rendered as the world page at the character's depth (its opening if
   familiar, else its summary), its groups, then "Your view:" with the personal
   lead (2026-11-19: the personal page used to replace the world text).
5. **Render by tier** under `memory.maxTokens` (replaces
   `personalWikiMaxTokens`/`Articles`): top entities at L1 with open threads and
   the newest notes, the next ones as L0 in an "Also:" line. **People you know**
   is the roster: personal people pages ranked by familiarity (`familiarity.ts`:
   ACT-R activation over what they did with each person, falling back to the
   page's last date), about 8 tokens each, `memory.rosterLimit` (default 20),
   leaving out who On your mind shows and who is in front of them.
6. **Log** the rendered ids per turn (for sleep input and the context read
   model).

Location's **Places you know** is working knowledge, not recollection: home,
places named this turn or in `MEMORY.md` (the retriever restricted to their own
place pages, plus literal names), then their cards by the same familiarity. The
mental-map rule (known places are exactly the cards) is unchanged. A place On
your mind shows is not listed again.

### 7.3 Contact

- **Place**: Location already shows the full description when there is no card.
  If the world page has `## History` lines dated after the card's `seen`,
  **Where you are** adds "Since you were last here:". Assembly may be retried,
  so nothing is written then: moving on to the next activity sets `seen` and
  appends a `seen it · sure` note, with the stub.
- **People seen**: the lead of their world card, whatever their depth.
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

A character goes over the day in the turn that puts them to bed
(`memory/sleep.ts`). There is no pass of its own: no extra model call, no
session, nothing to schedule, interrupt or resume.

- **Trigger**: a Taskman extension. A `start_task` whose category is in
  `memory.sleep.categories` (default `["sleeping"]`), planned for at least
  `memory.sleep.minMinutes` (180), and at least `memory.sleep.everyMinutes`
  (720) of sim time after the last night that kept anything, opens a **night**.
  `memory.sleep.enabled` is on by default. Taskman stays ignorant of what sleep
  means.
- **What going to bed says**: `start_task`'s result carries an `aside`
  (`PreparedTaskCommit.aside`: said with the result and never written to their
  records), worded by `shared/skills/sleep-consolidation/SKILL.md`: how to go
  over the day (`night`); the states a night reviews (`states`, from
  `stats.review`, for up to 12 people of the day); their own pages, whole, on
  what the day touched, latest first (`pages`; "touched" is familiarity's uses
  since the last night); and notes past the cap on those pages (`fading`). Pages
  and fading notes share one budget of 24,000 characters, or less when the rest
  of what is said leaves less of the 32,000 a turn can be handed
  (`OFFER_CHARS`): a page goes in whole or not at all, and nothing shown is cut
  on the way. Going back to bed in the same run says none of this again: the
  night they are going over stands.
- **The run goes over it** with two tools. `remember` adds notes as at any other
  time. `reflect` (`REFLECT`, flat on purpose) takes `about` and what changed:
  - a person, place or thing: `view` (replaces the lead), `summary`, `relation`,
    `openThreads`, `theyThinkOfMe`, and `states` toward a person;
  - `me`: `view` (Lately), `goals`, and their own `states`;
  - `today` (or the night's date): `view`, `summary`, `dream`. This writes the
    day page (`wiki/days/<date>.md`; the date is the day they were up for, so
    bed after midnight still writes yesterday). It ends nothing.

  A `view` replaces the old one whole, so a page they were not shown tonight is
  shown first and nothing changes (`reflect-unread`). The run gets more calls
  and time once (`roomForSleep`).

- **A name nothing answers to** (`knownOrNew`, for `remember` too, at any time):
  when `about` resolves to neither a page of theirs nor a world page, nothing is
  written; the reply lists the closest pages they have, from the same retrieval
  `recall` uses (`similarTo`). They say it again about one of those, or with
  `new: true`. Without this a friend called by first name got a second page.
- **The night ends when the run does** (`runEnded`, from Perception's lifecycle
  end), whatever the model did or didn't say. Code then tidies up: plans for
  days gone by leave `MEMORY.md`; notes past `memory.notesPerPage` (default 30,
  except `always known` ones) leave pages whose view was rewritten tonight and
  that bedtime showed whole (`whole`): a view written after seeing only the old
  view (`reflect-unread`) has not taken the notes in, so they stay; the run is
  kept; the night is told. A night that wrote nothing and moved no state leaves
  no trace and the day waits for the next sleep. One that only moved states is
  kept as a run with no files, so it is their last night and a nap later does
  not review the same day again. Writes after the run are no part of it.
- **Kept**: every write during a night goes through `sleep.write`, which keeps
  what each file was before. The `"memory"` keyed store holds the last 7 runs
  (pre- and post-images), newest first; the newest's time is "last night".
  `memory_restore` puts one back. State changes are not undone. When the store
  refuses the run as the night ends (a database under load), the run is held in
  memory as it stood, still counts as last night, and is kept at the next read
  of the runs (`settle`); the night is told all the same. One is held per
  character, and a restart loses it.
- **Surface**: a row in `:tasks` (`kazusa-results#night-dreamt` or
  `#night-slept`: `You dreamt: …` or `You slept on it.`) and a
  `memory.consolidated` journal event (window, run id, pages, new pages, notes,
  dream).
- **By hand** (`memory_consolidate`, `POST /kazusa/memory/consolidate`): the
  same words arrive as a stimulus in a turn of their own. The night waits
  (`waiting`) until a `reflect`, or a write in a run that began after it was
  asked for (`offered`), so a run already under way neither ends it nor begins
  it with a note of its own; if no turn can be handed over, no night is left
  behind.
- **Lost on restart**: a night lives in memory. A Gateway stopped mid-run keeps
  what was written but no run and no event, and the next sleep covers the same
  days again.

### 7.6 Read models

`GET /kazusa/wiki` (both wikis, per character), `GET /kazusa/wiki/lint`,
`GET /kazusa/memory/runs?agent=`; SSE `memory` on every write. The client Wiki
view shows the world page next to each character's page, notes with sources,
depth with its reason, per-sleep diffs, day pages as a Diary, and lint.

### 7.7 How long-term memory reaches a turn

A person doesn't search their memory; things come to mind. Some always do (home,
family, the people they see every day), some because of what is happening now,
and some only when they try. Each is its own part of the prompt, and nothing is
shown twice.

| Part of the prompt             | Holds                                      | Chosen by                                              |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| `MEMORY.md` (system prompt)    | who they are lately, goals, today's plans  | the character and sleep                                |
| Records (`contextEngine`)      | the last day as it happened                | time                                                   |
| **People you know**            | names and relations, no detail             | familiarity (`memory.rosterLimit`)                     |
| **Places you know** (Location) | home, places named now, then the most used | familiarity, then distance                             |
| **On your mind**               | the pages this moment brings up            | cues (§7.2), at their depth (§3.3), `onYourMindTokens` |
| `recall`, `look_up`            | what is on the tip of the tongue           | the character, by asking                               |

People you know leaves out who On your mind shows and who is present; Places you
know leaves out the current place, Around you and On your mind. Memory's
prefetch runs before Location's whereabouts so the two can exclude each other.

**Familiarity** (`familiarity.ts`, keyed store `familiarity`, one record per
character) is how much they have to do with each person and place. A _use_ is
something they did, never something they were shown, which would feed itself:

- a message: every recipient uses the sender, and in a chat of six or fewer the
  sender uses each member (`usesOfMessage`, from Messaging's events);
- going somewhere (`where` on `start_task`);
- a note or a page moving: the page's latest date counts as a use, so a world
  with no history yet still ranks what they last touched.

Uses are counted per **episode** of `memory.familiarity.episodeHours` (24): a
later contact inside it moves the episode's time on instead of adding a use. Ten
days of contact count ten times, one long party once, which is the spacing
effect. Within the hour, nothing changes. The score is ACT-R base-level
activation, `ln Σ age^-d` (`decay` 0.5), with the `recent` (4) uses kept exactly
and the older ones estimated from the count and first use (Petrov's hybrid). It
fades with sim time: a best friend who moved away drifts down over weeks, and a
stranger from one evening drops below a twice-weekly clubmate the next day.

Familiarity ranks the two lists and nudges On your mind (§7.2): among what this
moment brought up, what they know best ranks higher. It never adds a page on its
own, and it never changes depth.

**Who someone is to them** is their personal page, and only that: `relation`,
their view in their own voice, what they guess the other thinks of them, open
threads and dated notes. Depth (§3.3) decides how much of the canon they see;
having a personal page makes it at least familiar. Public figures and a player
the whole cast knows get `everyone: heard of` or `everyone: knows` in the
`known` on their world page.

**What comes to mind** is retrieved from what they perceived (§7.2): the lines
of the delivery, never Kazusa's wording around them. A check-in perceives
nothing, so it searches the activity that just ended and today's plans: the bell
rings, and what comes to mind is the promise to meet in the club room, not the
word "activity". A page found only by keywords must share two query words with
what was said, or half of them if merely heard of; their own pages need one,
since a single cue brings back what you wrote yourself.

**Writing it down** happens twice. During the day, `remember` notes a plan or
promise, someone new, or something that changes how they see someone; a person
it doesn't know yet gets a page. At night, sleep (§7.5) rewrites views, guesses
and threads from the day's records, and once a page passes
`memory.sleep.notesPerPage` folds the oldest notes into the view. So when a page
comes to mind, they see one blended impression plus the newest notes with their
sources.

**Checking it**: the 104 cases in `fixtures/cases.ts` run with the unit tests
(keywords) and need real embeddings for the `semantic` ones. A change to
retrieval keeps every case passing and is then spot-checked on the live world
with real query vectors: waking, a check-in, a message from family, from someone
familiar, and from a stranger, which should bring up nothing about the stranger.
`world_audit` checks the seeding: `knowNobody` empty, one society in
`socialGroups`.

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
3. **Backfill** (ARONA, §5): world `summary`/`known`; personal migrations.
4. **Index and retrieval**: SQLite index, watcher, lexical + graph signals,
   replacing `readPersonalWiki` and Places-you-know relevance; the roster; an
   evaluation set from situation snapshots with expected pages (that record was
   removed in 2026-11).
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
6. **Plumbing.** Embedding latency in the turn path (lexical fallback on
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
- **Beliefs shadow canon** (2026-10-30): a personal lead replaces the world's
  lead in the prompt, even when both exist. Showing both would quietly correct
  wrong beliefs and spend tokens; `recall` and experience are how a character
  learns.
- **`look_up` is instant**: a quick check inside the turn, logged to `:tasks`.
- **Familiarity is ACT-R base-level activation over day-long episodes**: it is
  the standard model of how recency and frequency combine, it fades on sim time,
  and counting an episode once is what makes regular contact outweigh one long
  evening. It ranks; it never decides what a character knows.
- **Retrieval searches what was perceived**: Kazusa's own wording (check-ins,
  the closing reminder) is shared by every character and matches the wrong
  pages. A check-in searches the activity and the day's plans instead.
- **Keyword-only pages need a subject, not a word**: rank fusion only orders, so
  the top keyword hit scored the same whether it matched "joint pain" or
  "activity". Matching two query words (half, for what they've merely heard of)
  is the floor; their own pages need one.
- **Relationships only in personal pages**: a relationship written in
  `IDENTITY.md` or `SOUL.md` reaches the system prompt but can never be
  retrieved, ranked or updated by sleep, and repeats what the page says.
- **`plugins.slots.memory: "none"`, not our plugin**: claiming the slot would
  mean building a host memory capability for features we removed on purpose.
  `skipBootstrap` only stops files being created, not read.
