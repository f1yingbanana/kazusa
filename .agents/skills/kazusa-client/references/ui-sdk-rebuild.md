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
