# The rebuild on ui-sdk (in progress)

Read before touching `apps/web/ui/`, `apps/web/features/` or `app/halo/`.

The whole UI is being rebuilt on [ui-sdk](https://ui-sdk.dev) to move off
shadcn. It is served at `/halo` until it's done, then `app/halo/page.tsx`
replaces `app/page.tsx` and the old UI is deleted. Three layers, kept apart by
`no-restricted-imports` in `apps/web/eslint.config.mjs`:

```text
ui/                      # our component library: generic, no Kazusa data
  theme.css              # palettes on <html data-palette>, --ui-* tokens, light/dark
  tailwind.css           # Tailwind theme: ui-* colours, shadow-ui, animate-ui-*
  palettes.ts            # the palette list (stable values, shown labels, swatches)
  cx.ts                  # class joining with tailwind-merge
  <name>.tsx             # one component (or family) per file, wrapping ui-sdk parts
  canvas*.ts(x)          # pannable canvas: ui-sdk createViewport + spatial roving focus,
                         #   with a camera that flies (van Wijk), glides (springs) and
                         #   coasts after a fling; reduced motion jumps. The world map uses it
features/                # the app, built from ui/ and lib/ + hooks/
  shell/                 # frame, top bar, clock, section nav, command palette, details panel
  characters/ places/ chats/ world/   # one folder per kind of thing
  legacy.ts              # the only import of components/: what is left to port
  legacy.css             # maps --ui-* onto the shadcn tokens the borrowed pieces read
app/globals.css          # the one Tailwind build: tailwindcss, ui/tailwind.css, shadcn.css
app/shadcn.css           # everything the old UI needs from Tailwind; goes with components/
app/halo/                # the route; loads legacy.css and the font
```

- **ui/** imports only React, ui-sdk, lucide and tailwind-merge (in `cx.ts`). No
  `@/`, `@kazusa/*`, nuqs, SWR, Zustand or sonner. Components take plain props
  (`presence`, `name`, `src`), never ids to look up. Never mention a franchise
  or a style name.
- **features/** imports components from `ui/`, never `@ui-sdk/*` directly; add
  or extend a `ui/` component instead. It reaches the old UI only through
  `features/legacy.ts`. Porting a piece means moving its logic into `lib/` or
  `hooks/` and its view into `ui/`/`features/`, then deleting its line there.
- **components/, lib/, hooks/** never import `ui/` or `features/`.
- Style with Tailwind classes, keyed on ui-sdk's state attributes. Use only what
  survives deleting `app/shadcn.css` (ESLint rejects the rest): the `ui-*`
  colours (`bg-ui-surface`, `text-ui-soft`, `inset-ring-ui-line`), `shadow-ui`,
  `animate-ui-*`; `rounded-full` or an exact `rounded-[1rem]`, never the named
  radii shadcn rescales; bracket state variants (`data-[checked]:`,
  `data-[open]:`), never the bare ones shadcn redefines; no `font-sans`/
  `font-mono`, tw-animate or shadcn utilities. Give every `border` a colour,
  since shadcn's base layer supplies one today. Join classes with `cx` from
  `ui/cx.ts` so a caller's class wins. Size icons with `[&_svg]:size-4` on the
  parent.
- Finishing the move: delete `components/`, `features/legacy.*`,
  `app/shadcn.css` and its import in `app/globals.css`, and shadcn's packages
  (keep `tailwind-merge`); move `app/halo/` to the root. Nothing in `ui/` or
  `features/` changes.
- Before using ui-sdk, follow the `ui-sdk` skill and read
  `node_modules/@ui-sdk/react/docs/llms.txt`, then the page for each component
  you use (`docs/components/<name>.md`). To build a component ui-sdk doesn't
  ship, also search `docs/core.md` by heading (it's over 300 KB; don't read it
  whole) and read `docs/rendering.md` next to it.
- §7 describes the old UI's look. The new look (rounded type, two-hue palettes,
  presence rings) lives in `ui/theme.css` and the component modules.

## Texts in Chats, talks in World (2026-11-24)

The new UI splits conversations by how they're held:

- **Chats is your phone**: DMs and groups only (`features/chats/`). The list
  leaves huddles out; `chats-stage.tsx` sends any link to one (`chats.id` of a
  huddle, `chats.talk`) to World instead.
- **World holds what's said face to face**: a huddle opens over the map
  (`world.talk=<chatId>`, `world.as` scene or list, `world.with=<characterId>`
  to start one where you stand), opening as a circle widening from where it was
  picked (`talk-origin.ts`) and closing back there; the map stays mounted
  beneath. Who's where shows a card per talk at the top of its room
  (`talk-card.tsx`, `talksByPlace` in `talks.ts`, tested), the place details
  show it too, and the map marks the place with a speech badge.
- Route every "open this conversation" through `conversationPatch` in
  `features/chats/open.ts`; spread `conversationParsers` into `useQueryStates`.
- The rail's unread badges follow the split (`features/shell/unread-badges.tsx`).
- Built on ui-sdk: `ui/scroll-log.tsx` (Scroll Area with `stickToEnd` and
  Jump to latest), `ui/message.tsx` (runs, bubbles, narration, receipts, typing
  dots), `ui/composer.tsx` (Textarea `autoResize`, Enter to send),
  `ui/line-actions.tsx`, `ui/conversation-card.tsx`. The send pipeline is
  `features/chats/use-conversation.ts`; `hooks/use-composer.ts`,
  `hooks/use-long-press.ts` and `lib/source/chats/runs.ts` are shared with the
  old UI.
- Never animate a transform on, or around, a Scroll Area while it opens: it
  measures its end by geometry and lets go of `stickToEnd`. Entrances there are
  opacity or `clip-path` only (`animate-ui-thread-in`, `animate-ui-iris-in`).
- Chats lists texts newest first under one filter: Yours / Everyone / Favorites
  (`chats.show`) while playing, everyone's while watching. Search also matches
  the people in a chat, so there is no person button; a character's "Their
  chats" sets `chats.member`, shown as a chip. Others' rows carry an eye; there
  is no "Overheard" section.
- New chat (`features/chats/new-chat.tsx`) only picks people: Here with you,
  Everyone, Offstage; two or more offer an optional group name (sent as the
  draft's `title`). Picked chips stay one row that scrolls sideways to the
  newest, so the list keeps its room. Empty open groups for Discord are made in Settings → Chat
  apps (`NewChannelGroup`), where that intent lives.
- The chat panel: rename in place, People with Add (`ui/pick-list.tsx`) and
  remove, a Sharing fold (Open to join, Discord channel) for the owner, and
  Leave (just "Leave") in the actions row's More menu, a `danger` Menu item,
  behind an Alert Dialog. Character, place and chat panels share that More pattern; a place's
  holds its wiki page, and it shows no aliases or Description fold. Being alone is said once, at the end of the
  transcript, with the panel's own copy (`aloneCopy`); the composer is the same
  in every chat.
- World's sidebar is one list, place by place (`rankRooms`: where you are,
  speaking now, latest talk, fullest), laid out as the room is
  (`features/world/place-people.tsx`): each talk a `ui/talk-group.tsx` holding
  its people as ordinary person rows, its latest line at the foot opening it,
  then everyone else. A person is in at most one talk, so nobody shows twice.
  Rows say what someone is doing, never who they're with (the map marker does).
  All / Talking / Favorites (`world.show`; Chats has Yours / Everyone /
  Favorites, `chats.show`, with the same empty state, `NO_FAVORITES`; Favorites keeps the watchlist's
  people and everyone in a talk with one, and the panel's menu says
  "Favorite"); search covers people, places and the last line. Order: where
  you are and places with talks, then On the way, then places where people
  only stand, then Somewhere. No onstage count. "On the map" (place panel, a
  place heading) closes any talk and flies there, even to the place already in
  the link (`map/show-on-map.ts` counts the presses). The place panel's Here now is the same component.
- Map islands fade by `fill-opacity`/`stroke-opacity` (`animate-ui-ink-in`),
  never by a group's `opacity`: zoomed in, an island is tens of thousands of
  pixels wide, and group opacity paints it offscreen whole, which flashed the
  screen blank.
- The scene, backlog (a ui-sdk Drawer: top layer, so it shows in full screen),
  full-screen controls (the top bar's Clock) and screenshot tools are ported to
  `features/world/scene/` and `features/chats/screenshot/`; their logic hooks
  moved to `hooks/` (`use-reading-mode`, `use-scene-fullscreen`,
  `use-said-text`). `talk-view.test.ts` is the old scene suite on the new views.
  The backlog is the transcript and is called that: in the header the Scene |
  Transcript switch is the way to it; in full screen a Transcript button
  opens the drawer. Reading mode and Full screen swell and fade in place with
  the scene (`ui/reveal.tsx`: they keep their room, inert while away). The speaker's plate is ink, not primary. Face to
  face, a `*` typed into the empty box brings its close (`ComposerBox` `closes`).
- No notification inbox or message toasts: unread counts on the section rail
  (Chats for texts, World for talks) are the one signal. A tiered bell was
  built and dropped (2026-11-25) as a second source saying the same thing.
- Panels read at one heading level: every section is a `DetailSection` (a
  hairline and a bold title, with a count or action at the end), the same
  band as a `Fold`. The character panel goes About, Right now
  (`features/characters/right-now.tsx`: task, place, who's with them, a line
  each), How they feel, then folds. Panel parts never shrink (`Detail`).
- Popovers, menus and hover cards grow from their trigger's side and settle
  back on close (`ui/popup.ts`, ui-sdk's `data-starting-style` /
  `data-ending-style`). A sideways-scrolling row fades only the ends with more
  past them (`--ui-fade-start`/`--ui-fade-end`, registered so they ease).
- Map motion is a street map's: places, area names and count bubbles fade in
  and out where they stand (`ui/canvas.tsx` items fade in on mount; there is
  no grow-from entrance). Only things with somewhere to be travel: a face
  glides to its new seat on one curve (place and seat both 450 ms, no
  overshoot), and travellers keep pace with the clock. A place that shows
  keeps showing as you zoom in: `revealAt` settles zoom bands (`REVEAL_STEP`
  = 2, like a street map's zoom levels) from the widest up, each keeping what
  the last showed before anything new claims room (what fit still fits, as
  points spread and markers don't grow). Room needed: 28 px a marker, 8 px
  either side of a name, areas open at 120 px wide. The map asks at its band's lower
  edge (`revealBand`), so zooming slowly, places arrive and faces regroup
  together once per doubling, not a few at every camera step. Highlighted
  routes ink in whole by stroke opacity: a dash drawn along a road with
  `pathLength` is measured on screen under `non-scaling-stroke` and stops
  short.
- A talk open when World mounts (back from another tab, a reload, a link) is
  simply there; only one opened while World shows plays the iris.
- Scene and transcript share the reply box's geometry (`COMPOSER_DOCK`, the
  flat box keeps the pill's padding, the panel the pill's radius), so it sits
  on the same pixels in both. The switch is a view transition: the dialogue
  panel and the transcript's reply box share `talk-reply`, pinned to the
  bottom and clipped flush only at the top (room for the shadow elsewhere), so
  the panel folds into the box (or grows out of it) while the rest
  crossfades. The speaker's plate sits outside the panel, so it has its own
  name (`talk-reply-plate`) and rides the panel's top edge: an empty stand-in
  on the transcript's reply box (after it, so it paints above) marks where it
  starts or lands. Without view transitions, or with reduced motion, it just
  switches.
- The map's backdrop is two SVG patterns of pluses (`gridAt` in
  `ui/canvas-primitive.ts`): main marks every 100 to 500 px across each
  five-fold of the zoom, fine ones splitting that by 5 and fading and swelling
  in, which become the main ones at the next level, so the grid subdivides and
  never jumps. Its
  offset is kept within one tile: a CSS background positioned at the map's raw
  screen offset (hundreds of thousands of px when zoomed in) lost precision
  and jittered.
- Shared entity primitives migrated out of `legacy.ts`: `CharacterChip`,
  `PlaceChip`, `ChatChip`, `chatIcon`, and `useChatTitle` now live in
  `features/entities/{chat-meta.ts,chips.tsx}` and are shared by World, Chats,
  Places, and Timeline; `AvatarCount` in `ui/avatar.tsx` is shared with the
  world map clusters. Still borrowed: old Stage for sections not yet ported.

## Timeline (2026-11-25)

- **Built on ui-sdk**: `ui/timeline.tsx` (`Chronicle` wrapping `Timeline feed`,
  `ChronicleEntry` with `quiet` vs `card` variants, `ChronicleMilestone`,
  `ChronicleDay`, `ChroniclePhase`, `ChronicleThought`, `ChronicleMore` wrapping
  `ui/collapsible.tsx`), `ui/collapsible.tsx`, `ui/checkbox.tsx` (`CheckList` /
  `CheckRow` with `parent` checkboxes), `ui/avatar.tsx` (`"xs"` size and unified
  `AvatarCount`), and `ScrollFeed` in `ui/scroll-log.tsx` (top-anchored
  `ScrollArea` with edge fades, `createScrollAreaController`, and floating
  `overlay` new-events pill).
- **Pure logic in `lib/timeline/chronicle.ts`**: presets (`Highlights`,
  `Activity` using `DEFAULT_TIMELINE_KINDS`, `Everything`), facet definitions
  (`Encounters`, `Sleep & dreams`, `Chats`, `Activities`, `Clock`), day +
  day-phase grouping and lossless collapsing of consecutive quiet task/message
  bursts (`buildChronicle`), and search matching (`matchesEventQuery`).
- **Sidebar (`features/timeline/timeline-sidebar.tsx`)**: owns **who** to
  follow — `Search people` filters the roster, `Everyone` / `Favorites` switches
  the list, Clubs & Circles cards expand with FLIP avatar transitions and
  aligned co-follow toggles, fixed-height `h-10` active strip avoids jumps, and
  `onNavigated` switches panes on mobile.
- **Stage & data (`features/timeline/timeline-stage.tsx`, `event-row.tsx`,
  `hooks/use-timeline.ts`)**: owns **what** to see — `Search events` (`tl.q`),
  `Detail level` (`Highlights` | `Activity` | `Everything`) + filter popover
  (`tl.kinds`), `keepPreviousData` smooth switching without skeleton flashes,
  `Chronicle` feed with hold-back when scrolled (`1 new event` / `N new events`),
  quiet background lines vs. elevated story cards (`variant="card"`), expandable
  details and italicized action message previews, and `conversationPatch` routing
  so huddles open in World and texts open in Chats.

## Characters (2026-11-25)

- **No list sidebar.** World's column says where people are, Chats' what is
  being said, Timeline's whose story to follow. Characters adds no fourth list:
  the cast is the stage and a profile is a page in it (`SIDEBARS.characters`
  is `null`). The details panel stays on the right with the person's live
  state, as in every tab; the profile never repeats or moves it. (Tried and
  dropped: the panel moved into a left column under a portrait, which was
  motion without arrival, and a full-height cropped figure, which cut people
  off and assumed every world has standing portraits.)
- **The cast is a yearbook of display pictures** (`features/characters/gallery.tsx`):
  square tiles, each the character's display picture (`avatarUrl`) filling it,
  else their initials (`ui/portrait.tsx` with `face`). Tried and dropped:
  faces cut from standing portraits by their placement (`portraits.json`
  `centre`/`eyes`); most lined up, but the placement's centre is the body's,
  not the head's, so leaning heads still missed. The Looks tab still cuts its
  expression tiles that way (`usePortraits`, `placedFrame`), where every tile
  is the same figure. Thinking rings a tile, offstage greys it; no You or
  Played label.
- **One grid** (`ui/packed-grid.tsx`): groups are subgrids on shared columns
  (`columnsFor` from a ResizeObserver), each as wide as its tiles, packed dense,
  headings on a row ending on one line so tiles start together. A heading is
  two lines at most: the name first (a long one gets a second column,
  `headingSpan`, rather than three lines), the group's summary (two members
  or more) only on a line the name leaves free, clipped away otherwise. For
  whoever runs the world a ⋯ follows the name on hover, in the line's flow, so
  it takes no width (a chevron there read as collapsing the group). Arranged by Groups or A–Z (`chars.by`), with Show
  (`chars.show`) and Find (`chars.q`, also group names). A tile does one thing,
  open the profile: no hover card (the map's exists because a marker is only a
  face), and no You or Played label. Back puts focus on the tile you came
  from.
- **Arrangements not carried over from the old roster**, on purpose: by
  Activity and by Status. They answer "what is happening now", which World
  (who's where, doing what) and the status bar's counts already answer; the
  Characters tab is about who people are. Onstage and offstage (casting) stay
  here.
- **A profile is the World Wiki page on a character, plus what only a
  character has**, laid out as a wiki page: Back (to the cast) and the cast
  position, the title alone (name, and a line of what they're doing now, which
  below `xl` opens the details drawer), tabs, then the text with an infobox on
  its right (above it when narrow). `ui/infobox.tsx` is the box every wiki page
  will share: the page's picture whole and never cropped, whatever its shape
  (standing portrait, display picture, a place's backdrop), its caption, then
  facts as term and value; nothing at all without either. Tried and dropped:
  the picture in the title block (it pushed the text down and assumed a
  standing portrait). `features/wiki/page-body.tsx` (`WikiPageBody`) is the
  body every wiki page shares: the summary in bold, the rest of the opening,
  sections ("Only <name>" on those only the subject knows), history. When the
  Wiki tab moves here, a place, group or thing is a title, `WikiPageBody` and
  an `Infobox`; a character's page link already opens Characters. The
  profile's infobox (`profile-header.tsx`): a look tried on, else the resting
  portrait, else the display picture; Also known as; Groups with membership,
  each opening the cast found by it. Tabs (`ui/tabs.tsx`, `chars.tab`): About,
  Story, People (their own wiki's people in their words; opening one shows both
  sides and what each guesses the other thinks; who knows them), Looks
  (expressions cropped by each portrait's placement via `usePortraits`;
  pressing one tries it on in the infobox, `chars.look`), Memory. ← and → turn
  through the cast's filtered order keeping the tab. Opening a profile selects
  the person quietly.
- **Status line** (`StatusLine` in `character-actions.tsx`, the details panel's
  header and the profile title): never "Awake", the ordinary case, which the
  dot says; Thinking, Typing, Offstage or Not simulated when so, then their
  nearest group, or on the profile what they're doing now.
- **Who's onstage** (`features/characters/stage-dialog.tsx`, `StageDialog`):
  one character gets a plain question (`AlertPanel`: bring on or send off, and
  what that does); a group or the whole cast a list of faces by group, each
  group a `CheckList` whose parent row ticks it whole or in part (`CheckRow`
  has a `media` slot for the face), lit when on, greyed when off, "Steps on" or
  "Steps off" on rows that would change, the played locked on. Search, All,
  None; the footer says what happens ("2 step on. They all start thinking
  right away, reading 3 waiting messages first.") and the button how many
  changes. The old `CastDialog` stays only for the old UI.
- **Play as character** (`features/characters/play-as-dialog.tsx`, opened
  from anywhere by `openPlayDialog`): `ui/choose-list.tsx` (one answer on
  ui-sdk Listbox, found by typing; `PickList`'s sibling) with Watch (Observer)
  then the cast, someone played elsewhere disabled; beside it who that is and
  what the switch does to whoever is left; the button names the act ("Play as
  Yuuka", "Watch as observer").
- **New character** (`features/characters/new-character-dialog.tsx`): Name,
  the Id that follows it until Customize (`ui/field.tsx` `TextField` on ui-sdk
  Field, its error in place of its description; `idProblem` and `pageId` in
  `lib/wiki/page-id.ts`), and Simulated (on: joins the cast offstage and the
  profile opens; off: only a person's page, opened in the Wiki to write). The
  button says what it makes. The old `NewPageDialog` stays for the old Wiki.
- The profile's scroll area sits a pixel inside the stage card: the card's
  outline is an inset ring, painted under its children, so the stuck tabs
  would otherwise cover it.
- Editing still goes through the old UI: About and Looks open the Wiki tab,
  Memory the old memory sheet. `PHASE_ICON` is exported from the Timeline stage
  for the Story tab. Pure helpers: `lib/characters/cast-book.ts` (tested).

## Dialog actions and waiting (2026-11-25)

- **Every confirming dialog answers Cancel and Confirm**, nothing longer: the
  title, description and body say what confirming does (who steps on, what
  playing someone does to whoever is left, what the switch makes). No counts,
  names or verbs on the button ("Apply 3 changes", "Play as Yuuka", "Add
  Hina"). `AlertPanel` has no labels to pass; a `DialogPanel` footer is
  `DialogClose` Cancel and a primary Confirm, disabled until there's something
  to confirm. A dialog that only shows a result (the screenshot's Save image,
  Copy, Share) has no Confirm. Inline actions outside dialogs (Link / Unlink in
  the chat panel, Save layout on the map) keep their own word.
- **Waiting is a spinner, never a new word.** `ui/button.tsx`: an `onClick`
  that returns a Promise keeps the button pending (ui-sdk's own state, which
  also announces it after a second); `pending` does the same for what the
  button can't see, like a form it submits. Pending, a turning
  `LoaderCircle` takes the icon's place and the label stays as it is ("Adding…"
  made the button jump and read as a new button).
