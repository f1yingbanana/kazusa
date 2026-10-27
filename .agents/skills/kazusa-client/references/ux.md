# Kazusa Client UX Specification

## Contents

1. Principles
2. Visual language
3. Top bar
4. Roster rail
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
- **Search (⌘K):** a command palette over characters (all 300, fuzzy match on
  name and aliases), chats, places and views. Selecting an entity sets the
  selection; selecting a view navigates.
- **Lens indicator:** "Observer" (a disabled select until the Player lens
  exists).

The top bar never hosts feature-specific controls. Those belong inside their
stage view.

## 4. Roster rail

- **Virtualized** list of characters from `/kazusa/characters`, with live
  status from the live store.
- **Header controls:** search, a kind filter (Simulated by default, NPCs,
  Everyone), group-by (None, Affiliation, Activity type, Brain state; Place
  once location exists) and sort (Recently active, Name, Ending soon).
- **Watchlist:** starred characters pinned in a section at the top. Stored in
  local preferences (a UI preference, not simulation data).
- **Row anatomy (≈ 44px):** presence avatar, name, one-line activity
  (`task.description` truncated; `type` as an icon tooltip), and remaining time
  in mono (`34m`). A composing indicator appears when composing.
- **Group headers** show counts ("Library · 12") and collapse.
- **Collapsed mode:** an avatar strip with presence rings. Tooltips show name
  and activity.
- **Keyboard:** ↑↓ move, Enter selects, `s` stars, `/` focuses search.
- Selecting a row sets `sel=character:<id>`. It never changes the stage view.

## 5. Stage: World

A first-draft **tree renderer**. Later, a map renderer registers as an
alternative inside the same view (a renderer toggle), not as a separate view.

- **Group-by dimension**, owned by the view (`world.group`): Place hierarchy
  once places and location exist; until then, Affiliation or Activity type.
  The same tree component renders any dimension.
- **Node anatomy:** name, kind icon, occupant count, and (for places) a
  structured status chip (`OPERATIONAL`, `CLOSED`, …). Expanding a node lists
  occupants with the roster row component.
- **Buckets:** "Unplaced" (no structured location) and, later, "In transit".
  These are honest buckets, not hidden rows.
- Selecting a place node sets `sel=place:<id>`. Selecting an occupant sets
  `sel=character:<id>`.
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
- **Presence-aware header:** members as presence avatars, plus each member's
  current activity ("Reading · 34m left") as fact chips. A reply that hasn't
  come yet then has visible context.
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

**Character (first draft):**

1. **Header:** presence avatar (large), name, role or occupation, affiliation,
   kind (Simulated, NPC, Player), star toggle.
2. **Now:** current task as a fact card (type icon, description, started, ends,
   progress bar, `34m left`), brain state, the chats being composed in.
3. **Recent:** the last ~5 journal events for this actor (the Timeline
   component), plus "Open in Timeline".
4. **Conversations:** chats this character is in, with a live dot. Click opens
   them in Chats (observed if the player isn't a member).
5. **Profile:** frontmatter fields (aliases, traits, role) as key/value facts,
   plus `bodyMarkdown` rendered verbatim in a collapsed block.

**Chat:** members (presence avatars with activity), type, created, latest
activity, "Open in Chats".

**Place (when the places domain exists):** structured status, allowed
activities, connections (rendered from frontmatter), occupants, recent events
there.

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
