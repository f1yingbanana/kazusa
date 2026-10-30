# Kazusa Client UX Specification

## Contents

1. Principles
2. Visual language
3. Top bar
4. Section rail and sidebars
5. Stage: World
6. Stage: Chats
7. Stage: Timeline
8. Inspector
9. Status bar
10. Scale patterns (100–300 characters)
11. States: loading, empty, mock, unavailable
12. Mobile

---

## 1. Principles

1. **Glance, then peek, then dossier.** Every entity has three zoom levels:
   a row or chip (glance), a hover card (peek) and the inspector (dossier). All
   three come from the entity registry, so every mention of a character, chat
   or place behaves the same way.
2. **Facts and thoughts are visibly different** (D7). The `<Fact>` and
   `<Thought>` components carry this styling. Never style subjective content
   as a fact.
3. **The simulation should explain itself.** When something happens, or fails
   to happen, the UI links to the cause it knows about: the message that woke
   someone, or the task they were in. Don't invent causes.
4. **Detail is opt-in at scale.** With 300 characters, the default views are
   aggregate and filterable. Per-character depth shows up for the selection,
   the watchlist or compare lanes.
5. **Sim time everywhere.** Use the format `Day 3 · 14:32` and relative
   durations in sim minutes (`34m left`, `12m ago`).

## 2. Visual language

- **Aesthetic:** a neutral, dense, calm instrument panel. Generous line height
  for body copy, tight rows in lists. No decorative illustration in the chrome.
  World imagery (avatars, a future map) supplies the color and personality.
- **Tokens (3–5 colors):** `background`, `surface` (cards, rails), `foreground`,
  `muted` (secondary text, borders), and one `accent`. World metadata may
  override `accent`. Status colors reuse the accent and muted tokens plus a
  single `destructive` for errors. No purple or violet, and no gradients.
- **Type:** Geist (UI and body, ≥ 14px) and Geist Mono (sim times, IDs, counts,
  durations).
- **Presence ring (the signature element):** a ring around every avatar,
  encoding *structured* state only.

  | State | Source field | Rendering |
  | --- | --- | --- |
  | Idle | `status.brain = "idle"` | thin solid ring, muted |
  | Thinking | `status.brain = "thinking"` | accent arc rotating slowly (respects `prefers-reduced-motion`: static accent ring) |
  | Composing | `status.composingIn.length > 0` | accent ring with three-dot notch |
  | Queued stimuli | `status.queued > 0` | small mono count badge at 4 o'clock |
  | Unknown / NPC | `brain = "unknown"` or `kind = "npc"` | dashed muted ring |

  Never derive ring state from task type or description text. Rest or sleep
  appearance arrives only when the backend exposes a structured field.
- **Fact style:** an upright, iconified chip or line in foreground on surface,
  for example `▸ Started reading · 60m`.
- **Thought style:** italic muted text with an attribution prefix ("Alice
  thinks" or a leading avatar) and an optional confidence bar. Inline only,
  never a card.
- **Timeline kinds** are told apart by Lucide icon and label. Don't add a hue
  per kind.
- **Motion:** one restrained entrance for new live events (fade and slide 4px).
  No scattered micro-animations.

## 3. Top bar

From left to right:

- **World title** from world metadata (fallback "Kazusa").
- **Sim clock:** `Day N · HH:MM`, a day-phase label (Morning, Afternoon,
  Evening, Night) derived from sim time, and the date on hover. Mono.
- **Speed controls:** Pause, 1×, 10×, 60× (presets are configurable), plus an
  "Advance" popover (+15m, +1h, +custom). Forward only. Observer lens only.
  Each control is an action on `POST /kazusa/clock`. Show an optimistic value,
  then reconcile.
- **Search (⌘K):** a command palette over characters (fuzzy match on name,
  aliases and affiliation), chats, places (later) and sections. Selecting an
  entity sets the selection without leaving the current section; selecting a
  section navigates. Triggered from the rail's search icon, the top bar on
  phones, or ⌘K / Ctrl+K anywhere.
- **Lens indicator:** "Observer" (a disabled select until the Player lens
  exists).

The top bar never hosts feature-specific controls. Those belong inside their
stage view.

## 4. Section rail and sidebars

Each column narrows the one before it: **rail** (where) → **section sidebar**
(which) → **stage** (what) → **inspector** (details).

- **Rail** (`md` and up): one icon per registered `StageView`, a tooltip with
  its label, an accent bar on the current section, and an optional count
  badge (Chats unread). The ⌘K search icon and the Settings gear sit at the
  bottom. Below `md` the same entries render as a bottom tab bar, Settings
  last.
- **Settings** is a section like any other: its sidebar lists categories
  (Connection, Models), the stage shows one page of titled blocks, and below
  `lg` the category list is the first screen. World defaults live here;
  per-character overrides live in the inspector, and each side links to the
  other.
- **Section sidebar:** each `StageView` registers its own `sidebar`. There are
  no sidebar tabs, and a sidebar never shows another section's content.
  Sidebars share one toolbar shape: search (the count lives in the
  placeholder) and a single trailing action. A dot marks non-default filters.
- **Below `lg`** the sidebar isn't docked. World and Chats show it as the
  section's first screen until something is opened (with a back button on the
  stage). Timeline opens it as a sheet from a Filters button.

**Chats sidebar:** rows show a presence avatar for DMs (so you see who is
thinking about a reply), last message or a typing shimmer, time, unread.
Trailing action: New group. Observed chats will appear below as a section
(needs `observe`).

**World sidebar (folders):**

- **Fixed folders:** Watchlist (starred characters, a local UI preference) and
  Everyone.
- **Dimension folders:** one per group of the chosen dimension (Affiliation by
  default, Activity, Brain state; Place once location exists). Activity
  folders use the task icon. Each folder shows its count and a live busy hint
  ("2 thinking · 1 composing").
- **Filter menu:** "Folders by" dimension and a kind filter (Simulated by
  default, NPCs, Everyone).
- **Search** lists matching characters directly, so jumping to someone never
  needs a folder. Selecting a row sets `sel=character:<id>`.

**Timeline sidebar (filters):** Following (Everyone / Watchlist, plus any
specific characters from "Open in Timeline" as removable chips) and Show (one
checkbox per registered timeline kind; the default set, every kind without
`hiddenByDefault`, means no `tl.kinds` param). Messages are hidden by default:
Chats already shows them, and in the stream they drown out what characters
do.
Clear resets everything.

## 5. Stage: World

The folder opened in the World sidebar. Later, a map renderer registers as an
alternative inside the same view (a renderer toggle), not as a separate view.

- **URL params:** `world.by` (dimension), `world.in` (open folder: `all`,
  `watch`, or a group key; absent means "nothing opened", which is `all` on
  desktop and the folder list on narrow screens), `world.kind`.
- **Header:** folder name, then a mono summary ("15 simulated · 2 thinking").
  The place/map NeedsLine sits on the right until `places` exists.
- **Rows:** the shared ≈44px character row (presence avatar, name, one-line
  activity with task icon, remaining time in mono, star). Virtualized.
- **Buckets:** "No affiliation" and similar (no structured field) and, later,
  "Unplaced" and "In transit". These are honest buckets, not hidden rows.
- Once places exist, place folders set `sel=place:<id>` from the stage header.
- Before the places and location domains are live, the view still works with
  non-spatial groupings, so it's useful on day one.

## 6. Stage: Chats

The existing chat experience (contract in `kazusa/references/client.md`),
rehoused as a stage view.

- **List sections:** **Mine** (the player is a member: composable, typing, the
  current behavior) and **Observed** (all other canonical chats through
  `/kazusa/observe/*`, read-only).
- **Observed chats look different:** an "Observing, read-only" banner, no
  composer, and a muted surface. Nobody should mistake observing for
  participating.
- **List controls:** search, a participant filter (multi-select characters),
  "Live now" (activity in the last N sim minutes), sorted by latest sequence.
  The list is virtualized, since observed chats can number in the thousands.
- **The list is the Chats section's sidebar**, not part of the view. Below
  `lg` the view shows it as the first screen until a chat is open.
- **Face to face vs. on the phone:** huddles (`type: "huddle"`) are listed
  first under "In person at <place>", and the text chats under "Messages"
  (no headings when there is no huddle). A huddle's header says "In person at
  <place>", its composer offers **Say / Do**, it has no member management
  (people join by speaking and leave by walking away), and its typing reads
  "about to speak". Titles come from members when the server's title is just
  a member id (`chatTitle`), so a DM shows the partner's name.
- **Actions** (`type: "action"`) are narrated, never bubbled: one line in the
  sender's lane, the name upright and the rest italic ("**Kazusa** leans
  back. She sips her tea."). The text is stored without its subject, the
  client supplies it (`actionLine`), so multi-sentence prose reads naturally,
  and a model that names itself anyway or wraps the line in asterisks does
  not produce a doubled name. A speech run right after the same sender's
  action skips its name header. The list preview narrates actions the same
  way ("Sensei waves", never "You waves") and prefixes group and huddle lines
  with the speaker.
- **Presence-aware header:** a DM shows the partner's presence ring and
  current activity (task icon, "Reading · 34m left"; typing overrides it). A
  group shows up to three stacked presence avatars and member names. A reply
  that hasn't come yet then has visible context. Tapping the header reopens
  the inspector. Member management (groups only) stays a separate icon
  button.
- **The inspector follows the open chat:** opening a chat selects its subject
  (the partner of a DM, otherwise the chat: members with their activity, and
  a huddle's place). It is a quiet selection: below `xl` it does not pop the
  inspector sheet over the chat. Selecting something else afterwards sticks;
  a link that carries both `chats.id` and `sel` keeps its `sel`.
- Deep links: `view=chats&chat=<chatId>&msg=<messageId>` scrolls to the message
  and highlights it. Timeline rows link here.

## 7. Stage: Timeline

The world journal, designed for hundreds of actors. There are **no default
per-character swimlanes**.

### 7.1 Layout

```text
┌ Facet bar: [Characters ▾ 3] [Kinds ▾ task, chat] [Chats ▾] [Watchlist only] [Compare ▸] ┐
├ Overview strip: stacked histogram of events per bucket across the loaded range;   ┤
│ drag/click to jump; current viewport window highlighted                              │
├ Event stream (virtualized, newest at bottom, sticky day/hour headers)               ┤
│ Day 3                                                                                │
│ 14:00 ───────────────────────────────────────────────────────────────────────────── │
│ 14:02  ▸ [avatar Alice] Started reading · 60m · "Counterpoint, Ch. 4"               │
│          Alice thinks: just one more chapter before the seminar…                     │
│ 14:05  ✉ [Bob] → [Group: Study Hall] "anyone at the library?"          open chat ›  │
│ 14:10  ⋯ 12 characters started sleeping (14:05–14:10)                     expand ▾  │
│                                                       [ 4 new events ↓ ] (live pill) │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Behavior

- **Data:** `useSWRInfinite` over `GET /kazusa/timeline?before=` (scrolling
  back), plus live `journal` events appended at the tail. Filters map 1:1 to
  query params (`actors`, `kinds`, `chats`). The server filters; the client
  doesn't download everything and filter locally.
- **Live tail:** at the bottom, new events auto-append. When scrolled away, a
  "N new events" pill appears, like a chat scroller.
- **Overview strip:** from `GET /kazusa/timeline/histogram` with the same
  filters. It scales with time range, not character count.
- **Collapsing:** consecutive events with the same `collapseKey` (low-salience
  kinds such as identical task starts) merge into one expandable summary row.
- **Row anatomy:**
  - sim time (mono), kind icon, and actor chips (max 3, then `+n` that opens a
    popover)
  - the `fact` line
  - an optional `thought` line in thought style
  - an optional target link (opens a chat at the message, or selects an entity)
- **Compare mode:** pin up to 8 characters (the watchlist is a preset). A Gantt
  of task bars for the visible time window appears above the stream. Lanes are
  only for the pinned set, so this stays cheap at any world size.
- **Inspector integration:** the inspector's "Recent" section is this same
  stream component, filtered to one actor and limited to a few rows, with
  "Open in Timeline" applying `tl.actors=<id>`.
- **URL params:** `tl.actors`, `tl.kinds`, `tl.chats`, `tl.compare`, and later
  `tl.at` (replay cursor, see the roadmap).

## 8. Inspector

Entity-polymorphic and deliberately slim. Sections are registry entries. If a
section starts growing tabs, the depth belongs in a stage view instead.

Start from the player's question for each section (the `kazusa` skill §0,
perspective 2): what are they doing, how do they feel, what have they been up
to, who are they. A section that answers none of these, or repeats another
one, does not belong. Prefer one line of facts to a card; icons only where
they tell kinds apart; no system jargon (ids, "stimuli", brain states the
presence ring already shows).

**Character:**

1. **Header:** presence avatar (large), name (id on hover), occupation ·
   affiliation, and "NPC"/"Player" only for those kinds. Icon buttons:
   Message (DM) and star.
2. **Now:** the task (category and times on one mono line with `34m left`,
   description clamped to three lines, tap to expand, progress bar), then
   where: the place with its area and how long they have been there, and who
   else is there (people they have not noticed are dimmed, "Hasn't noticed
   them" on hover); or, on a trip, "To <place> · arrives 20:40" and "Near
   <place>, then <purpose>". Then "Writing in <chat>" while composing.
3. **Desires:** one row per catalog desire in catalog order: prettified name
   (description on hover), a bar segmented at the world's state boundaries, and
   the state word the brain reads. Desires are background pressure, not a
   chore list, so the section stays quiet: the lowest state is emphasized, a
   desire the current task is moving gets the accent, a tick at its declared
   target and `→ full by 07:00`, and one forecast line names the next state
   drop among desires nothing is raising ("Satiety turns low in 38m"). That
   answers both "why did she pick this task?" and "what will she want next?".
   Levels are computed on the client from the closed-form record; no numbers
   are shown (they are in the meter's ARIA value).
4. **Recent:** the last ~5 journal events for this actor (`RECENT_KINDS`: the
   Timeline's defaults minus the `mind` facet, so neither messages nor
   attention bookkeeping), plus "Open in Timeline".
5. **About:** role, traits and aliases (not ones equal to the id or name),
   plus `bodyMarkdown` rendered verbatim in a collapsed block.
6. **Model** (live agents only): chat model and reasoning level, each saying
   whether it follows the world default or was chosen for this character,
   with "Use world default" to undo a choice.

The player's chats with a character are one tap away through Message and the
Chats list, so there is no Conversations section.

**Chat:** type ("Group chat", "In person at <place>"), members as roster rows
with their activity, "Open in Chats" unless it is already open.

**Place:** area breadcrumb above the name, summary, aliases, description
(collapsed), "Open in World"; Here now / Inside / On the way here; Getting
around (parent, children, connections). Place chips inside place lists drop
their pin.

## 9. Status bar

A slot registry for small global signals. It never holds controls that change
simulation state.

First-draft items:

| Side | Item | Content |
| --- | --- | --- |
| start | Connection | `● Live` / `◌ Reconnecting…` / `✕ Offline` with last-event time |
| start | Data sources | `2 domains mocked`; click shows the domain matrix (live / mock / unavailable) |
| start | Activity summary | `12 thinking · 3 composing · 5 queued` from the live store |
| end | New events | `4 new events`, which jumps to the Timeline tail |
| end | Shortcuts | `⌘K` hint |

Reserved for later: storyteller ticker (salient journal kinds), next scheduled
wakes, token/cost meter (Observer debug), notifications and mentions.

## 10. Scale patterns (100–300 characters)

- Virtualize every list longer than about 50 items: roster, timeline, observed
  chats, tree occupants and the palette.
- Filter and aggregate on the server. The client renders windows.
- Keep high-frequency live state in the keyed live store with per-id
  subscriptions. A delta re-renders one row.
- Use a shared minute-resolution `useSimNow`. Rows compute "time left" from it
  without their own intervals.
- Focus sets (watchlist, compare pins, selection) are the only path to
  per-character detail in aggregate views.
- Collapse low-salience runs. Surface high-salience events first in summaries.
- The mock world generates ~150 characters across ~10 affiliations, so every
  surface is built against realistic density.

## 11. States

- **Loading:** skeleton rows sized like real rows, with no layout shift.
- **Empty:** one sentence explaining why ("No events match these filters")
  plus a reset action.
- **Mock:** a small `Mock` tag in the panel header and an entry in the
  status-bar data-source matrix.
- **Unavailable:** "Not available from this backend yet", naming the missing
  domain, for example "Needs: timeline". Never a blank panel.
- **Error:** inline alert with a retry. SSE errors surface only in the status
  bar's connection item.

## 12. Mobile

- The stage is full-screen. The view switcher becomes a segmented control in
  the top bar.
- The roster is a left sheet and the inspector a bottom sheet (snap points
  50% / 90%).
- Status items fold into a top-bar overflow menu.
- The timeline overview strip collapses to a thin scrubber. Compare mode is
  limited to 3 pins.
