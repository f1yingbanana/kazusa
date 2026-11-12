# Status: Values and States on Characters and Places

Status (2026-11-11): design sketch, nothing built. Written while designing the
visual novel view
([visual-novel](../../kazusa-client/references/visual-novel.md)), which needs to
know what a character is wearing. It is not that view's focus; this note exists
so the view, stickers and later features hook into one system instead of each
inventing its own field.

## 0. What it is

A **status** is a named value or state attached to something in the world, that
both code and characters can change and that other modules read.

| Example            | On                              | Kind   | Changed by                           | Read by                                  |
| :----------------- | :------------------------------ | :----- | :----------------------------------- | :--------------------------------------- |
| `outfit`           | a character                     | state  | the character, at an activity change | the Scene view, stickers, people present |
| `relationship`     | one character's view of another | value  | code (events), the character, sleep  | the context engine, the Social view      |
| a place's `state`  | a place (`festival`, `closed`)  | state  | the operator, later world events     | backdrops, Location's descriptions       |
| `injured`, `money` | a character                     | either | a world's own rules                  | whatever that world builds               |

What it is not:

- **Not presence.** `CharacterStatus`, the SSE `status` event and the `status`
  capability domain already mean brain state, task and typing. To avoid a third
  meaning, the code name here is **`attributes`** (`src/attributes/`, store
  `"attributes"`, SSE `attributes`, domain `attributes`). "Status" stays the
  word people say.
- **Not desires, location or tasks.** Those keep their modules. A desire is a
  value with a drain and a closed form; it could be re-expressed as an attribute
  one day, and nothing here depends on that.
- **Not memory.** What a character believes about someone stays prose in their
  wiki. An attribute is machine state.

## 1. Simulation, player, prompt

**Simulation.** Clothes change at the boundary of an activity and stay on until
the next change; everyone present sees them. How warmly someone regards another
moves a little with each thing that happens and is private. A place's condition
changes rarely and is visible to all who stand there. Three shapes: on a
character, on a pair, on a place.

**Player.** Seeing someone turn up at the gym in gym clothes. A sticker that
matches what they have on. A chip in the inspector that says so, as a fact. A
timeline line when it changed.

**Prompt.** State words, never numbers, as desires do. A character reads only
what differs from the ordinary, in one short line, after the records (anything
that depends on state must come after them: the provider cache reuses a request
only up to its first changed token).

## 2. Mechanics

### 2.1 Catalog

Per world, in the plugin's config (`attributes.catalog`, set from a world's
`kazusa.config` like `desires.catalog` and `taskman.categories`). Each entry:

| Field         | Meaning                                                                                                             |
| :------------ | :------------------------------------------------------------------------------------------------------------------ |
| `name`        | `^[a-z][a-z0-9_]*$`, shown to models and used as a key.                                                             |
| `on`          | `character`, `place` or `pair` (owner → other; directed).                                                           |
| `kind`        | `state` (one of a list) or `value` (0..100, read as a state word through `levels`, like desires).                   |
| `description` | The one semantic contract, delivered once where the character sets it.                                              |
| `states`      | For `state`: a list of `{ name, description }`, or a source per subject (`outfit` takes a character's own outfits). |
| `initial`     | What a subject with no record has.                                                                                  |
| `setBy`       | Any of `character`, `code`, `operator`.                                                                             |
| `shown`       | Who reads it: `self` (their own situation), `present` (people standing with them), neither (code and client only).  |

`outfit` is built in: `on: character`, `kind: state`, states from the
character's declared outfits (today `stickers.json` `outfits`) plus their usual
clothes, `initial` usual, `setBy: character, operator`, `shown: self, present`.

### 2.2 Storage

One keyed store, `"attributes"`, one record per subject: `character:<id>`,
`place:<id>`, `pair:<owner>:<other>`. A record is
`{ [name]: { value, since, by } }`. No record means `initial`. Every write goes
through one `write` that notifies listeners, as Desires does, so SSE and any
dependent module hear each change once. Never Markdown, never a ledger.

A place's attribute is inherited down the `parent` tree unless a child sets its
own, so a festival declared on a school reaches its rooms.

### 2.3 Who changes it, without new model calls

Cost is the constraint: no feature here may add a model or decision call.

- **The character**, in a call they already make. An attribute with
  `setBy: character` is a Taskman `TaskExtension`: one optional parameter on
  `start_task`, listing only what changes (the pattern of Desires'
  `afterwards`). Changing clothes is an activity boundary, so this is also the
  right moment in the simulation. Same-state values are dropped silently; an
  unknown value is dropped with a note in the result, never a failed call (a
  refusal costs a whole retry). The change is a `note` on the ledger row
  ("changes into …") and a field in its journal payload.
- **Code.** Any module calls `attributes.set(subject, name, value, { by })`.
  Catalog rules (`resetOn`, drift) can come later; start with explicit calls.
- **The operator and the system agent.** RPC `attributes.get` /
  `attributes.set`, `POST /kazusa/attributes/set` (`manage`), and a tool the
  system agent has through its plugin allowlist.
- **Sleep.** The nightly memory run already rewrites relationship pages; it can
  return recalibrated pair values in the same output.
- **A judgment**, only as one more question in a decision already being made.
  Never a call of its own.

The parameter's schema must not depend on current values: tool definitions sit
at the start of the cached prefix. An enum of all of a character's outfits is
stable; "the outfits other than the one worn" is not.

### 2.4 Who reads it

- **Modules**: `attributes.of(subject, at)`, passed as a provider where needed,
  like `feelings` and `whereabouts`.
- **The character**: one line in the situation message for `shown: self`
  attributes that are not at `initial` ("You are wearing …").
- **People present**: Location's "With you" line adds `shown: present` states
  that are not at `initial`, in words from the catalog or the outfit's
  description.
- **The client**: `GET /kazusa/attributes` and SSE `attributes` (one record per
  write), schemas in `@kazusa/client`, an inspector section in fact styling
  (tool-grounded state). Pair values are a character's private view and go
  through the lens layer.

## 3. Consumers

- **The Scene view.** A figure's look is `{ outfit, mood }`: `outfit` from here,
  `mood` from the face a line was said with. A place's `state` picks among a
  backdrop set's pictures (`[<state>-]<time>`). Until this exists everyone wears
  their usual clothes and every place is in its default state, which is exactly
  what "no record means `initial`" gives.
- **Stickers.** With an outfit in state, a sticker can be picked by mood alone
  and resolved against what the character has on (`<outfit>-<mood>`, else
  `<mood>`). That shrinks the sticker enum from every name (about 80 for the
  largest imported sets) to the distinct moods (about 20). A change to
  Messaging's sticker bubble, to weigh when `outfit` lands.
- **Decisions.** State words are cheap evidence for attention, pace and floor
  judgments, in the context those calls already send.

## 4. Relationship values and the wiki card

Decided (2026-11-11): relationship values never live in frontmatter, and they
are not a fixed pair of numbers.

- **Not frontmatter.** A card is the character's words about a person
  (`relation`, open threads, what they think of me). Memory already enforces
  this: `memory/page.ts` reports `familiarity`, `affinity` or `trust` in a
  card's frontmatter as a problem, and [memory](memory.md) says people pages
  carry no such numbers. [file_schemas](file_schemas.md) §4.1 predates that and
  its three number fields are marked deprecated.
- **Generic.** Which values exist between people is the world's choice, declared
  in the catalog as `on: pair` attributes, like any other. A school world may
  want warmth and trust; another may want loyalty, fear or debt. Nothing in code
  names `affinity` or `trust`.
- **Stored as pair attributes** (`pair:<owner>:<other>`), directed, private to
  the owner, read as state words.
- `familiarity` stays what it is: a retained store computed from use, not an
  attribute anyone sets.

They deserve a design of their own before anything is built, because the hard
questions are not storage: what moves a value (which events, how much, judged by
whom without a new call), how it relates to the card's words when the two
disagree, what a character reads of it, how an owner's value toward the player
is shown, and how the Social view draws asymmetry. That design is not this
note's; this note only fixes where the values will live and that they are
generic.

## 5. First slice

Only `outfit`, end to end: the built-in catalog entry, the store, the
`start_task` parameter for characters who have outfits, the "With you" and
situation lines, the read route and SSE, and the Scene view and stickers reading
it. Everything else in this note waits for a feature that needs it.

## 6. Open

- The code name (`attributes`), and whether `stickers.json` `outfits` moves to a
  file that portraits and stickers both read.
- Whether a character may change an attribute outside an activity change (a
  bubble field on `send_message`, for something that changes mid-conversation).
- Rules in the catalog (reset on sleep, drift toward a rest value) versus code
  per attribute.
- Relationship values: their own design (§4). Where they live is settled.
