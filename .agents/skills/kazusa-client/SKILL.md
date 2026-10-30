---
name: kazusa-client
description:
  Architecture guide for the Kazusa observer/player web client (`apps/web`), its
  wire contract (`packages/client`, `@kazusa/client`), and the plugin read-model
  routes it consumes (`/kazusa/*` HTTP + SSE). Always use this skill when
  building, reviewing, or extending anything a human sees in Kazusa — the app
  shell, top bar, roster rail, stage views (World tree/map, Chats, Timeline, and
  later Social/Wiki), inspector, status bar, entity chips, live updates, mock
  data, or the Next.js `/kazusa/[...path]` proxy — and whenever a backend change
  needs to be exposed to the UI (new endpoints, SSE events, journal kinds,
  frontmatter fields), even if the user only mentions one component, one panel,
  or "show X in the frontend".
---

# Kazusa Client

The Kazusa client lets a human watch and take part in a simulated society of
100–300 characters. It is a generic client: any franchise or original world can
run on it. It is not tied to one setting.

This skill fixes the architecture so that features can be added later without
restructuring the app. When a request seems to need a structural change, look
for the extension point first (§4). Change a decision in §2 only when the user
explicitly asks, and update this skill in the same change.

Related skills and references:

- The `kazusa` skill covers the backend (plugin modules, stores, ledgers,
  Perception). Load it alongside this one for any backend work.
- `kazusa/references/client.md` is the authoritative messaging contract (send,
  typing, audience, pagination). This skill builds on it and does not restate
  it.
- Reference files in this skill are listed in §9.

## 1. Scope of the first draft

| Surface             | First draft                                                                               | Later (see `references/roadmap.md`)         |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| Top bar             | World title, sim clock, speed controls, search, lens indicator                            | Notifications, Player-lens switch           |
| Roster rail         | Virtualized, searchable, groupable roster with live status                                | "Wants" icons, location chips               |
| Stage: **World**    | Group-by **tree** renderer; by-place folders follow the place graph                       | Map renderer for the same view              |
| Stage: **Chats**    | My chats + observed (read-only) chats                                                     | In-person conversations                     |
| Stage: **Timeline** | World journal stream, overview strip, facets, compare lanes                               | Replay / scrub-to-time, chronicle           |
| Inspector           | Slim, entity-polymorphic: Header, Now (task + place), Desires, Recent, About; Chat; Place | Attention, Relationships sections           |
| Status bar          | Slot registry: connection, data sources, activity summary, new events                     | Storyteller ticker, cost meter, next wakes  |
| Social, Wiki views  | **Not built.** Registry slots reserved                                                    | Relationship graph, asymmetry, belief board |

### 1.1 Implementation status

Keep this table current: update it in the same change that builds, wires or
removes a piece. **Live** means real backend data. **Mock** means it is served
by `lib/source/mock/*` behind a `Mock` tag (D10). **Planned** means it is not
built yet.

**Foundations (built)**

| Piece                       | Where                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-model schemas          | `packages/client/src/index.ts`                                       | `WorldResponse`, `ClockState`, `ClockActionPayload`, `CharacterSummary`/`Detail`, `CharacterStatus`, `TaskSummary`, `DesiresConfig`/`DesireRecord`/`DesiresResponse`, `JournalEvent` (9 kinds, incl. `attention.decided`, `location.noticed`), `Place`/`PlacesResponse`, `LocationRecord`/`Trip`/`LocationsResponse`, `TimelineQuery`/`Response`/`Histogram`, observer SSE events, `parseStreamEvent`. All marked PROPOSED until the plugin serves them. |
| Directory layout (§6)       | `apps/web`                                                           | The atomic move is done. `components/kazusa/*`, `lib/kazusa/*` and `hooks/use-kazusa.ts` no longer exist.                                                                                                                                                                                                                                                                                                                                                |
| Capability resolution (D10) | `lib/source/capabilities.ts`                                         | Resolves each domain on its own, with mock modes `auto`/`all`/`off` (Settings). Capabilities come from `LEGACY_CAPABILITIES` (`characters`, `chats` = live) because `/kazusa/world` doesn't exist yet.                                                                                                                                                                                                                                                   |
| Mock world                  | `lib/source/mock/{world,timeline,clock}.ts`                          | Seeded, about 150 characters. Merges live agents in by id. Produces journal history, statuses and chats, and keeps ticking (task rollovers, brain flips, messages).                                                                                                                                                                                                                                                                                      |
| Live store                  | `lib/live/{store,state,journal}.ts`                                  | Keyed external store (`useSyncExternalStore`). Status/clock/journal-tail singletons. Journal seq gap detection.                                                                                                                                                                                                                                                                                                                                          |
| Registries                  | `lib/registry/{views,inspector,status,timeline-kinds,live,entities}` | Every shell surface iterates a registry. The SSE provider sends `status`/`journal`/`clock`/`desires`/`location` through `registry/live.ts`.                                                                                                                                                                                                                                                                                                              |
| URL state                   | `hooks/use-url-state.ts`, `lib/state/entity-ref.ts`                  | `view`, `sel` (incl. `place:<id>`), `world.by` (`place` is the default when places resolve), `world.in` (`place:<id>`, `__transit`, `__unplaced`), `world.kind`, `tl.actors`, `tl.kinds`, `tl.watch`, `chats.id`, `chats.dm`, `chats.talk`.                                                                                                                                                                                                              |
| Sim time                    | `lib/time/sim.ts`, `hooks/use-clock.ts`                              | Anchor interpolation, formatting, speed labels.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tests                       | `lib/**/*.test.ts`                                                   | Sim time, EntityRef, capabilities, live store, journal gaps, grouping, mock determinism, pagination.                                                                                                                                                                                                                                                                                                                                                     |

**Surfaces**

| Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                                          | Data                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell (top bar, section rail, per-section sidebar, inspector, status bar)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Built. Rail becomes a bottom tab bar below `md`; sidebar undocks below `lg`; inspector becomes a sheet below `xl`.                              | —                                                                                                                                                                  |
| Top bar: clock, pause/speed presets, advance menu, lens badge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Built                                                                                                                                           | `clock`: **Live** (`GET /kazusa/world`, `POST /kazusa/clock`, SSE `clock`)                                                                                         |
| ⌘K palette: sections, chats, places, characters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built                                                                                                                                           | `characters`, `chats`, `places`                                                                                                                                    |
| World sidebar: Watchlist / Everyone / dimension folders with live busy hints, character search, kind filter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Built                                                                                                                                           | `characters`: **Live** (via `/kazusa/characters`) merged with **Mock** NPCs. `status`: **Live** (Perception brain + Taskman + typing)                              |
| Presence ring (thinking / composing / on-task / idle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Built                                                                                                                                           | `status`: **Live**                                                                                                                                                 |
| World view: open folder as virtualized character rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Built                                                                                                                                           | `characters` + `status`: **Live**                                                                                                                                  |
| World view: by-place tree (subgraph nesting from `parent`; a place's count includes everyone inside it; "On the way" and "Not placed" folders; open folder lists people per sub-place, travelers with time to arrival; "Place details" opens the place inspector)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Built. Tree math in `lib/location/places.ts` (tested); grouping in `views/world/world-state.ts`                                                 | `places` + `location`: **Live** (`GET /kazusa/places`, `GET /kazusa/locations`, SSE `location`); **Mock** map in `lib/source/mock/places.ts`                       |
| World view: map renderer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Planned**                                                                                                                                     | Same data                                                                                                                                                          |
| Inspector: Place (header with area breadcrumb/aliases/description, People here/inside/on the way, Getting around: parent, children, connections)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Built. Sections `place.header`, `place.people`, `place.ways`                                                                                    | `places` + `location` + `characters`                                                                                                                               |
| Timeline: `location.noticed` ("Crossed paths with X at Y"); task starts show "at / heading to" a place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Built                                                                                                                                           | `timeline` (observer's `:tasks` ledger; SSE `journal`)                                                                                                             |
| Chats view: my chats, composer, groups, members                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built (existing UI rehoused)                                                                                                                    | `chats`: **Live**. Shows "Can't reach the Kazusa server" + Retry when the Gateway is down                                                                          |
| Chats view: presence-aware header (DM: partner ring + task + time left; group: member stack + names; huddle: "In person at <place>"). Opening a chat quietly selects its subject in the inspector (character for a DM, else the chat)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Built                                                                                                                                           | `status`: **Live**                                                                                                                                                 |
| Chats view: huddles listed first under "In person at <place>"; actions narrated as lines, not bubbles (`lib/source/chats/display.ts`, tested); Say/Do composer in huddles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Built                                                                                                                                           | `chats`: **Live** (`Chat.placeId`, `lastMessage.type`/`senderId`/`senderName`, `SendPayload.type`)                                                                 |
| Player presence: status bar "You're at <place>" (opens it); place inspector "Go here" / "You're here"; character header "Go to <place>" and "Talk in person" (same place) → `chats.talk=<id>` opens your huddle with them or a draft huddle whose first message is sent `aloud`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built. `usePlayer()` in `hooks/use-location.ts`; moving needs `location` live (hidden on mock)                                                  | `location`: **Live** (`POST /kazusa/move`; the record also arrives by SSE `location`)                                                                              |
| Onstage/offstage: affiliation folders and Everyone show "onstage/total" with a group menu (Bring all onstage, Send all offstage, Choose who…); every change goes through the cast dialog (`views/world/cast-dialog.tsx`), which says what happens in-world and how many model turns start. Inspector header has a per-character switch. Offstage rows and avatars are dimmed ("Offstage · 3 waiting"); Show filter is Characters (default) / Onstage / Offstage / NPCs / Everyone; by place, offstage characters have their own "Offstage" folder and are never placed (`useOccupancy`, `usePosition`); Desires freeze at `offstageSince`                                                                                                                                                       | Built. `useStage()`/`useOffstage()` in `hooks/use-stage.ts`                                                                                     | `stage`: **Live** (`POST /kazusa/character/stage` with `{ ids, onstage }`; `CharacterStatus.onstage`/`offstageSince` by SSE `status`); **Mock** via `setMockStage` |
| Chats view: observed (read-only) chats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Planned** (shows a NeedsLine)                                                                                                                 | Needs `observe`                                                                                                                                                    |
| Timeline: virtualized stream, day separators, kind/actor/watchlist filters, held-back "N new events". Kinds with `hiddenByDefault` (Message) are off unless `tl.kinds` lists them; the inspector's Recent uses the same `DEFAULT_TIMELINE_KINDS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Built                                                                                                                                           | `timeline`: **Live** (`GET /kazusa/timeline` from the `:tasks` and chat ledgers plus decisions in the `"perception"` store; SSE `journal`)                         |
| Timeline: overview strip (histogram), compare lanes, collapse runs (`collapseKey` is declared but not applied), scrub/replay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Planned**                                                                                                                                     | Needs `/kazusa/timeline/histogram` for the strip                                                                                                                   |
| Inspector: character Header, Now (task, then place + who is there + noticed, or trip; writing in), Recent (`RECENT_KINDS`), About                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Built                                                                                                                                           | Header/About: `characters` **Live** (`GET /kazusa/character`). Now: `status` + `places` + `location` **Live**. Recent: `timeline` **Live**                         |
| Inspector: Stop brain in the character header; enabled while thinking, shows Stopping while the request settles | Built. `character-stop.tsx`, `abortCharacterBrain` | `characters` + `status`: **Live** only; authenticated `POST /kazusa/brain/abort` with `{ agentId }` uses native abort-and-drain. No run-ID checks or additional queue policy. |
| Inspector: chat summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Built                                                                                                                                           | `chats` / mock chats                                                                                                                                               |
| Inspector: Desires (segmented bar per catalog desire with its state word; accent + target tick + "→ full by 07:00" while the current task moves it; "Satiety turns low in 38m" forecast of the next state drop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built. Section is `character.desires` (order 15). Math in `lib/time/desires.ts` mirrors the plugin's closed form (tested)                       | `desires`: **Live** (`GET /kazusa/desires` seeds `desireStore`/`desireConfigStore`; SSE `desires` replaces one record; refetched on `connected`)                   |
| Task category: icon + label (`Eating · Cooking dinner`) in Now, rows, chat header, Timeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Built. `taskIcon`/`taskLabel` in `entities/task-icon.tsx` map Taskman's default `TASK_CATEGORIES`; custom categories fall back to a neutral dot | `status`/`timeline`: `task.type` is the category                                                                                                                   |
| Settings section (gear at the bottom of the rail, last tab on phones; `view=settings`, `settings.tab`): sidebar lists `SETTINGS_CATEGORIES`; **Connection** (Gateway status + Retry, server URL, token, mock mode, read-only identity) and **Models** (world chat model and reasoning level, an explainer of how characters inherit them, provider status + "Refresh catalog"). Below `lg` the category list is the first screen. The status bar's connection item and the offline empty state link to Connection. Embedding and decision models get their own Models sections once the backend has them                                                                                                                                                                                        | Built. `views/settings/*`, `lib/registry/settings.ts`                                                                                           | Connection: local config. Models: `models` **Live** only; "needs a live Gateway" otherwise                                                                         |
| Model pickers (shadcn AI Elements Model Selector in `components/ui/model-selector.tsx`) for one scope, world (no `agentId`) or a character: Pinned shortlist, then every provider's catalog, searchable; models that can't call tools are left out by the backend; models without credentials are disabled ("No key"); "Refresh catalog" re-asks providers. The first entry undoes the scope's choice ("World default" for a character, "OpenClaw default" for the world when they differ). Reasoning lists the effective model's own levels plus the inherited default; hidden when the model has fewer than two. Stored in Kazusa's `"models"` store, not `openclaw.json` (OpenClaw limitation: a config model change reloads every plugin; see `references/backend-contract.md`). The composer has no picker: the model is per character, not per chat | Built. `ModelPicker`/`ThinkingPicker` in `components/models/`, `useModels(agentId?)` (a world write revalidates every cached agent read)        | `models`: **Live** only (`GET /kazusa/models[?agentId]`, `POST /kazusa/model`, `POST /kazusa/thinking`)                                                            |
| Inspector: character Model (chat model + reasoning, each "Follows the world default, X" or "Chosen for <name>" with "Use world default"; link to Settings → Models). Only for live agents (`useApplies: useRunsOnModel`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Built. Section `character.model` (order 50)                                                                                                     | `models` + `characters`: **Live**                                                                                                                                  |
| Inspector: Attention, Relationships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Planned** (roadmap)                                                                                                                           | —                                                                                                                                                                  |
| Status bar: connection, data sources (per-domain Live/Mock/Unavailable), activity summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Built                                                                                                                                           | —                                                                                                                                                                  |
| Status bar: new-events jump, storyteller ticker, next wakes, cost meter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Planned**                                                                                                                                     | —                                                                                                                                                                  |
| Entity hover cards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Planned** (chips navigate on click only)                                                                                                      | —                                                                                                                                                                  |
| `lib/lens/` selectors, Player lens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Planned** (the top bar shows a fixed "Observer" badge)                                                                                        | —                                                                                                                                                                  |

**Backend wiring still to do (client side)**, in the same order as
`references/backend-contract.md` §8. For each step: add the route to the
allowlist in `app/kazusa/[...path]/route.ts` (today it lists messaging, clock,
world, characters, character, timeline, desires, places, locations, move,
models, model, thinking), add an http adapter under `lib/source/<domain>/`, and
remove the domain from the mock fallback.

1. `GET /kazusa/world`: **Done.** Replaced `LEGACY_CAPABILITIES` with live
   capabilities; seeds `clockStore` from `clock`.
2. `POST /kazusa/clock` + SSE `clock`: **Done.** Top-bar actions execute
   `POST /kazusa/clock`, and SSE updates `clockStore`.
3. `GET /kazusa/characters`, `GET /kazusa/character`: **Done.** Roster and
   Profile read real frontmatter and bodies.
4. SSE `status` (Perception brain state + taskman + typing): **Done.** Realtime
   presence and task tracking live.
5. `GET /kazusa/timeline` + SSE `journal`: **Done.** The histogram is still to
   do. 5b. `GET /kazusa/desires` + SSE `desires`: **Done.** Closed-form records,
   not levels: the client computes levels from `useSimNow()`, so nothing polls.
6. `/kazusa/observe/*` + `scope=observer`: fill the Observed section in Chats.
7. `GET /kazusa/places`, `GET /kazusa/locations` + SSE `location`: **Done.**
   Records are closed form (place or trip with timed legs); the client resolves
   "where now" from `useSimNow()`, so a moving character needs no ticks.

## 2. Fixed decisions

Each decision includes its reason. Keep the reason in mind when a new case
doesn't quite fit.

**D1. The client stays franchise-neutral.** Chrome, copy, component names and
tokens contain no lore. World flavor comes only from data: character names and
avatars, place names, the world title and accent from world metadata, and the
player's display name from `user.name` (never hardcode "Sensei"). Use neutral
terms in code: `player` / "You", `character`, `place`, `presence ring` (not
"halo"). The same build has to work for any setting, and lore baked into
components would need a fork for each franchise.

**D2. The browser's only backend is the plugin read model.** Browser →
same-origin Next proxy `app/kazusa/[...path]/route.ts` (a fixed allowlist, with
the Gateway token kept server-side) → plugin `registerHttpRoute` handlers under
`/kazusa/*`. Neither the browser nor the proxy uses the native Gateway WebSocket
(`sessions.*`, `chat.history`, `cron.*`, `agent` events). Reasons:

- The native WebSocket needs device pairing and a signed challenge.
- An authenticated WebSocket client is trusted at full Gateway scope.
- Native transcripts are agents' private prose projections, not UI data.
- Native events are not replayed.
- Simulation semantics (sim time, sender attribution, frozen audiences,
  attention) live only in the plugin.

The plugin runs inside the Gateway and reads OpenClaw in-process through the
SDK. That is how the client "reads OpenClaw via the Gateway". Details are in
`references/backend-contract.md` §1.

**D3. Contracts come first, in `@kazusa/client`.** Every request, response and
SSE payload is a Zod schema in `packages/client/src`. The plugin's HTTP adapters
`satisfies` the inferred types. The web app parses with the schemas at the fetch
boundary. A feature starts by adding or changing its schema, so that the schema
becomes the spec handed to the backend.

**D4. Use structured data only. Never regex Markdown.** The UI reads YAML
frontmatter (parsed in the plugin with a real YAML parser and validated by a Zod
schema for each document type) and keyed-store records. Markdown bodies are
rendered verbatim as `bodyMarkdown` and never mined for fields. Ledger text is
never parsed either: for example, task monologues come from structured journal
payloads, not from the italic blockquote in `:tasks` text. If the UI needs a
value that exists only in a body, the fix is a frontmatter schema change. See
`references/backend-contract.md` §5 for the current proposals. The web app never
reads files.

**D5. Design for 300 characters.** Nothing gets a fixed row, lane or column per
character.

- Every list is virtualized (`@tanstack/react-virtual`), searchable, groupable
  and filterable.
- Filtering and aggregation that could touch the full history run on the server
  (query params, histogram endpoint).
- Per-character detail is opt-in through focus sets: the watchlist, compare
  lanes (≤ 8), and the inspector.
- The mock world generates ~150 characters, so scale problems show up in
  development.

**D6. Simulation time is the main clock.**

- The wire uses epoch-ms simulation timestamps. Ordering uses server
  `sequence`/`seq`, never timestamps, because the clock can be frozen.
- The client interpolates "now" from `{ simTime, speed, updatedAt, serverNow }`,
  so it doesn't poll the clock.
- Components subscribe through a shared `useSimNow(resolution)` ticker at minute
  (or coarser) resolution. 300 rows must not re-render every second.
- Every timestamp on screen is sim time, shown in UTC like the plugin's
  `ClockSnapshot.formatted`, regardless of the viewer's timezone. That includes
  chat bubbles and list times (`lib/format.ts`). "Today"/"Yesterday" compare UTC
  days against `useSimNow()`, never `Date.now()`. A browser-local formatter once
  showed 3:40 PM on a bubble whose sim time was 19:40.
- Real time appears only in debug affordances.

**D7. Facts and thoughts look different. Free text is never treated as a fact.**

- Tool-grounded state (task, membership, clock, location) renders with `<Fact>`
  styling: solid, iconified chips.
- Subjective content (monologues, impressions, beliefs) renders with
  `<Thought by=…>` styling: italic, attributed, with confidence shown when one
  exists.
- Do not derive state from free text. Never infer "asleep" from
  `task.type === "sleep"`. If the UI needs a state, the backend exposes a
  structured field. This mirrors the backend rule "prose is never a fact".

**D8. Extend through registries, not shell edits.**

World character rows and direct-chat rows show `ADMIN` from structured
`isSystemAgent` roster metadata. The backend derives this from the current
native system-agent selection; names and biography text never grant or imply the
role.

- Stage views, inspector sections, status-bar items, timeline event kinds,
  entity kinds and live-event handlers are all registry entries (§4).
- Adding a feature means adding entries plus a source domain.
- Shell components iterate registries and never import feature components
  directly.

**D9. One lens layer.**

- The first draft runs in the **Observer** lens, which is omniscient.
- Every read of private or subjective data goes through selectors in
  `lib/lens/`, so a later **Player** lens can redact in one place instead of
  through scattered `if`s.
- Components never check the lens themselves. They render what selectors return.

**D10. Data sources are resolved per domain, from capabilities.**

- `GET /kazusa/world` returns
  `capabilities: Record<Domain, "live" | "unavailable">`.
- Each domain resolves independently to `live`, `mock` (development override or
  unavailable domain, when mocks are enabled) or `unavailable`.
- Mocked panels show a visible `Mock` tag. Unavailable panels show an honest
  empty state.
- Nobody should mistake a concept for backend behavior, and each panel turns
  real on its own as its backend lands.

## 3. Shell layout

```text
┌ TopBar ─────────────────────────────────────────────────────────────────────┐
│ World title │ Day 3 · 14:32 · Afternoon  ⏸ 1× 10× 60× +1h │     Observer │
├Rail┬ Section sidebar ┬ Stage ─────────────────────────────┬ Inspector ─────┤
│ Wd │ view.sidebar    │ view.component                     │ entity-        │
│ Ch │ search  [⚙/+]   │ (owns its URL params, e.g. tl.*)   │ polymorphic    │
│ Tl │ folders / chats │                                    │ sections       │
│ ⌘K │ / filters       │                                    │ ← registry     │
├────┴─────────────────┴────────────────────────────────────┴────────────────┤
│ ● Live │ 2 domains mocked │ 12 thinking · 3 composing │ 4 new events    ⌘K? │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **TopBar** is global time only. No per-feature controls, and no settings:
  Settings is a section.
- **Rail** (`shell/section-nav.tsx`) lists registered `StageView`s as icons
  (bottom tab bar below `md`), with an optional `badge` per view. The world's
  sections sit at the top; `placement: "end"` views (Settings) sit at the bottom
  under the ⌘K palette (`shell/command-palette.tsx`) icon.
- **Section sidebar** is the active view's `sidebar` component (World: folders,
  Chats: chat list, Timeline: filters). No sidebar tabs. Each uses
  `PanelToolbar` (search + one trailing action). Below `lg` it isn't docked:
  views show it as their first screen, or call `requestSidebar()` to open it as
  a sheet.
- **Stage** renders exactly one registered view. A view owns its URL params,
  namespaced like `tl.kinds` and `world.by`.
- **Inspector** shows the selected `EntityRef` using the sections registered for
  that entity kind. It stays put when the view changes. Keep it slim: depth
  belongs in stage views, reached through filtered links like "Open in
  Timeline".
- **StatusBar** is a slot registry for small, global, glanceable signals.
  Anything bigger than a chip belongs elsewhere.
- **Mobile:** the stage is full-screen, the sidebar and inspector become sheets,
  and status items fold into a top-bar menu.

UX details for each surface are in `references/ux.md`.

## 4. Extension points

All registries live in `apps/web/lib/registry/`. Each is a typed, ordered array
or map, filtered by the capabilities the entry `requires`.

```ts
type Domain =
  | "clock"
  | "characters"
  | "status"
  | "chats"
  | "observe"
  | "timeline"
  | "places"
  | "location"
  | "relationships"
  | "attention"
  | "desires"
  | "stage"
  | "models";

type EntityKind = "character" | "chat" | "place";
/**
 * Serialized as `kind:id`, split on the FIRST colon (ids like `user:you`
 * contain colons).
 */
interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

interface StageView {
  readonly id: string; // "world" | "chats" | "timeline" | later "social" | "wiki"
  readonly label: string;
  readonly icon: LucideIcon;
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType; // reads its own namespaced URL params
}

interface InspectorSection {
  readonly id: string;
  readonly entity: EntityKind;
  readonly title: string;
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType<{ readonly entity: EntityRef }>;
}

interface StatusItem {
  readonly id: string;
  readonly side: "start" | "end";
  readonly order: number;
  readonly requires: readonly Domain[];
  readonly component: ComponentType;
}

interface TimelineKind<K extends JournalKind = JournalKind> {
  readonly kind: K; // must exist in the @kazusa/client JournalEvent union
  readonly label: string;
  readonly icon: LucideIcon;
  readonly facet: "task" | "chat" | "world" | "social" | "mind";
  readonly salience: "low" | "normal" | "high";
  readonly fact: (event: JournalEventOf<K>) => ReactNode; // <Fact> line
  readonly thought?: (event: JournalEventOf<K>) => ThoughtLine | undefined;
  readonly collapseKey?: (event: JournalEventOf<K>) => string | undefined; // merge runs
  readonly target?: (
    event: JournalEventOf<K>,
  ) => EntityRef | StageLink | undefined;
}

/** Applies one SSE event type to client state. */
type LiveHandler<T extends StreamEvent["type"]> = (
  event: StreamEventOf<T>,
  ctx: LiveContext,
) => void;
```

The renderers for an entity kind (chip, hover card, inspector header) are also
registered by kind, so `<EntityChip entity={ref} />` works everywhere: in
timeline rows, chat headers and inspector sections.

To add a feature:

1. Add or extend the schemas in `@kazusa/client`. Include a new journal kind or
   SSE event if the feature has live data.
2. Add a source domain in `lib/source/` with `http` and `mock` implementations
   behind the same interface. Declare it in `Domain`.
3. Add hooks in `hooks/` (SWR for resources, the live store for high-frequency
   state).
4. Register views, sections, status items, timeline kinds and live handlers.
   Never edit shell components to mount a feature.
5. Route private or subjective reads through `lib/lens/` selectors.
6. Document the backend ask in `references/backend-contract.md` if one is
   needed.

## 5. Data flow

```text
@kazusa/client schemas
   │  parse at boundary
lib/source/<domain>/{http,mock}.ts ── resolved per domain by capabilities (D10)
   │
   ├─ request/response resources → SWR hooks (useCharacters, useTimeline, useCharacter…)
   └─ high-frequency live state  → lib/live/ keyed external store
                                    (useSyncExternalStore; per-id subscriptions:
                                     useCharacterStatus(id), useTyping(chatId))
   │
lib/lens/ selectors (Observer today, Player later)
   │
registered components
```

- **One SSE connection per scope.** `GET /kazusa/events?scope=observer` carries
  player events plus `journal` and `status` events. A registry of `LiveHandler`s
  dispatches each event type. No component opens its own `EventSource`.
- **Gap-safe journal.** Journal events carry `seq`, and the `connected` event
  reports the server's high-water `journalSeq`. On reconnect, or when the client
  sees a gap, it catches up with `GET /kazusa/timeline?after=<lastSeq>`. SSE is
  a notification channel; history is the durable log. This matches the messaging
  rule.
- **Live status doesn't go through SWR arrays.** A status delta for one of 300
  characters must not re-render the roster. The live store is seeded from the
  `/kazusa/characters` snapshot and updated per id.
- **URL is the navigation state.** It holds `view`, `sel` (EntityRef), and each
  view's namespaced params, so deep links and back/forward work and the Timeline
  → Chats → Inspector hops stay shareable. Ephemeral UI state (hover, open
  popovers) stays in components.
- **No fetching in `useEffect`.** Use SWR or the live store.

## 6. Target directory layout (`apps/web`)

```text
app/
  layout.tsx                       # fonts, theme tokens, <html className="bg-background">
  page.tsx                         # <Shell/>
  kazusa/[...path]/route.ts        # allowlisted proxy (add new routes here)
components/
  shell/                           # top-bar, section-nav (rail + tabs), command-palette, stage, inspector, status-bar (iterate registries)
  views/{world,chats,timeline}/    # stage view implementations (existing chat UI moves to views/chats)
  inspector/sections/              # registered inspector sections
  status/                          # registered status items
  entities/                        # entity-chip, hover-card, presence-avatar, fact, thought
  ui/                              # shadcn primitives (unchanged)
lib/
  registry/                        # views.ts, inspector.ts, status.ts, timeline-kinds.ts, live.ts, entities.ts
  source/<domain>/{http,mock}.ts   # plus capabilities.ts (resolution) and mock/world.ts (seeded generator)
  live/                            # keyed external store + SSE client
  lens/                            # selectors
  time/                            # sim-clock interpolation, buckets, formatting (+ *.test.ts)
  state/                           # url-state helpers, EntityRef (de)serialization (+ tests)
hooks/                             # SWR + live-store hooks
```

The old `components/kazusa/*` and `lib/kazusa/*` paths have been moved into this
layout and deleted. Don't bring back parallel old paths. `lib/lens/` hasn't been
created yet (§1.1).

Pure modules under `lib/` (anything with a colocated test) use **relative
imports**, not `@/`. The root vitest config has no path alias.

## 7. Visual language (summary)

- The look is a neutral, dense, legible "instrument panel". This app is readable
  before it is decorative.
- Use 3–5 tokens: background, surface, foreground, muted, and one accent. The
  accent can be overridden by world metadata. Don't use purple or violet, and
  don't use gradients.
- Use two families: Geist for UI, Geist Mono for sim times, IDs and counts.
- Spend boldness in one place: the **presence ring** on avatars, a single
  encoding reused in roster, chips, chats and inspector.
- Timeline kinds are told apart by icon and label, not by extra hues.
- Full specifications are in `references/ux.md`.

## 8. Validation

- `npm test` (vitest): pure logic is colocated in `lib/**/*.test.ts`. That
  covers sim-clock interpolation, time bucketing, EntityRef serialization,
  journal gap detection, collapse rules, capability resolution and mock-world
  determinism. If root dev dependencies aren't installed (as in the v0 sandbox),
  run vitest from an isolated temp install with
  `--root <repo> --config <temp config including apps/web/lib/**/*.test.ts>`.
- `npm run typecheck` and
  `npx tsc --noEmit --incremental false -p apps/web/tsconfig.json`. A build that
  ignores TypeScript errors doesn't count.
- Run targeted `prettier --check` / `eslint` on touched files.
- Browser check: open the preview with the mock world (~150 characters). Then
  scroll the roster and timeline, switch views, select entities, and confirm the
  URL updates and the `Mock` tags show.
- Run plugin route changes through the plugin test suite (`http.ts` handler
  tests) as the `kazusa` skill describes.

## 9. References

- `references/ux.md`: read when designing or building any surface (top bar,
  roster, World tree, Chats, Timeline, inspector, status bar), scale patterns,
  empty, loading and mock states, or the presence ring and fact/thought styles.
- `references/backend-contract.md`: read when wiring data. It covers the Gateway
  decision, existing and proposed `/kazusa/*` routes, SSE scopes, the world
  journal, the capability matrix, frontmatter rules and schema-change proposals.
- `references/roadmap.md`: read before building any deferred feature (map,
  social, wiki, needs, beliefs, attention log, Player lens, replay). It lists
  which slot each feature plugs into and what it depends on.
