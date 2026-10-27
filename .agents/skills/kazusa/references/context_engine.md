# Character Context Engine

Perception is a separate in-process attention gate using the Decision Model API,
not a second generative session or a context-engine profile. Its steering
transport still needs a supported host entry point. See
[Perception](perception.md).

Implemented in `plugins/kazusa/src/context-engine/`, registered through native
`api.registerContextEngine("kazusa", ...)`, selected by
`plugins.slots.contextEngine: "kazusa"`. It assembles context; it does not route
stimuli or own brain admission. See [Perception](perception.md).

## Memory layers and session convention

| Purpose                                      | Session key                           |
| -------------------------------------------- | ------------------------------------- |
| Single execution lane                        | `agent:<owner>:brain`                 |
| Task experiences and in-character monologues | `agent:<owner>:tasks`                 |
| Direct conversation                          | `agent:<owner>:chat:direct:<peer-id>` |
| Group conversation                           | `agent:<owner>:chat:group:<group-id>` |

IDs are stable lowercase `[a-z0-9][a-z0-9_-]*`, not display names. Use canonical
keys; do not guess ambiguous legacy `:chat:<id>` keys. Alice and Bob own
separate views of their dialogue; a group's stable ID is shared across its
members' private views. Only record events a character could perceive.

Outgoing chat records use `assistant`, incoming records `user`, including
messages sent by another LLM character. `send_message` owns these writes and
native `__openclaw` sender attribution, derived from the tool caller. See
[the messaging contract](messaging.md) for the exact metadata shape. Perception
and its claiming hook never write chat transcripts.

Every ledger message contains one text block with all readable content and media
summaries, so one native catalog text item equals one experience. All chat
authorship comes exclusively from `__openclaw` metadata projected as
`sender.identity.id`. Self requires that ID to match the owner; native role does
not establish authorship. Missing attribution is `unknown`, including outgoing
items whose metadata OpenClaw 2026.10.5 omits from the catalog. Body prefixes
and direct-chat keys never establish authorship. Task monologues already
represent thoughts; no `:thoughts` stream. Chat/task ledgers are not execution
sessions. `sessions_send` to a ledger would start an unwanted run. Perception
targets `:brain` when appropriate; inbound chat notifications enter through the
claiming hook after their producer has persisted the chat. OpenClaw 2026.10.5
ignores `session.mainKey`, so it cannot rename the default `main` session into
`brain`.

- `SOUL.md`, `IDENTITY.md`, `MEMORY.md`: native workspace bootstrap. Do not
  inject them twice. `MEMORY.md` is curated long-term memory.
- `memory/`: tool-recalled archive, not another eagerly loaded context stream.
  Native `/new` and `/reset` may load daily notes; we do not override that.
  Shared recall configuration lives under `memory.search`.
- Taskman's `tasks` keyed store: scheduling truth and the source of the pinned
  current-activity view. Inject type, description, start, check-in, and status;
  omit internal IDs and metadata. Null explicitly means no activity was chosen.
  Task history and monologues still come from the task ledger.
- The owner's personal wiki: retrieve relevant impressions using the pending
  perception, preserve recorded dates, and inject bounded whole cards as
  subjective recollections. No world-wiki or other-character private retrieval.
- Prior complete brain turns (`recentBrainHistory`): A bounded continuity
  allowance (`brainMaxTokens`, default 2000; can be set to `0` for pure
  stateless ledger-driven runs). Retaining prior turns serves three functions:
  1. **Tool-Loop Atomicity & Error Recovery**: When a tool call errors or fails
     validation, the error is recorded only in `:brain`; ledgers record only
     settled successes. Without brain history, the agent would suffer amnesia
     regarding failed attempts.
  2. **In-Flight Steering Boundaries**: When an urgent stimulus interrupts an
     ongoing turn (`queue.mode = "steer"`), prior brain messages preserve
     in-flight cognitive intent across the steering boundary.
  3. **Reasoning Continuity**: Retains provider-level thinking/CoT blocks for
     models supporting extended reasoning. Settled actions and monologues are
     already recorded in `:tasks` and `:chat:*`; setting `brainMaxTokens: 0`
     eliminates duplicate tool-call text when pure ledger-driven operation is
     preferred.

## Time convention

All Kazusa experience/chat **message timestamps are simulation milliseconds**.
Capture `clock.time()` when the event occurs and pass it as the native
`message.timestamp`. Task transitions/delays and `send_message` follow this
contract. Deferring admission must not change an event's occurrence time.

OpenClaw session `updatedAt`, transcript envelope creation time, and cron `at`
schedules remain wall-clock. Do not replace `Date.now()` globally or alter host
bookkeeping. Read the inner message timestamp, not the envelope timestamp. There
is no reliable conversion of old wall-clock messages using today's clock speed:
pauses, speed changes, and advances destroy that assumption. Existing
untimestamped records are omitted; old wall-clock records are not migrated or
silently retimed. A real migration requires historical clock mapping.

Native brain-run transcript timestamps remain operational host data; the
simulation timestamp contract applies to the character's experience/chat
ledgers, not a global rewrite of every OpenClaw-generated message.

At assembly, capture one simulation instant. Include only records with
`now - shortTermHours * 3_600_000 <= timestamp <= now`. Default/minimum is 24
simulated hours; configure more if desired. Pausing the world freezes this
window; an explicit clock advance moves it. Gateway downtime does not advance
the saved simulation clock.

Each selected record displays its compact simulation timestamp in UTC format
`ddd YYYY-MM-DD HH:mm` (e.g. `Fri 2026-10-23 08:00`). Dropping ISO seconds, `T`,
and `Z` saves token budget across dozens of historical records. A start entry's
timestamp supplies the start time; its text supplies duration and deadline.
Delay text supplies the new deadline and remaining simulated minutes **at that
update**. Subtract elapsed simulation time to infer what remains now. A delay
extends the prior deadline; it is not a duration starting from the update.

A task can outlive the window or lose its ledger start to budget selection. The
pinned current-activity view independently preserves the current commitment. Its
check-in is a cue to reassess progress, not evidence of completion. A later
successful task-tool result supersedes the snapshot.

## Selection and token budgets

Settings under `plugins.entries.kazusa.config.contextEngine`:

| Setting                   | Default | Meaning                                                           |
| ------------------------- | ------- | ----------------------------------------------------------------- |
| `brainMaxTokens`          | 2000    | Maximum recent complete brain turns; unused space goes to ledgers |
| `shortTermHours`          | 24      | Strict simulated-time window; may be increased                    |
| `personalWikiMaxTokens`   | 1200    | Maximum whole personal-recollection cards                         |
| `personalWikiMaxArticles` | 3       | Maximum relevant personal cards                                   |

1. Parse the native assembly `params.sessionKey` for the owner and `:brain`
   suffix. This is the authoritative identity, including tool continuations. Do
   not consult `runtimeContext.sessionTarget` or its store path: the harness may
   omit it. Resolve the owner's store/workspace through native config helpers;
   other sessions receive no private ledger injection.
2. Discover only that owner's task/direct/group ledgers. Read native
   `readSessionTranscriptCatalogPage` pages (`limit: 200`, the host's page
   maximum) newest-first; there is no total history count cap. Follow opaque
   cursors, including across empty pages containing only omitted activity. Stop
   when a dated entry is older than the cutoff. This requires writers to append
   in nondecreasing simulation-time order; backdated imports require a different
   retrieval policy. The reader has no SQL timestamp-bound option. It returns
   ISO timestamps projected from native `message.timestamp`, not envelope
   creation times. Skip undated/invalid timestamps and future items. Retain
   native `SessionCatalogTranscriptItem` objects, keyed by session; reverse each
   stream into append order so equal-time records remain ordered.
3. Filter the simulated-time window. Keep visible text, including authored
   monologues; exclude tool internals, hidden reasoning, and `NO_REPLY`.
4. Budget full `context-conventions`, state-selected `task-lifecycle` (no task
   or overdue) or `task-interrupt` (ongoing), simulation time, and native memory
   guidance. Reserve the pinned current-activity view, then recent whole brain
   turns and bounded whole personal-wiki impressions. Preserve tool pairs and
   recovery summaries. Fail clearly if mandatory additions do not fit; do not
   silently clip instructions. Host handling of assembly errors remains native.
5. Pool task and chat messages, newest-first. Include a whole record if it fits
   the remaining shared budget; otherwise skip it and try older records. Count
   session labels and timestamp/sender wrappers too. Accept the native catalog's
   display normalization/redaction and 6,000-character per-item clipping. Add no
   quotas or further message clipping, extra short-term cap, or busy-chat
   sampling.
6. Regroup selected records by session ID; display each group chronologically.
   This is recency-first packing, not a smallest-message-first knapsack that
   maximizes count at the expense of recent experience.

The engine calls OpenClaw's public `agent-core.estimateTokens` directly. It is a
character-weighted heuristic (including non-Latin text), not a downloaded
model-specific tokenizer. The installed 2026.10.5 runtime omits declarations for
this public export and the transcript runtime; narrowly scoped `.d.ts` shims
describe only the used surfaces and should go when upstream fixes them. Do not
import hashed internal bundles or copy their estimation algorithm.

The host's `tokenBudget` supplies the authoritative assembly budget and performs
final request admission, factoring in model context windows, completion
reserves, prompt overhead, and provider usage. Keep native
`agents.defaults.contextTokens`, `bootstrapMaxChars`, and
`bootstrapTotalMaxChars` for their respective limits. Kazusa does not impose an
artificial token ceiling; it partitions the host-provided `tokenBudget` across
mandatory system additions/current activity, recent brain continuity
(`brainMaxTokens`), bounded personal recollections, and multi-session ledgers.
New tool results can grow the active turn after initial assembly; this is not a
hard per-request token guarantee.

## State-selected skill resolution (SkillLoader)

The context engine always loads `context-conventions` and selects one task skill
from authoritative current-task state: missing/overdue means `task-lifecycle`;
ongoing means `task-interrupt`. Selection does not depend on whether the host
supplies `run.prompt`, and incoming chat content never chooses system
instructions. Skills are full injected bodies, not a hint to read a file.

- **Frontmatter Parsing & Stripping**: Skills use standard YAML frontmatter
  delimited by `--- ... ---`. The loader parses frontmatter using the `yaml`
  library and strips it from the injected body so that the LLM receives only
  clean Markdown instructions.
- **Name Normalization**: Hyphens and underscores are treated interchangeably
  (`task-lifecycle` matches folder `task_lifecycle` or frontmatter
  `name: task_lifecycle`).
- **OpenClaw 1:1 Precedence Hierarchy**: Skills are loaded exactly like OpenClaw
  does.
- **Grouped Layout Discovery**: Discovers skills up to 6 levels deep
  (`MAX_GROUPED_SKILL_SCAN_DEPTH = 6`). When a directory contains `SKILL.md`,
  traversal stops below that directory per OpenClaw specification. Resolves
  based on `frontmatter.name` with fallback to directory basename.
- **Resolution Caching**: Resolves and caches skill paths and parsed Markdown
  bodies in memory; `clearCache()` invalidates for tests.

## Transcript envelope & speaker attribution

The Context Engine packages selected experience records into a single synthetic
user message containing the stream groups directly (e.g. `### tasks`,
`### chat:direct:bob`). Because `context-conventions` already defines the
temporal and operational rules in `systemPromptAddition`, the engine avoids
hardcoding prose or warning banners in TypeScript.

Stream keys are formatted via `formatSessionHeader(sessionKey)` by stripping
`agent:<id>:` (e.g. `agent:alice:tasks` becomes `tasks`,
`agent:alice:chat:direct:bob` becomes `chat:direct:bob`).

Each record inside a session group is formatted by `formatEnvelopeRecord`:

1. **Tasks Stream**: Output is `\n\n[<time>] <text>` (pure factual record, no
   speaker prefix).
2. **Chats of either native role**: Use `sender.identity.id`, projected from
   persisted `__openclaw.senderIdentity`, for direct and group chats. Render
   `(self)` only when that explicit ID matches the ledger owner; otherwise use
   the stable ID. Display labels are not identity.
3. **Missing attribution**: Output is `\n\n[unknown <time>] <text>`. Never infer
   identity from native role, text or the peer address. OpenClaw 2026.10.5 omits
   outgoing sender metadata from its catalog projection, so those entries remain
   unknown until a bounded native reader exposes it. See
   [messaging](messaging.md).

Records within each group are rendered in strict chronological order, even
though they were greedily selected in recency-first order to maximize the
preservation of newest experiences.

## Tier 3 memory guidance (`buildMemorySystemPromptAddition`)

`buildMemorySystemPromptAddition` from `openclaw/plugin-sdk/core` is included in
`systemPromptAddition`. It does **not** inject raw memory entries. Instead, it
injects procedural tool-use instructions for OpenClaw's native Tier 3 archival
retrieval tools (`memory_search`, `memory_get`). If these tools are not present
in `run.availableTools`, the helper evaluates to `undefined` and costs 0 tokens.

## Multi-media and visual perception architecture

OpenClaw supports native multi-media understanding (`tools.media`) and image
inspection (`view_image`). In Kazusa's multi-agent simulation, multi-media
operates under a **grounded semantic preflight + on-demand inspection** model:

1. **Context-Engine Informed Preflight**:
   - When an incoming chat or environmental stimulus contains multi-media (e.g.
     an image attachment `[attachment: id=<uuid> type=image/jpeg]`), the media
     understanding processor must receive the full context assembled by the
     Context Engine (current simulation time, participant identities, spatial
     location, and recent conversation thread).
   - Grounding the vision prompt in the agent's situation ensures semantic
     descriptions capture narrative-relevant details (e.g. "A map of Kivotos
     District 7 with a red marker on Abydos High" rather than generic OCR "A map
     with text").
2. **Text-Only Ledger Representation**:
   - The resulting semantic summary is stored directly in the recipient's
     `:chat:*` ledger as an inline block: `[Image: <description>]` along with
     the attachment identifier/file path, preserving any accompanying user text.
   - Raw image bytes/vision tokens are **never** injected into the character's
     `:brain` context during normal turn assembly. This saves ~1,600–2,000
     tokens per image and keeps context assembly within token budgets.
3. **On-Demand Re-Examination via `view_image`**:
   - If an agent or interlocutor later refers back to the image (e.g. "Wait,
     zoom in on that marker" or "Look at the image again!"), the agent's system
     prompt and available tools provide OpenClaw's canonical
     `view_image(path, prompt)` tool.
   - The agent invokes `view_image` with the cached image path and a specific
     query prompt to inspect the high-resolution image on demand, paying vision
     tokens only during active examination turns.

This is not yet implemented and is planned for future work.

## Tier 2 Social Salience and Eager Contact Roster

In addition to Tier 3 session stream tails (`:tasks`, `:chat:direct:*`,
`:chat:group:*`), the target context engine design incorporates Tier 2 social
salience:

1. **Eager Compact Contact Roster (Working Social Cache)**:
   - **Discovery**: Automatically identifies the most recent $K$ unique
     individuals (configurable via `contextEngine.contactRosterLimit`, default
     `20`) with whom the character has sent or received messages across their
     private direct and group ledgers, or had recorded encounters.
   - **Personal Wiki Resolution**: For each identified peer, looks up the
     subjective card at
     `workspaces/<agentId>/wiki/entities/characters/<peerId>.md`.
   - **Extraction**: Reads YAML frontmatter `name`, `peer_id`, `relation_type`,
     and the concise 1-line `summary` (e.g.,
     `"Music student at Oak Hill Dorm and fellow composer."`).
   - **Context Section**: Injects a compact, high-density roster into the
     prompt:
     ```markdown
     ### Known Contacts (Recent)

     - Bob Moreno (@bob, close_friend): Music student at Oak Hill Dorm.
       [chat:direct:bob]
     - Hifumi Ajitani (@hifumi, acquaintance): Trinity library committee member.
       [chat:direct:hifumi]
     - Sensei (@user:sensei, mentor): SCHALE Advisor who guides students across
       Kivotos. [chat:direct:user:sensei]
     ```
   - Supports both agent peers and human players (`user:` prefix).
   - **Economics & Performance**: A 20-contact list costs only ~150 tokens. This
     completely eliminates the double-turn latency penalty of an agent calling
     `list_chats` or `wiki_search` before sending a message, avoids ID
     hallucinations, and stimulates spontaneous in-character outreach.
   - **Strict Epistemic Isolation**: Contacts are resolved exclusively from the
     agent's **Personal Wiki**, never the omniscient World Wiki
     (`shared/wiki/`), guaranteeing agents never leak awareness of strangers
     they have never met.

2. **Active Peer Impressions**:
   - For the active interlocutor in a 1-on-1 direct chat, the context engine
     eagerly injects their full `## Quick Impression` block (emotional
     sentiment, open conversational threads).
   - In group chats or crowded rooms, the engine calculates salience ($S =
     \text{affinity} + \text{familiarity} + \text{recency}$) and injects
     `## Quick Impression` for only the Top-3 members.
   - Full historical entries (`## Interaction Log`) remain lazy and are
     retrieved only on demand via agent wiki tools.

## Compaction and lifecycle

Windowing selects context without modifying stored history. It does not need an
LLM summary pass. World config sets `agents.defaults.compaction.enabled: false`
to disable proactive threshold compaction and optional maintenance. Native
manual `/compact` and overflow recovery remain available via
`ownsCompaction: false` and `delegateCompactionToRuntime`.

Short cognitive turns should normally fit. A huge tool result, long active turn,
or oversized prompt can still need recovery; disabling all recovery would turn
these into context-overflow failures. Brain compaction does not compact the
separate task/chat ledgers, and disabling it does not stop raw transcripts
growing on disk. Memory consolidation into `MEMORY.md` is a separate future
workflow, not a compaction side effect we rely on.

OpenClaw persists native agent transcripts, including private projections of
canonical messages in the retained `messaging` store. The context engine creates
no additional database or mirror. `ingest`/`commitTurn` have no side effects.
Declare the native current-turn fence and idempotent advancement contract; the
host appends the pending turn after assembled history. Never persist synthetic
memory views back into the source ledgers.

## Skill expansion and future scope

Use the existing `SkillLoader` for names, not ad-hoc paths in routing code.
Behavioral prose belongs in shared skills. Native tool schemas remain tools, not
`kazusa:tool` prose substitutions. Never expand historical conversation markers.
Perception sends trusted task markers; classifier-generated summary text escapes
marker syntax before joining a trusted wake.

Perception compiles its own Decision Model inputs, including current task and
relevant stimuli. It does not use a second context-engine assembly branch. See
[Perception](perception.md) for admission and configuration.

No incognito feature or external chat adapters. Location, desires, grounded
media, social context, and read-receipt sampling remain future work. Keep
routing and stimulus production outside context assembly.

## SDK references

- [Context-engine contract](https://docs.openclaw.ai/concepts/context-engine)
- [Compaction configuration and recovery](https://docs.openclaw.ai/concepts/compaction)
- [Native memory layers](https://docs.openclaw.ai/concepts/memory)
- [Session runtime](https://docs.openclaw.ai/plugins/sdk-runtime/agent)
- [Media overview](https://docs.openclaw.ai/tools/media-overview)
- [Media understanding](https://docs.openclaw.ai/nodes/media-understanding)
- [Chat History RPC](https://docs.openclaw.ai/gateway/protocol/rpc-session-control)
