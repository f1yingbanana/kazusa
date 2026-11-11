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
11. States: loading, empty, unavailable
12. Mobile

---

## 1. Principles

1. **Glance, then peek, then dossier.** Every entity has three zoom levels: a
   row or chip (glance), a hover card (peek) and the inspector (dossier). All
   three come from the entity registry, so every mention of a character, chat or
   place behaves the same way.
2. **Facts and thoughts are visibly different** (D7). The `<Fact>` and
   `<Thought>` components carry this styling. Never style subjective content as
   a fact.
3. **The simulation should explain itself.** When something happens, or fails to
   happen, the UI links to the cause it knows about: the message that woke
   someone, or the task they were in. Don't invent causes.
4. **Detail is opt-in at scale.** With 300 characters, the default views are
   aggregate and filterable. Per-character depth shows up for the selection, the
   watchlist or compare lanes.
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
  encoding _structured_ state only.

  | State          | Source field                          | Rendering                                                                          |
  | -------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
  | Idle           | `status.brain = "idle"`               | thin solid ring, muted                                                             |
  | Thinking       | `status.brain = "thinking"`           | accent arc rotating slowly (respects `prefers-reduced-motion`: static accent ring) |
  | Composing      | `status.composingIn.length > 0`       | accent ring with three-dot notch                                                   |
  | Queued stimuli | `status.queued > 0`                   | small mono count badge at 4 o'clock                                                |
  | Unknown / NPC  | `brain = "unknown"` or `kind = "npc"` | dashed muted ring                                                                  |

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
  "Advance" popover (+15m, +1h, +custom). Forward only. Observer lens only. Each
  control is an action on `POST /kazusa/clock`. Show an optimistic value, then
  reconcile.
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
  its label, an accent bar on the current section, and an optional count badge
  (Chats unread). The ⌘K search icon and the Settings gear sit at the bottom.
  Below `md` the same entries render as a bottom tab bar, Settings last.
- **Settings** is a section like any other: its sidebar lists categories
  (Connection, Models), the stage shows one page of titled blocks, and below
  `lg` the category list is the first screen. World defaults live here;
  per-character overrides live in the inspector, and each side links to the
  other.
- **Section sidebar:** each `StageView` registers its own `sidebar`. There are
  no sidebar tabs, and a sidebar never shows another section's content. Sidebars
  share one toolbar shape: search (the count lives in the placeholder) and a
  single trailing action. A dot marks non-default filters.
- **Below `lg`** the sidebar isn't docked. World and Chats show it as the
  section's first screen until something is opened (with a back button on the
  stage). Timeline opens it as a sheet from a Filters button.

**Chats sidebar:** rows show a presence avatar for DMs (so you see who is
thinking about a reply), last message or a typing shimmer, time, unread.
Trailing action: New group. Observed chats will appear below as a section (needs
`observe`).

**World sidebar (folders):**

- **Fixed folders:** Watchlist (starred characters, a local UI preference) and
  Everyone.
- **Dimension folders:** one per group of the chosen dimension (Affiliation by
  default, Activity, Brain state; Place once location exists). Activity folders
  use the task icon. Each folder shows its count and a live busy hint ("2
  thinking · 1 composing").
- **Filter menu:** "Folders by" dimension and a kind filter (Simulated by
  default, NPCs, Everyone).
- **Search** lists matching characters directly, so jumping to someone never
  needs a folder. Selecting a row sets `sel=character:<id>`.

**Timeline sidebar (filters):** Following (Everyone / Watchlist, plus any
specific characters from "Open in Timeline" as removable chips) and Show (one
checkbox per registered timeline kind; the default set, every kind without
`hiddenByDefault`, means no `tl.kinds` param). Messages are hidden by default:
Chats already shows them, and in the stream they drown out what characters do.
Clear resets everything.

## 5. Stage: World

The folder opened in the World sidebar, as a map or a list (a toggle in the
header, not separate views).

- **URL params:** `world.by` (dimension), `world.in` (open folder: `all`,
  `watch`, or a group key; absent means "nothing opened", which is `all` on
  desktop and the folder list on narrow screens), `world.kind`, `world.as`
  (`map` or `list`; absent means map when grouping by place), `world.plane`.
- **Map:** regions stack a translucent fill, so depth reads as contour lines.
  Roads on foot are solid; anything ridden is dashed. An area's inside opens
  with zoom, and hidden places pass their roads and people to the area around
  them. What's written is decided per zoom on screen pixels (`planLabels`):
  people, then area names, then other places, then travel times, each only if it
  fits. By place, a folder only says where to look: everyone stays on the map.
  By other dimensions, only the folder's members show. Coordinates come from
  each page's `map`, and each plane is its own map; roads to another plane
  aren't drawn. Arrange is explicit, so a stray drag while panning can't move
  anything, and it only changes the picture.
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
- **The list is the Chats section's sidebar**, not part of the view. Below `lg`
  the view shows it as the first screen until a chat is open.
- **Face to face vs. on the phone:** huddles (`type: "huddle"`) are listed first
  under "In person at <place>", and the text chats under "Messages" (no headings
  when there is no huddle). A huddle's header says "In person at <place>", its
  composer reads a message wholly wrapped in asterisks (`*waves*`, `**waves**`)
  as something done, sent as an action without them (`parseReply`; anything else
  is said as typed, and text chats read nothing into asterisks); its placeholder
  says so ("Say something, or _do something_") and a draft that would be sent as
  an action shows in the actions' muted italics. It has no member management
  (people join by speaking and leave by walking away), and someone saying a line
  reads "speaking" (the event's `mode`). Titles come from members when the
  server's title is just a member id (`chatTitle`), so a DM shows the partner's
  name.
- **Actions** (`type: "action"`) are narrated, never bubbled: one line in the
  sender's lane, the name upright and the rest italic ("**Kazusa** leans back.
  She sips her tea."). The text is stored without its subject, the client
  supplies it (`actionLine`), so multi-sentence prose reads naturally, and a
  model that names itself anyway or wraps the line in asterisks does not produce
  a doubled name. A speech run right after the same sender's action skips its
  name header. The list preview narrates actions the same way ("Sensei waves",
  never "You waves") and prefixes group and huddle lines with the speaker.
- **Presence-aware header:** the title and subtitle are plain text; only what
  says where it goes is clickable. A DM shows the partner's avatar (opens them)
  and current activity (task icon, "Reading · 34m left"; typing overrides it). A
  group's subtitle names the members; a huddle's title is the place (a link to
  it) over "In person · names". Groups and huddles show up to four member faces
  with presence rings on the right (hidden below `sm`), each opening that
  person, its tooltip saying what they are doing; "+N" opens the chat. Then one
  contextual action (Add people in a group, Call people over in a huddle, Talk
  in person in a DM when you stand together) and Details (ⓘ), pressed while the
  inspector already shows the chat's subject. Observed chats get faces and
  Details only.
- **The inspector follows the open chat:** opening a chat selects its subject
  (the partner of a DM, otherwise the chat: members with their activity, and a
  huddle's place). It is a quiet selection: below `xl` it does not pop the
  inspector sheet over the chat. Selecting something else afterwards sticks; a
  link that carries both `chats.id` and `sel` keeps its `sel`.
- **Scene or Transcript:** a sent huddle (yours or observed) can be drawn as a
  scene instead of the transcript. Behind the people is the place's backdrop for
  the sim hour; a place without one has no picture, only the app's background
  darkened slightly, and no big place name (the header names it). Only people
  with portraits are drawn: anyone without them never appears and never takes a
  place, and their lines show in the dialogue box under their name, as the
  player's do. A wide scene has five places and an upright one (a phone held
  upright) has one, nothing in between. In the wide scene the figures stand
  balanced about the middle (one in the middle; two either side of it; three in
  the middle three; four skipping the middle; five across), in the same
  left-to-right order; when someone comes or goes the others slide to their new
  places, and nobody moves because someone speaks. With more than five who can
  be drawn, someone not shown who speaks or acts takes the place of whoever did
  so longest ago. On an upright phone the one figure, from the chest up, is
  whoever said the newest line or started speaking last, a change fading across
  in place. Every picture is drawn at one scale, standing on one floor line at
  the scene's foot: the pictures share a canvas, so who is taller or smaller is
  in them, and nobody is enlarged or shrunk to fit, by character or by outfit.
  Whoever's line is in the panel (said or done, still being said or finished) is
  at full brightness for as long as it is there, and everyone else a little
  dimmed, even someone else who is speaking; when the panel's line is the
  player's or someone not drawn, or there is none, nobody is dimmed. Nobody
  grows or steps forward. The scene runs down to the bottom edge; at its foot,
  in one centred column with one left edge, a panel on a flat scrim of the
  background colour holds exactly one line: the newest, under a name plate that
  is always its speaker's, or an action as italic narration without a plate. A
  line being said appears as it is said, word by word at the speaker's own pace
  (a word whole or not at all, a little behind the clock, frozen while it is
  paused), and becomes the line as committed when it lands: whole, or cut short
  with a dash. Someone cutting in takes the panel; the line they cut goes on
  above it and lands there. A line that never lands goes, and the one before it
  comes back. No animated dots anywhere. (A Gateway too old to send the words:
  the panel keeps the previous line until the new one lands whole.) The panel is
  never taller than half the scene; a long line scrolls inside it. The two lines
  said before it float above it as echoes, each small on its own thin scrim with
  its own name, the older fainter, fading about 12 seconds after they left the
  panel (hovering holds them); they never sit between a plate and its words. "N
  behind · Jump to live" appears on the panel's edge while lines wait their
  turn. In your own huddle the panel ends with the reply row: a borderless box
  that grows to about four lines ("Say something, or _do something_"; Enter
  sends, Shift+Enter breaks the line) and Send, the same draft as the
  transcript's box; why nobody answers shows as a slim row just above the panel.
  Someone else's huddle ends its panel with the read-only note instead. People
  walk in and out with a short fade and slide. A **Scene | Transcript** control
  in the header switches (`chats.as`, also remembered as the default); every
  huddle opens as a scene, with or without art, unless the link or that choice
  says Transcript; the buttons only the scene has sit left of it, so it never
  moves. Text chats never show it.
- **Full screen:** while the scene shows, a button left of the switch shows it
  full screen: the backdrop, the people and the panel with, in your own huddle,
  its reply row, so you can keep talking (someone else's huddle keeps its
  read-only note instead). The browser's full screen where it can, else the
  scene laid over the whole window (an iPhone); either way an icon-only exit
  button, in a cluster of icon buttons with tooltips at the top right (Backlog,
  Reading mode, Exit full screen), and Escape leave, and the sim time shows
  quietly in the other corner since the top bar is hidden, with the top bar's
  own clock controls (pause, speeds, advance) beside it for someone who may
  control the clock. A wide screen gets five places, an upright phone one.
  Switching to the transcript, the huddle ending or leaving the chat ends it. It
  is not remembered and not in the link. Backdrops are cropped, never stretched
  or boxed: an upright or near-square scene shows the middle of the picture, a
  wide one a little more of the top than the foot, which the dialogue box
  covers.
- **Backlog:** the transcript over the scene, as a visual novel's backlog: the
  same messages, receipts, stickers and actions, opened at the latest. A
  right-hand panel of readable width over a flat shade of the background (the
  whole scene on a phone), inside the scene, so it works in full screen too.
  Opened by clicking an echo, or by Backlog in full screen's cluster; closed by
  its button, a click on the shade, or Escape, which then does nothing else (it
  does not leave full screen). It never advances anything in reading mode.
- **Reading mode:** an open-book button left of full screen (and in full
  screen's cluster), off by default, offered only to someone who may control the
  clock. While on, new lines do not show as they arrive: they wait for the
  reader. The world runs while nothing waits and pauses while a line waits; a
  paused world is started at 1× when it is turned on, since a line needs the
  world to run. An advance (a click or tap anywhere on the scene but its
  controls, the reply row, the echoes and the backlog, or Space, Enter or →
  outside a text field; the whole scene shows the pointer) shows the next
  waiting line (one that has started being said counts, and shows whole); when
  nothing else waits the world runs again. Asked for with nothing waiting, the
  next line shows the moment it lands, and the panel's corner says in words who
  is thinking or speaking (no animated dots); a breathing caret there says a
  line is ready. Echoes stay until pushed out. A reply first shows what waited,
  is sent, then the world runs. It ends, showing everything that waited and
  putting back the speed it found exactly (paused included), when turned off, on
  switching to the transcript, on leaving the chat or the page, when the huddle
  ends, or when the speed is changed from the top bar or the scene's own clock
  controls (then without setting anything back). It is not remembered and not in
  the link: opening a chat never pauses the world.
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
- **Live tail:** at the bottom, new events auto-append. When scrolled away, a "N
  new events" pill appears, like a chat scroller.
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
  stream component, filtered to one actor and limited to a few rows, with "Open
  in Timeline" applying `tl.actors=<id>`.
- **URL params:** `tl.actors`, `tl.kinds`, `tl.chats`, `tl.compare`, and later
  `tl.at` (replay cursor, see the roadmap).

## 8. Inspector

Entity-polymorphic and deliberately slim. Sections are registry entries. If a
section starts growing tabs, the depth belongs in a stage view instead.

Start from the player's question for each section (the `kazusa` skill §0,
perspective 2): what are they doing, how do they feel, what have they been up
to, who are they. A section that answers none of these, or repeats another one,
does not belong. Prefer one line of facts to a card; icons only where they tell
kinds apart; no system jargon (ids, "stimuli", brain states the presence ring
already shows).

**Character:** the panel answers, without scrolling, who they are, what they are
doing and how they feel. Everything else folds under its title (the inspector
frame's `fold`), with its key fact beside the folded title, and the viewer's
open or folded choice carries over to every character.

1. **Header:** presence avatar (large), name (id on hover), occupation ·
   affiliation (two lines at most), and "NPC"/"Player" only for those kinds. A
   failed turn is one red line, "Latest turn failed: …", whose whole error opens
   on click. Then one row: labeled Message (hidden while their direct chat is
   the one open), and Talk in person (same place) or Go there; Stop only while
   they are thinking; star and a ⋯ menu (Peek at brain, Their chats, Open in
   Timeline) at the end.
2. **Now:** the task as one line (category icon and label, `34m left`; the
   start–end times on hover), the description clamped to two lines (tap to
   expand), the progress bar; then the place on one line (`2h here`, the area on
   hover) and who else is there: one person as their chip ("With <Airi>", which
   selects her), more as up to four faces and "With Airi and 3 others", which
   opens the full list (people they have not noticed are dimmed, "Hasn't noticed
   them" on hover). On a trip, "To <place> · arrives 20:40" and "Near <place>,
   then <purpose>". Then "Writing in <chat>" while composing.
3. **Desires:** background pressure, so it stays quiet: only desires below the
   world's initial state, or ones the current task is moving (accent, target
   tick, trend arrow), get a row: prettified name, a bar segmented at the
   world's state boundaries, and the state word the brain reads. "Nothing
   pressing. All fine or better." when none do; "4 more" / "Show all 7" shows
   the rest (remembered). When each changes ("Rising to full by 07:00", "Turns
   low in 38m") is in the name's hover with the description, never a line of its
   own. Levels are computed on the client from the closed-form record; no
   numbers are shown (they are in the meter's ARIA value).
4. **Recent** (folded; "Task started at 23:15"): the last 3 journal events for
   this actor (`RECENT_KINDS`: the Timeline's defaults minus the `mind` facet,
   so neither messages nor attention bookkeeping), plus "Open in Timeline".
5. **About** (folded; their role): role, traits and aliases (not ones equal to
   the id or name), plus `bodyMarkdown` rendered verbatim in a collapsed block.
6. **Model** (live agents only; folded; the model's name, "(world)" when it
   follows the default): chat model and reasoning level, each saying whether it
   follows the world default or was chosen for this character, with "Use world
   default" to undo a choice.
7. **Memory and context** (live agents only; folded; "Follows the world" or how
   many settings are theirs).

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

| Side  | Item             | Content                                                         |
| ----- | ---------------- | --------------------------------------------------------------- |
| start | Connection       | `● Live` / `◌ Reconnecting…` / `✕ Offline` with last-event time |
| start | Data sources     | `12 live`; click shows the domain matrix (live / unavailable)   |
| start | Activity summary | `12 thinking · 3 composing · 5 queued` from the live store      |
| end   | New events       | `4 new events`, which jumps to the Timeline tail                |
| end   | Shortcuts        | `⌘K` hint                                                       |

Reserved for later: storyteller ticker (salient journal kinds), next scheduled
wakes, token/cost meter (Observer debug), notifications and mentions.

## 10. Scale patterns (100–300 characters)

- Virtualize every list longer than about 50 items: roster, timeline, observed
  chats, tree occupants and the palette.
- Filter and aggregate on the server. The client renders windows.
- Keep high-frequency live state in Zustand with per-id selectors. A delta
  re-renders one row. The clock anchor and sampled time live in a separate store
  so timer ticks do not evaluate entity selectors.
- Use the shared `useSimNow` (minute resolution by default). Rows compute "time
  left" from it without their own intervals.
- Focus sets (watchlist, compare pins, selection) are the only path to
  per-character detail in aggregate views.
- Collapse low-salience runs. Surface high-salience events first in summaries.

## 11. States

- **Loading:** skeleton rows sized like real rows, with no layout shift.
- **Empty:** one sentence explaining why ("No events match these filters") plus
  a reset action.
- **Unavailable:** "Not available from this backend yet", naming the missing
  domain, for example "Needs: timeline". Never a blank panel.
- **Error:** inline alert with a retry. SSE errors surface only in the status
  bar's connection item.

## 12. Mobile

- The stage is full-screen. The view switcher becomes a segmented control in the
  top bar.
- The roster is a left sheet and the inspector a bottom sheet (snap points 50% /
  90%).
- Status items fold into a top-bar overflow menu.
- The timeline overview strip collapses to a thin scrubber. Compare mode is
  limited to 3 pins.
