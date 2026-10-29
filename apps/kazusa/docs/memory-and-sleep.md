# Memory, Personal Wiki & Sleep Consolidation

Status: proposal (2026-10-28). Designed in the order set by the kazusa skill §0:
simulation, then player, then prompt.

## 0. What the OpenClaw plugins actually give us

### memory-core (keep, narrowed)

| Feature                                         | Fit for Kazusa                                                                                                                                                                                                                                                                                                                              | Decision                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Hybrid index of `MEMORY.md`, `memory/**/*.md`   | Exactly the "deliberate recall" layer.                                                                                                                                                                                                                                                                                                      | Keep.                                        |
| `memory.search.extraPaths` (workspace-relative) | `"wiki"` indexes each character's own personal wiki, per agent.                                                                                                                                                                                                                                                                             | Add `extraPaths: ["wiki"]`.                  |
| Dreaming (on by default)                        | Runs on a wall-clock cron (`0 3 * * *`), one sweep for all agents. Selects by how often `memory_search` surfaced a snippet (an assistant signal), rewrites `MEMORY.md` with `Source:` refs and `<!-- trigger -->` comments, narrates `DREAMS.md` as an outside observer, and ignores cron sessions. Wrong clock, wrong voice, wrong signal. | Disable (`dreaming.enabled: false`).         |
| `session-memory` hook (enabled in our config)   | Writes `memory/<real-date>-<slug>.md` on `/new`/`/reset`: real-world dates and assistant summaries in a character's memory.                                                                                                                                                                                                                 | Disable.                                     |
| `sources: ["sessions"]`                         | Hits come back as `sessions/...jsonl` references that only `sessions_*` tools can expand, which characters are denied. Group chats are excluded anyway.                                                                                                                                                                                     | Drop; daily notes become the episodic index. |

Worth borrowing from dreaming: the model returns **operations, not a rewritten
file**; code applies them, stores a preimage first, and refuses rewrites that
lose too much.

### memory-wiki (don't enable yet; stay schema-compatible)

What it is: a compiled knowledge vault with claims and evidence, dashboards
(contradictions, open questions, low confidence), and `wiki_search`, `wiki_get`,
`wiki_apply`, `wiki_lint`, and `wiki_status`. It also supplements the
`memory_search` corpus and adds a Control UI browser.

Why not now:

- **Scope is global or agent, not both.** We need a shared world wiki and
  per-character wikis.
- **Agent-scope vaults resolve to `<vault.path>/<agentId>`.** That cannot target
  `workspaces/<id>/wiki`. Pointing it at `./workspaces` makes the whole
  workspace the vault, and vault init writes `AGENTS.md`, `WIKI.md`, `index.md`,
  and `inbox.md` into the workspace root. `AGENTS.md` there is injected into
  every prompt.
- **`wiki_apply` only creates syntheses or edits metadata.** Quick Impressions
  are prose, so characters would still need `edit`/`write`.
- **The tool surface is out of world.** It talks about vaults, provenance,
  linting, and Obsidian, and costs schema tokens on every turn.

Its real value is player-facing: contradiction and open-question dashboards over
beliefs. Keep our page frontmatter compatible (`pageType`, `entityType`,
`claims`, `relationships`) so an observer-side vault can be compiled later
without touching characters.

The world wiki (`shared/wiki/`) stays Kazusa-owned. The context engine reads it;
characters never write it.

### Drift found in the repo

- Relationship cards live in `memory/relationships/<id>.md`, but sender lookup
  reads `wiki/entities/characters/<id>.md`. In addition, the brain assembly
  passes `[]` as senders (`context-engine/register.ts`). Today a card reaches
  the brain only when its name is literally mentioned.
- Every workspace has OpenClaw-seeded `AGENTS.md` (~6.4 KB of assistant
  instructions) and `USER.md`, which breaks the no-`AGENTS.md` invariant. Set
  `agents.defaults.skipBootstrap: true` and delete them. Confirm the token
  saving with `/context list`.
- `MEMORY.md` carries a "Remembered state" block (location, hunger, energy).
  That duplicates desires and location, and goes stale.
- Personal wiki pages use ad-hoc frontmatter (`wiki_id`, `category`) at the wiki
  root rather than `concepts/` with the documented schema.

## 1. Simulation: how a person remembers

| Phase           | What a real person does                                                                                                                                                                   | Kazusa                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Awake, encoding | Lives everything and writes almost nothing. Consciously notes only what would hurt to forget: a new name, a promise, a shock.                                                             | Ledgers are the episodic buffer (24 h in context). Writing during the day is limited to a new person's card, a plan in `MEMORY.md`, or a revelation. |
| Recognition     | Knows a friend's face instantly, with feelings attached.                                                                                                                                  | Eager injection: contact roster + the sender's Quick Impression. No tool call.                                                                       |
| Recall          | Tip of the tongue, so they try to remember.                                                                                                                                               | `memory_search` over the diary, `MEMORY.md`, and wiki.                                                                                               |
| Sleep           | Unconscious, selective consolidation: keeps what was emotional, novel, goal-relevant, or repeated; keeps the gist, drops detail; revises how they see people; dreams recombine fragments. | One offline consolidation pass when a real sleep starts. It is not a brain turn.                                                                     |
| Broken sleep    | Woken at 3 am, they consolidate poorly and are groggy.                                                                                                                                    | Consolidation is cancelled by a wake; nothing is applied until the next sleep.                                                                       |
| Waking          | Slept on it: calmer or more resolved, maybe a dream fragment, then a glance at today.                                                                                                     | The wake turn sees a refreshed `MEMORY.md` and a dream row in the `:tasks` ledger.                                                                   |
| Forgetting      | Old details fade into a general sense of the person.                                                                                                                                      | Cards keep a current Quick Impression and a capped Interaction Log. Older days survive only in searchable diaries.                                   |
| Wrong beliefs   | Believes gossip, misreads people, holds on to theories.                                                                                                                                   | Belief pages record the source ("Airi told me") and a confidence word. Only experience revises them; canon never corrects them silently.             |

Naps below a threshold don't consolidate.

## 2. Player: what is fun, and where it surfaces

- **Callbacks.** A character mentions something the player said days ago. This
  needs a durable `user:sensei` card injected eagerly in direct chats.
- **Opinions that drift.** After a fight, Kazusa's card on Yoshimi changes, and
  gossip spreads with distortion. This surfaces in the client Wiki/Social view
  as each character's card on a peer, with a nightly diff.
- **The diary.** Each night's gist, in the character's own voice, is the most
  readable artifact we produce. It shows what they never said aloud. Add a
  per-character Diary tab in the client.
- **The morning after.** A different tone, a dream mentioned in chat, a decision
  reconsidered. Timeline event `memory.consolidated`, for example: "Kazusa slept
  23:40–07:10 · rethought Sensei, Airi · new suspicion about Yoshimi · dreamt".
- **Dramatic irony.** The observer sees a belief next to canon ("believes the
  patisserie is closing" vs. the world wiki).
- **Consequences.** Call her at 3 am; the next morning the journal shows
  `interrupted` and nothing new was consolidated.
- **Never fun.** "According to my notes…", or a character announcing that it
  updated its notebook. The prompt forbids citing notes as notes.

## 3. Prompt: what the character sees

### Awake brain (deltas only)

1. **`context-conventions`**: replace the memory paragraph in "Speak and
   remember deliberately" with about 120 tokens:
   > **Your memory.** People and things you know come to mind here when
   > relevant. When something is on the tip of your tongue, `memory_search` it.
   > Speak from memory as a person does, never as someone reading notes. During
   > the day, write down only what you would regret forgetting before you sleep:
   > a new person (start `wiki/entities/characters/<id>.md` with `peer_id`,
   > `name`, `summary` and a `## Quick Impression`), a plan or promise
   > (`MEMORY.md`), or something that changes how you see someone. Sleep sorts
   > out the rest.
2. **Situation message**: `### People you know`, the Tier 2 compact roster from
   card frontmatter
   (`- Airi (@kurimura-airi, close friend): calm, kind clubmate [chat:direct:kurimura-airi]`).
   About 8 tokens per contact, top K by recency. It also removes `list_chats`
   round trips.
3. **Recollections**: pass the pending stimulus senders to `readPersonalWiki`,
   so the interlocutor's Quick Impression is always present.
4. **Tools**: unchanged (`memory_search`, `memory_get`, `read`/`edit`/`write`).
   No `wiki_*` tools.

### Sleep consolidation (new, never shown to the brain)

- **Trigger**: a Taskman `afterCommit` extension hook, alongside `beforeCommit`.
  The new memory module maps its own config
  (`memory.sleep.categories: ["sleeping"]`, `minMinutes: 180`). Taskman stays
  ignorant of what sleep means.
- **Runner**:
  `api.runtime.subagent.complete({ agentId, message, extraSystemPrompt, signal })`.
  It uses the character's own model, makes one tool-free call, and creates no
  session or ledger. It does not occupy `:brain`, so Perception keeps working
  through the night.
- **Instructions**: `shared/skills/sleep-consolidation/SKILL.md`, loaded through
  the SkillLoader, so behavior stays in skills and out of TypeScript.
- **Input**, built by code in one message, about 8–12k tokens:
  - Voice: name and a capped `SOUL.md` excerpt.
  - Bedtime feelings: the desires line.
  - The day: every `:tasks`/chat ledger record since the last consolidation
    watermark (not the 24 h window), in the brain's record format. Drop the
    oldest records first when over budget.
  - `MEMORY.md`.
  - The full card of every peer who appears in the day, plus the titles of all
    other pages.
- **Output**, Zod-validated JSON. Words, never numbers, as with desires:

  ```ts
  {
    diary: string;            // first-person gist of the day
    people: Array<{
      peer_id: string;
      summary?: string;       // <= 120 chars, feeds the roster
      relation?: string;      // "close friend", "rival", …
      quick_impression?: string;
      open_threads?: string[];
      log?: string;           // one line for today
    }>;
    beliefs: Array<{
      id: string; title: string; belief: string;
      source: string;         // "saw it", "Airi told me", "my guess"
      certainty: "sure" | "think so" | "suspect" | "doubt it";
    }>;
    goals?: string[];         // full replacement of ## Long-Term Goals
    plans?: string[];         // carried-forward promises for the coming day
    dream?: string;           // optional fragment, 1–2 sentences
  }
  ```

- **Apply**, in code, with atomic tmp+rename per file:
  - Write `memory/<sim-date>.md` (append if there are two sleeps in a sim day).
  - Merge cards: replace Quick Impression and open threads, append the log line,
    and cap the Interaction Log. Code sets `last_interaction_iso` from the
    ledger.
  - Replace only the `## Long-Term Goals` and plans sections of `MEMORY.md`, and
    drop past `## Plans recorded for <date>` blocks.
  - Store a preimage of every rewritten file, plus the watermark, in a
    `"memory"` keyed store.
  - memory-core's file watcher reindexes the new files.
- **Surface**:
  - A `memory.dream` row in `:tasks` at the sim time the pass finishes (during
    sleep, so ledger order holds).
  - A `memory.consolidated` journal SSE event: agent, sleep window, people
    touched, beliefs added or changed, and whether it was `interrupted`.
- **Waking**: if the deadline stimulus arrives while consolidation is still
  running (likely at high clock speeds), Perception holds it, with a bound,
  until the pass settles. A `WAKE`/`STEER` during sleep aborts the pass.
- **Cost**: about 10k input and 1.5k output per character per night. Daytime
  adds about 270 tokens, and removing `AGENTS.md` saves more than that.

## 4. Phases

1. **Hygiene**: `skipBootstrap`, delete `AGENTS.md`/`USER.md`, disable dreaming
   and the `session-memory` hook, drop the `sessions` source, add
   `extraPaths: ["wiki"]`, move relationship cards to
   `wiki/entities/characters/`, and move the other pages into `concepts/` with
   the schema.
2. **Awake**: senders into `readPersonalWiki`, the contact roster, and the
   conventions "Your memory" section.
3. **Sleep**: the `src/memory/` module (trigger, input builder, schema, applier,
   store, journal, wake hold) and the `sleep-consolidation` skill.
4. **Client**: Diary and Wiki views, and `memory.consolidated` on the timeline.
5. **Later**: an observer-side memory-wiki compile for contradiction and
   open-question dashboards.

## 5. Open questions

- Card `familiarity`/`affinity`/`trust` are 0..100 numbers that an LLM would
  recalibrate nightly with drift. Convert them to ordered words like desires, or
  keep numbers only if the client shows meters?
- Nap threshold: 180 sim minutes?
- Verify that `subagent.complete` supports the `zai/glm-5.2` runtime (it needs
  tool-free isolated inference).
