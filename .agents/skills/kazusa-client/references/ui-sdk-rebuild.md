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
- Chats lists texts newest first under one filter: Yours / Everyone
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
- Still borrowed: `PlaceChip`, `chatIcon`, `useChatTitle` and the old Stage for
  sections not yet ported.
