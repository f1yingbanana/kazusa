# UI Architecture on ui-sdk

Read before touching `apps/web/ui/` or `apps/web/features/`.

Kazusa's web interface is built natively on [ui-sdk](https://ui-sdk.dev)
(`@ui-sdk/react` and `@ui-sdk/core`). Layers are enforced by
`no-restricted-imports` in `apps/web/eslint.config.mjs`:

```text
ui/                      # generic component library built on ui-sdk: no Kazusa data
  theme.css              # two-hue palettes on <html data-palette>, --ui-* tokens, light/dark
  tailwind.css           # Tailwind theme: ui-* colours, shadow-ui, animate-ui-*
  palettes.ts            # palette list (stable values, shown labels, swatches)
  cx.ts                  # class joining with tailwind-merge
  <name>.tsx             # one component (or family) per file, wrapping @ui-sdk/react parts
  canvas*.ts(x)          # pannable canvas: ui-sdk createViewport + spatial roving focus,
                         #   with a camera that flies (van Wijk), glides (springs) and
                         #   coasts after a fling; reduced motion jumps. The world map uses it.
features/                # the application, built strictly from ui/ + lib/ + hooks/
  shell/                 # frame, sections, top bar, clock/, status bar + status/, More sheet,
                         #   saves, visitor welcome, command palette, details panel
  setup/                 # SetupFrame, first-run SetupGuide, CastPicker, PlayAsPicker,
                         #   OwnerGate, StartOver
  characters/ places/ chats/ world/ stats/ timeline/ wiki/ settings/
app/globals.css          # @layer ui-sdk; @import "tailwindcss"; @import "../ui/tailwind.css";
app/layout.tsx           # M PLUS Rounded 1c as --ui-font-face, bg-ui-ground, NuqsAdapter
```

## Layering and Styling Conventions

- **`ui/`** imports only React, `@ui-sdk/*`, `lucide-react`, and
  `tailwind-merge` (in `cx.ts`). No `@/`, `@kazusa/*`, `nuqs`, SWR, or Zustand.
  Components accept plain props (`presence`, `name`, `src`), never domain IDs to
  resolve internally. Never mention a franchise or setting name.
- **`features/`** imports UI components exclusively from `@/ui/*`, never
  `@ui-sdk/*` directly; extend or add a `ui/` wrapper instead (`TextButton` for
  a press that reads as prose).
- Style with Tailwind v4 classes keyed on `ui-sdk`'s state attributes: `ui-*`
  palette tokens (`bg-ui-surface`, `text-ui-soft`, `inset-ring-ui-line`,
  `shadow-ui`, `animate-ui-*`), `rounded-full` or explicit pixel/rem radii
  (`rounded-[1rem]`), explicit border colours (`border-ui-line`), and `cx` from
  `ui/cx.ts` so caller overrides win. Size icons with `[&_svg]:size-4` on the
  parent.
- Before using or adding a component, follow the `ui-sdk` skill and read
  `node_modules/@ui-sdk/react/docs/llms.txt`, then the page for each component
  (`docs/components/<name>.md`). To compose a custom primitive from behaviors,
  inspect `docs/core.md` headings and `docs/rendering.md`.

## Surface Decisions

### Chats and World Conversations

- **Chats (`features/chats/`)** holds direct and group conversations (unread
  counts and composer with `ui/composer.tsx` + `ui/scroll-log.tsx`). Huddle
  links (`chats.id` of a huddle, `chats.talk`) route to World.
- **World (`features/world/`)** holds face-to-face huddles over the map
  (`world.talk=<chatId>`, `world.as=scene|list`, `world.with=<characterId>`),
  opening with an iris transition from the trigger point (`talk-origin.ts`)
  while the map remains mounted underneath.
- Route every navigation to a chat through `conversationPatch` in
  `features/chats/open.ts` and spread `conversationParsers` into
  `useQueryStates`.
- Never animate a CSS transform on or around a `ScrollArea` while opening:
  `stickToEnd` measures geometry and releases if shifted; use opacity or
  `clip-path` transitions (`animate-ui-thread-in`, `animate-ui-iris-in`).
- World's sidebar ranks rooms (`rankRooms`: your room, active speech, latest
  talk, fullest) and lists each talk inside `ui/talk-group.tsx`.

### Timeline (`features/timeline/`)

- Uses `ui/timeline.tsx` (`Chronicle` wrapping ui-sdk `Timeline`),
  `ui/collapsible.tsx`, shared `ClubGroupItem`
  (`features/characters/club-group-item.tsx`), `ui/avatar.tsx`, and top-anchored
  `ScrollFeed` in `ui/scroll-log.tsx`.
- Pure grouping and facet filtering live in `lib/timeline/chronicle.ts`.

### Characters and Profiles (`features/characters/`)

- Gallery (`gallery.tsx`) lays out compact square portrait tiles via
  `ui/packed-grid.tsx` (`columnsFor` ResizeObserver subgrids). Thinking rings a
  tile; inactive characters render dimmed/grayscale.
- Profiles share the wiki layout (`features/wiki/world-page.tsx`,
  `ui/infobox.tsx`, `WikiPageBody` in `features/wiki/page-body.tsx`) with tabs
  (`ui/tabs.tsx`): About, Story, People, Looks, and Memory.
- `StageDialog` (`stage-dialog.tsx`) manages active/inactive characters using
  `ui/checkbox.tsx` (`CheckList` / `CheckRow`) and `AlertPanel`; `PlayAsDialog`
  (`play-as-dialog.tsx`) uses `ui/choose-list.tsx` (`Observer` + cast).
- `NewCharacterDialog` (`new-character-dialog.tsx`) uses `ui/field.tsx`
  (`TextField`) and adds simulated characters as inactive.

### Setup (`features/setup/`)

- `SetupFrame` renders uniform desktop sizing (`896×624`) when `uniform` is set,
  and full-bleed full-height mobile sheets (`max-sm:h-dvh`) with a horizontally
  scrollable step pill header (`overflow-x-auto`) whose active
  `[aria-current="step"]` pill smooth-scrolls into view on step changes.
- `CastPicker` shares `ClubGroupItem` with Timeline (showing `+` / `✓` / `−`
  actions, defaulting from the world package's `defaultGroups` +
  `defaultCharacters`), `PlayAsPicker` pre-selects `defaultUserCharacter` when
  provided, and `Starting` renders a spinning `LoaderCircleIcon`
  (`animate-ui-spin`) until the Gateway answers.

### Dialogs, Buttons, and Feedback

- Confirming dialogs (`AlertPanel`, `DialogPanel`) answer with `Cancel` and
  `Confirm`; titles and descriptions explain what confirming does.
- Pending buttons keep their label constant and swap in a spinning
  `LoaderCircleIcon` (`animate-ui-spin`, via `pending` or a Promise-returning
  `onClick` on `Button`/`IconButton`).
- **Toasts (`ui/toast.tsx`)**: built on `@ui-sdk/react/toast`. Desktop anchors
  `side="top"` center; mobile (`max-width: 767px`) anchors `side="bottom"`
  centered above the bottom `SectionNav` bar with stack offsets/entrance flipped
  upward and `ToastAction` inside the text column so descriptions use the card's
  full width. Tests firing toasts without `<Toasts />` mock `@/ui/toast`.

### Shell, Navigation, and Responsive Rules (`features/shell/`)

- `SECTIONS` in `features/shell/sections.ts` defines the top-level sections,
  rail badges, and `narrow` presentation (`pane` for Chats/Wiki/Settings,
  `sheet` for Timeline, `tabs` for World).
- `SectionNav` (`ui/nav-rail.tsx`) renders route tabs (`TabsIndicator`)
  vertically on desktop (`md:`+) and as a compact bottom bar on mobile
  (`max-md:`).
- Below `xl`, details open in a bottom/side `Drawer`; below `md`, stages run
  edge-to-edge without outer card shadow/radius, narrow navigation uses
  `[view-transition-name:pane]`, and secondary header controls move into
  `MoreMenu` (`features/shell/more-menu.tsx`).
- Long-press / context menus share `ui/context-menu.tsx` (compact context menu
  on desktop/fine pointers, titled bottom sheet on touch).
- `data-selected:` targets ui-sdk's bare `data-selected=""` attribute cleanly
  across all Tailwind utilities.
