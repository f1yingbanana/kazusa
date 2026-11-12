# Visual Novel Mode for Huddles (the Scene view)

Status (2026-11-12): the prototype (M0) is built, along with the line as it is
said (§6.2), full screen, the backlog, reading mode and faces (§6.3); outfits
(§6.4) are not. §4.1 says what was built where it differs from the sketches, and
§13 logs every change of mind. This document began as an answer to the
preliminary research report "Real-Time Visual Novel Stage and Text Rendering
Architecture" (Gemini, written without access to this code); §14 lists where
that report and this code disagree.

Goal: a face-to-face conversation looks like people in a place, not like a group
chat. A background for where they are, a figure for each person talking, a line
of dialogue as it is said. Everything else in Kazusa stays as it is: the scene
is another way to look at a huddle, never another kind of conversation.

Names. "Stage" is taken twice (the client's main area, `StageView`; the
backend's onstage/offstage, `src/stage/`), so this document says **Scene** for
the visual novel view, **figure** for a person drawn in it and **backdrop** for
the picture behind them. A checkpoint's `scene.json`
([worlds](../../kazusa/references/worlds.md) §4) is unrelated.

## Contents

0. Decisions
1. Build or adopt an engine
2. Simulation: what a conversation looks like
3. Player: what is fun, and where it shows
4. The prototype (M0)
5. Architecture
6. Backend changes
7. Reading mode: advance on click
8. Assets
9. Rigs and 3D
10. Phases
11. Risks and what to measure
12. Open questions
13. Decision log
14. Where the research report differs from this code

## 0. Decisions

1. **We build the scene ourselves and adopt no visual novel engine** (§1).
2. **The prototype is DOM only**: one `<img>` for the backdrop, one per figure,
   a dialogue box. No canvas, no WebGL, no new dependency.
3. **The scene is a renderer of a huddle**, chosen like the World view's
   `world.as=map|list`: `chats.as=scene|list`. Same chat, same messages, same
   composer. The transcript is the scene's backlog.
4. **The server keeps pacing.** The floor already makes speech take time, one
   speaker at a time ([floor](../../kazusa/references/floor.md)). The client
   lays out and reveals.
5. **No feature here adds a model call or a decision call.** What the scene
   needs beyond the words rides calls that already happen (a field on a bubble
   the character is already sending) or is computed by code (time of day).
6. **A face is the speaker's own choice and everyone present sees it**: an
   optional `face` on a spoken bubble of `send_message`, from the same
   vocabulary as stickers (§6.3).
7. **Looks come in sets, for people and for places.** A character's set is
   outfit × mood (`[<outfit>-]<mood>`, as stickers are today). A place's
   backdrop set is state × time of day (`[<state>-]<time>`). The mood is chosen
   by the character; the outfit and the place's state come from the status
   system ([status](../../kazusa/references/status.md)); the time is picked by
   code from the sim clock.
8. **Art belongs to the world and ships with it**, in the world's repository,
   kept together by file convention and served by plugin routes. Nothing goes in
   `apps/web/public`, and nothing in `IDENTITY.md`, which is in every turn's
   system prompt.
9. **Scene state lives in a Zustand store**, changed by pure reducer functions;
   renderers hold no rules, so rigs or 3D can replace the DOM renderer later
   (§9).

## 1. Build or adopt an engine

The report concludes we should not adopt an engine. That conclusion is right.
Its reasons are partly beside the point, so here is the argument from our code.

### 1.1 What an engine is, and what we would use of it

| Part of a VN engine                       | Kazusa already has                                                                                      | Use the engine's? |
| :---------------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------------- |
| Script language and parser                | There is no script. The story is the simulation, live.                                                  | No                |
| Flow control (advance on click, labels)   | Speech is timed by the floor and the sim clock. Advance on click is a clock hold (§7), not a script.    | No                |
| Game state, variables                     | Keyed stores, ledgers, the canonical message database.                                                  | No                |
| Save, load, rollback                      | Worlds, checkpoints and saves ([worlds](../../kazusa/references/worlds.md) §4). Play is not reversible. | No                |
| Backlog / history                         | `messages.sqlite`, `GET /kazusa/messages`, the virtualized `MessageList`.                               | No                |
| Live updates                              | One SSE stream per tab, `LiveHandler` registry.                                                         | No                |
| Menus, settings, UI chrome                | The shell, registries, shadcn components, URL state.                                                    | No                |
| Asset loading                             | Immutable versioned URLs (`/kazusa/avatar`, `/kazusa/sticker`), the browser's image cache.              | No                |
| **Stage: backdrop, figures, transitions** | Nothing.                                                                                                | This is the gap   |
| **Text box: name, line, reveal**          | Bubbles only.                                                                                           | This is the gap   |

The gap is the two smallest parts, and for static pictures they are image
elements with CSS transitions and a text reveal. Adopting an engine to get them
means running a second state container beside ours and fighting the other eight
rows. It would also break the client's fixed decisions: one backend (D2),
contracts in `@kazusa/client` (D3), registries (D8), one lens layer (D9).

### 1.2 The candidates

License and versions rechecked 2026-11-11 for the first two; the other two are
as the report states them.

| Engine     | Stack                                      | License  | Why not                                                                                                                                                       |
| :--------- | :----------------------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WebGAL     | React 17, Redux, PixiJS 6 (`webgal` 4.6.6) | MPL-2.0  | We are on React 19 and Next 16. Driven by `.txt` scripts; every line would be serialized into its DSL to be parsed back. Its whole runtime is the click loop. |
| Pixi'VN    | PixiJS 8 canvas, UI left to React          | LGPL-2.1 | The closest fit, and still: one dialogue slot, a step history we would have to disable, and a canvas we do not need for `<img>` figures.                      |
| Monogatari | Web Components, global singletons          | MIT      | DOM images like our prototype, but built on reversible script actions and a one-time global init that breaks on React remount.                                |
| Narrat     | Vue 3, Pinia                               | MIT      | Wrong framework. Its side dialogue panel is a layout idea, not code we can use.                                                                               |

SillyTavern's visual novel mode is the nearest prior art for chat-driven
sprites: figures divided across the width, a classifier picking one of a fixed
set of expression labels from each reply. Ours differs where it matters: looks
are per character, and the speaker chooses their own face.

### 1.3 Where the report's reasoning is off

- Its percentages ("85% discarded") are estimates, and its main technical
  objections are about problems we do not have. Text clobbering, a playback
  queue with time dilation and a 4-slot LRU cache for 100-person rooms all
  assume raw, unpaced lines from a crowd. Here a huddle is a small conversation
  and the floor already paces it (§14).
- It recommends PixiJS, Spine and Live2D as phase two. For static pictures a
  canvas adds cost (context loss, texture lifecycle, harder screenshots) and
  nothing we need. A canvas is justified only when figures are rigs (§9).

### 1.4 What we will take from outside, later

Renderer runtimes, not engines, and only when a world's art needs them:

- `three` with `@pixiv/three-vrm` (MIT) for VRM figures.
- A Spine or Live2D runtime for 2D rigs. Both carry license conditions (Spine's
  runtimes are licensed to Spine Editor licensees; Live2D's Cubism SDK has its
  own release terms). Read them before a world depends on either.

## 2. Simulation: what a conversation looks like

The design method ([kazusa skill](../../kazusa/SKILL.md) §0) starts here. What
do people in a room perceive, what does Kazusa already simulate, and what would
the scene show?

| In a real conversation                         | Kazusa today                                                                                             | The scene shows                                   | Missing                                                               |
| :--------------------------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------ | :-------------------------------------------------------------------- |
| You are somewhere.                             | `Chat.placeId`; the place page (`summary`, body, `parent`).                                              | The backdrop.                                     | A backdrop set for the place (§8.2).                                  |
| It is some time of day.                        | The sim clock, `useSimNow()`.                                                                            | The set's picture for that time.                  | Nothing: code picks.                                                  |
| The place is in some condition.                | Nothing.                                                                                                 | The set's picture for that state.                 | A place's state (the status system; default only for now).            |
| Certain people are in this conversation.       | Huddle `members`; SSE `chats`; journal `chat.members_changed`.                                           | Their figures.                                    | Portraits (§8.1).                                                     |
| People walk up and walk off.                   | `talk`, `leavePlace`, system action lines.                                                               | Figures enter and leave.                          | Nothing.                                                              |
| One person speaks at a time, and it takes time | The floor; `composingMs(…, "speaking")`; the `typing` event with `mode: "speaking"`.                     | The speaker stands out; the line appears as said. | The line's text at its start, not its end (§6.2).                     |
| Someone cuts in; a sentence breaks off.        | `CUT_IN`; cut-off lines commit up to the word reached, ending in "—".                                    | Two speakers lit; the first line stops.           | Nothing beyond §6.2.                                                  |
| You see what people do.                        | Action bubbles (`type: "action"`), third person, face to face only.                                      | A narration line.                                 | Nothing.                                                              |
| You see their faces, and they see each other's | Nothing face to face. Stickers (a picture of a mood, 50 to 84 per character) are dropped in huddles      | The figure's expression.                          | A face on a spoken line, shown to viewers and to listeners (§6.3).    |
| You see what they wear.                        | Outfits exist only as sticker name prefixes and `stickers.json` `outfits`. No state says who wears what. | The figure's outfit.                              | The `outfit` status ([status](../../kazusa/references/status.md)).    |
| You do not see thoughts.                       | Monologues live on task rows (observer data). Unsaid lines reach no ledger.                              | Nothing in the Player lens.                       | Lens selectors (`lib/lens/`, not built), if the Observer wants minds. |

Two things follow.

**Characters already give stage directions.** An action bubble is one, and the
`in-person` skill already teaches it. We do not need the model to write more
prose. What is missing is one small categorical fact per line (the face) and one
piece of slow state (the outfit).

**Looks already exist as a vocabulary.** A sticker set names each look
`[<outfit>-]<mood>` and `stickers.json` describes outfits and faces in words.
The imported sets are face crops of full-body expression portraits, so every
sticker name corresponds to a whole-figure picture we can fetch again (§8.4).
One vocabulary drives three pictures of the same thing: the sticker, the
portrait, and later a 3D model's expression.

## 3. Player: what is fun, and where it shows

- **Walking in.** You go to a place, the backdrop is that place at this hour,
  and the people you turned to are standing there.
- **Reading a table by looking at it.** Who is speaking, who just stopped, who
  walked off.
- **A face that changes, and gets noticed.** The same sentence lands differently
  said with a flat stare. Because the others see it too, someone can ask what
  that look was for.
- **Being cut off.** A line stops mid-word with "—" and another figure lights
  up.
- **Small physical business.** Action lines read as narration between spoken
  lines.
- **Reading at your own pace.** Reading mode (§7): the world waits for your
  click, like a visual novel, and the next line is already there when you do.
- **Peeking.** The Observer opens someone else's huddle and watches it as a
  scene, read-only. Also the easiest thing to show a new user.
- **A picture worth sharing.** A scene screenshot (backdrop, figures, the line,
  the world's credit).

Where it surfaces: the Chats view, for a huddle, as its default rendering, with
or without art. One control switches to the transcript and back. Text chats
never use it.

Never fun: a figure for every one of 40 people in a cafeteria, faces that
flicker on every line, waiting several seconds after every click, or any wording
in a character's prompt about sprites, slots or scenes.

## 4. The prototype (M0)

The smallest thing that reads as a visual novel and can be shown. Static
backdrop, static whole-figure portraits, one dialogue box. No change to what any
model reads or says.

```text
┌ chat header (unchanged) ──────────────────────────  [Scene | Transcript] ┐
│                                                                          │
│   backdrop <img>, object-fit: cover                                      │
│                                                                          │
│        ┌────┐      ┌────┐        ┌────┐                                  │
│        │    │      │ ★  │        │    │      ★ speaking: full brightness │
│        │ A  │      │ B  │        │ C  │        others: slightly dimmed   │
│        │    │      │    │        │    │                                  │
│  ┌─────┴────┴──────┴────┴────────┴────┴───────────────────────────────┐  │
│  │ B                                                                  │  │
│  │ The line being said, revealed as text.                             │  │
│  │ sets the bag down                         (action: italic, muted)  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├ composer (unchanged: Say / Do) ──────────────────────────────────────────┤
```

What it does, and from which data:

| Behaviour        | Source                                                                                                                                                          |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backdrop         | `Chat.placeId` → place → backdrop set (new, §6.1) → the picture for the sim hour. No set: no picture, a transparent surface darkened slightly for contrast.     |
| Figures          | Huddle `members` minus the player → each character's default portrait (new). Someone with no portraits is not drawn and takes no slot.                          |
| Enter and leave  | Diff of `members` on SSE `chats`. A fade and a short slide.                                                                                                     |
| Speaker          | `typing` events with `mode: "speaking"`, replayed in `connected.typing`. Two at once light two.                                                                 |
| The line         | `message` events. In M0 a line arrives when it has been said, so it appears whole (§6.2 fixes this).                                                            |
| Actions          | `type: "action"` through the existing `actionLine()`; shown as narration, never in the name plate.                                                              |
| The player       | Not drawn (first person). Their lines show under their display name. Composer unchanged.                                                                        |
| Backlog          | The Transcript toggle (`chats.as=list`).                                                                                                                        |
| Observed huddles | `ObservedChatView` renders the same scene, read-only.                                                                                                           |
| Paused clock     | Nothing arrives; the scene holds.                                                                                                                               |
| Slots            | Five in a wide scene, one on an upright phone (whoever is speaking). More people than slots: the rest are not shown; their lines still appear with their names. |

Left out of M0: expressions, outfits, live reveal, reading mode, audio, replay,
screenshots, anything on a canvas.

Acceptance for M0:

1. Opening any huddle shows the scene. With a backdrop and portraits it is the
   place and the people; with no backdrop the figures stand on a slightly
   darkened transparent surface; with no portraits either it is that surface and
   the dialogue box, still usable.
2. A character joining, speaking, acting and leaving are each visible without
   opening the transcript.
3. Switching Scene and Transcript loses nothing: same messages, same receipts,
   same composer draft.
4. An observed huddle opens as a scene from a link.
5. The backdrop changes with the sim hour when the set has more than one time.
6. On an upright phone one figure shows, whoever is speaking, cropped to the
   bust, and the dialogue box and composer stay reachable.

### 4.1 As built

What the prototype became after being used with real art. Where this differs
from the sketch and table above, this is right.

```text
┌ scene: the backdrop fills all of it, down to the bottom edge ─────────┐
│ 10:00 ⏸ 1× 10× 60× ⏩                        [log] [read] [exit]     │  full screen only
│                    figures                                            │
│   Alex   I haven't. What does it say?             echoes: earlier     │
│   Hanae  That they need volunteers, and nobody—   lines, own names    │
│  ┌ Neru ┐                                                             │
│  ┌──────┴──────────────────────────────────────────────────────┐      │
│  │ Signed up yet. Right, Juno? Nobody but us.               ▾  │      │  one speaker, one line
│  ├─────────────────────────────────────────────────────────────┤      │
│  │ Say something, or *do something*                         ↑  │      │  reply row, same panel
│  └─────────────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────────┘
```

- **The panel holds one line**, under a name plate that is always that line's
  speaker. An action is narration with no plate. A line being said types out at
  the speaker's pace (§6.2).
- **Echoes**: up to two earlier lines above the plate, each under its own name,
  older on top and fainter. In live mode an echo fades about 12 seconds after
  leaving the panel. Clicking one opens the backlog.
- **The reply row is the panel's footer**, and the scene runs to the bottom
  edge. It is the transcript composer's own implementation in another shell, so
  drafts are shared. There is no Say | Do: a reply wholly wrapped in asterisks
  (`*waves*`) is sent as an action, anything else as speech.
- **Controls.** Header: Reading mode, Full screen, then Scene | Transcript, so
  the toggle never moves. Full screen: the time with the top bar's clock
  controls at the top left, and an icon cluster at the top right (backlog,
  reading mode, exit).
- **Full screen** uses the browser's API and falls back to an in-app full-window
  layout where that is missing or refused. View state only.
- **Backlog**: the transcript (`MessageList`) in a panel inside the scene, so it
  also works in browser full screen.
- **Backdrop crop**: `object-fit: cover` anchored at 50% across, 40% down. The
  real pictures are about 1.42:1.

## 5. Architecture

### 5.1 Layers

```text
plugin read model          existing: chats, message, typing, clock
  + portraits, backdrops   new art routes and fields (§6.1)
  + speech start, face     later fields on existing events (§6.2, §6.3)
        │  @kazusa/client schemas, parsed at the fetch boundary
        ▼
lib/scene/director.ts      pure reducers: (SceneState, event) → SceneState
lib/scene/pick.ts          pure: backdrop file for (set, state, sim time);
                           portrait file for (set, outfit, mood)
        │
lib/live/scene-state.ts    Zustand store: scenes by chat id, reading buffer
        │  per-chat selectors, useShallow for collections
        ▼
SceneRenderer              components/views/chats/scene/*
  dom (M0: <img> + CSS)    later: rigs, three (§9), same props
        ▼
overlay (DOM, always)      name plate, line, narration, controls
```

### 5.2 State

Scene state is shared client state, so it follows the client's Zustand rules
([kazusa-client skill](../SKILL.md) §5):

- `lib/live/scene-state.ts` holds data only:
  `scenes: Record<chatId, SceneState>`. Actions are named module exports that
  call `setState` with a reducer from `lib/scene/director.ts`. No store
  wrappers, no contexts mirroring it.
- The existing live handlers and the SWR fetchers call those actions: `message`,
  `typing` and `chats` events, and the huddle's first read (which seeds the
  scene, as other snapshots seed their projections).
- Components subscribe per chat with scalar selectors (`useSceneLine(chatId)`)
  and `useShallow` for the figure list. A scene is created when its view mounts
  and dropped when it unmounts.
- Preferences (reading mode on or off, the default rendering) live in the
  persisted preferences store in `lib/state/`. `chats.as` stays in the URL.
- Art manifests are resources, so they are SWR, not Zustand.

```ts
/** A look by its set-name parts. No outfit means usual clothes. */
interface Look {
  readonly outfit?: string;
  readonly mood?: string;
}

interface Figure {
  readonly id: string; // character id
  readonly slot: number; // stable while present
  readonly look: Look;
  readonly presence: "entering" | "here" | "leaving";
  readonly speaking: boolean;
}

interface SceneLine {
  readonly messageId?: string; // absent while the line is still being said
  readonly speakerId: string;
  readonly kind: "speech" | "action";
  readonly text: string;
  /** Sim-time window of the saying, when known (§6.2). */
  readonly said?: { readonly from: number; readonly until: number };
  readonly cutOff: boolean;
}

interface SceneState {
  readonly chatId: string;
  readonly placeId?: string;
  readonly figures: readonly Figure[];
  readonly lines: readonly SceneLine[]; // the few on screen, newest last
  /** Lines received but not shown yet: reading mode (§7), or catching up. */
  readonly ahead: readonly SceneLine[];
}
```

Deliberately absent: URLs, pixel positions, timers, the renderer kind, and the
time of day (renderers read `useSimNow`).

### 5.3 Director rules

- **Who is drawn.** Only members who have portraits. Someone without them is
  never a figure and never takes a slot, whatever they say or do; their lines
  show in the dialogue box under their name, as the player's do. Until it is
  known whether a member has portraits, nothing is drawn or reserved for them.
- **Five slots or one.** A wide scene has five slots; an upright phone has one.
  There is nothing in between.
- **Balanced.** In the five-slot scene the figures stand evenly about the
  centre, and an even number skips the middle slot:

  | Figures | Columns (0 to 4, left to right) |
  | :------ | :------------------------------ |
  | 1       | 2                               |
  | 2       | 1, 3                            |
  | 3       | 1, 2, 3                         |
  | 4       | 0, 1, 3, 4                      |
  | 5       | 0, 1, 2, 3, 4                   |

  People keep their left-to-right order. When someone joins or leaves, the
  others slide to their new columns; nobody jumps, and nobody moves because
  someone speaks.

- **One slot.** The figure is whoever the newest line belongs to or is speaking
  now, at bust framing; a change of speaker is a cross-fade in place.
- **More drawable members than five.** The rest are not drawn and nothing lists
  them. When one of them speaks or acts, they take the place of whoever did so
  longest ago.
- **The lit figure** is the speaker of the line in the panel, for exactly as
  long as that line is there: speech or action, finished or still being said,
  and in reading mode the line shown, not the one waiting. Everyone else is
  slightly dimmed, even someone speaking into the echoes. When the panel is
  empty, or its line belongs to the player or to someone who is not drawn,
  nobody is dimmed. Nobody changes size or position for speaking.
- **One scale.** Every portrait is drawn at its natural pixel size times one
  factor for the whole scene, standing on one floor line. Nothing is fitted to a
  box (§8.1).
- **Centred and stood on the figure, not the picture.** The point put on a
  column's centre is the figure's own (`placement.centre`, the middle of the
  face), and the row put on the floor line is where it stands
  (`placement.floor`), so a wing, weapon or bag that reaches out to one side or
  below the shoes moves neither. Each outfit's `scale` draws the character as
  tall as they are (§8.1).
- **Face.** A figure keeps the mood of its last line that carried a `face`
  (§6.3). It returns to neutral when the person leaves the huddle.
- **Lines.** The panel holds one line. The line it replaces becomes an echo; at
  most two echoes show. When two people speak at once, the line that started
  most recently takes the panel and the other lands in the echoes.
- **Cut-offs.** A committed text that ends in "—" and is shorter than the line
  being revealed stops the reveal there.
- **Catching up.** At 1x the server's pacing is the pacing. When the clock runs
  faster, lines can arrive faster than they can be read: they wait in `ahead`,
  each line gets a minimum time on screen by its length, and the overlay shows
  "N behind · Jump to live". The view never changes the clock outside reading
  mode.
- **Opening mid-conversation.** The scene starts from the current members and
  the last few cached messages; nothing is replayed.

### 5.4 Renderer contract

```ts
interface SceneRendererProps {
  readonly chatId: string; // subscribes to its own scene
  readonly art: SceneArt; // manifests for this scene's cast and backdrop
  readonly maxFigures: number;
}
```

A renderer draws the best form of art it supports and falls back down the list:
model → rig → portrait. With none of them the person is not drawn.

### 5.5 Where it lives in the client

- `components/views/chats/scene/`: `scene-view.tsx`, `dom-renderer.tsx`,
  `dialogue-box.tsx`, `figure.tsx`, `reading-controls.tsx`.
- `lib/scene/`: `state.ts`, `director.ts`, `pick.ts`, `layout.ts`, tests beside
  each (tables of events in, states out).
- `lib/live/scene-state.ts`: the store and its actions.
- `chats/search-params.ts`: `chats.as` (`scene` | `list`), default `scene` for a
  huddle when the `scene` domain is live, `history: "replace"`.
- `chat-view.tsx` and `observed-chat-view.tsx` pick `MessageList` or `SceneView`
  for `chat.type === "huddle"`. No shell change and no new registry entry: this
  is inside an existing stage view.
- Domain `scene` in `Domain` and in `/kazusa/world` capabilities (D10).
- D1 holds: no lore in components. D5 holds: a scene loads art only for its own
  cast. The chrome stays the neutral instrument panel; the scene is the one
  surface where the world's art dominates, so the overlay uses the existing
  surface and foreground tokens over a scrim, no gradients.

## 6. Backend changes

Each is a contract change first (`@kazusa/client`), then the plugin, then the
proxy allowlist and access policy (`observe`, like stickers).

| #   | Change                                 | Phase | New model calls | New decision calls | Prompt and schema cost                                                     |
| :-- | :------------------------------------- | :---- | :-------------- | :----------------- | :------------------------------------------------------------------------- |
| 6.1 | Portrait and backdrop routes, fields   | M0    | 0               | 0                  | None                                                                       |
| 6.2 | A spoken line's text when it starts    | M1    | 0               | 0                  | None                                                                       |
| 6.3 | `face` on a spoken bubble, seen by all | M1    | 0               | 0                  | About 20 mood words once in the cached tool schema; a few tokens when used |
| 6.4 | Outfit, from the status system         | M2    | 0               | 0                  | One optional `start_task` parameter for characters with outfits            |
| 6.5 | Reading mode hold                      | M2    | 0               | 0                  | None                                                                       |

### 6.1 Art routes and fields (M0)

- `GET /kazusa/portraits?id=`: a character's portrait set: names, each picture's
  URL and `placement` (§8.1). Fetched per scene member, never per roster row.
- `GET /kazusa/portrait?id=&name=&v=`: one picture, served exactly like stickers
  (roster ids only, names in the set only, raster only, immutable cache, version
  from mtime).
- `CharacterSummary.portraitUrl?`: the portrait the figure rests in (§8.1),
  beside `avatarUrl`.
- Place frontmatter gains `backdrop: <set>` in `PLACE_FRONTMATTER`
  (`location/map.ts`). The read model resolves it up the `parent` chain, so a
  room without one uses its building's and 720 places need a few dozen sets.
  `Place.backdrop?: string`.
- `PlacesResponse.backdrops`: `Record<set, { files: Record<name, url> }>`, and
  the world's `times` (§8.2). The client picks the file; the server pushes
  nothing as time passes.
- `GET /kazusa/backdrop?set=&name=&v=`: one picture from the world's
  `shared/backdrops/<set>/`.
- A `backdrop` that names no set is a `problems` entry for `wiki_lint`, never a
  failed map load.
- This is a frontmatter field, not prose mining (D4), and something a
  description cannot say, so it does not break Location's "no flag for what a
  description can say".

### 6.2 The line as it is said (M1)

Built (2026-11-12) as described below, with these rules for the reveal:

- `composingMs`, `cutOff`, `heardOf` (what has been heard so far, at word
  boundaries) and `sayingOf` (what shows so far, letter by letter) live in
  `@kazusa/client`, so the client reveals by the server's rates.
- The screen is faster than the saying: a line is typed out in the first 70% of
  its speaking time (`REVEAL_SHARE` in `apps/web/lib/scene/reveal.ts`) and
  stands whole for the rest, a pause before it lands and the next begins. The
  server's timing is untouched. A cut commits only what had been said, in whole
  words, so what was typed ahead of that leaves the screen.
- A line that never lands (the speaker's run ended, they left) disappears: a
  stop with no message before it. The server therefore sends a line's message
  before the stop that ends its saying; the other way round, every finished line
  left the panel, came back as a new line with its entrance, and held the next
  line back until it was already said.
- A line lands in place: the same element, no entrance, its time on screen
  counted from when it started.
- There is no "…" state: a line being said is the typewriter. Against a Gateway
  whose speaking events carry no text, the panel keeps the previous line until
  the message lands.
- A world's custom `messaging.rates` are not sent to the client yet, so its
  reveal uses the default rates.

Before this, a spoken bubble sets `typing { mode: "speaking" }`, waits its
speaking time, then commits the message. Clients learn the words only when they
are over, so a scene can only show "…" and then a finished line while the next
speaker has already started.

Change: the speaking event carries the line.

```ts
// TypingStreamEvent, when mode is "speaking" and isTyping is true
speech?: {
  text: string;
  face?: { name: string }; // §6.3
  from: number; // sim time
  until: number;
}
```

- `Messaging.play` already has the text and the duration when it calls
  `setTyping`. Nothing else changes: the message still commits at the end, and
  characters still hear a line when it is finished.
- The client reveals the text across `from..until`, converted through the clock
  projection, so a pause freezes the reveal and speed changes are followed.
- A cut-off commits `cutOff(text, fraction)`; the reveal snaps to the committed
  text.
- Faithful to the simulation: [floor](../../kazusa/references/floor.md) says a
  line "is heard as it is said". Only the wire was late.
- It is what makes reading mode possible (§7), and the hook for voice later.

### 6.3 Face (M1)

Built (2026-11-12) as described below, with these differences:

- The delivery freezes `face: { name, seen? }`, not `{ name, v }`. The client
  finds the name in the portrait set it already fetched, whose URLs carry their
  versions, so a replaced picture also shows on older lines, as with stickers.
- `seen` is what listeners read, `kazusa-deliveries#face` (`({look})`) filled
  with the look text of the sticker with that name, else the mood word. It is
  decided before the line is said (`sayFaces` in `messaging/faces.ts`), so a
  replayed send matches: only a face that differs from the speaker's previous
  one in that chat, or the one before it in the same call, gets it. The previous
  face is kept in memory (`Messaging.shownFace`) and forgotten when they leave;
  after a restart the first face a speaker shows is read again.
- In usual clothes the picture's name is the mood. A mood only an outfit has
  shows the neutral picture (`pickPortrait`), and listeners still read the mood.
- The director keeps each member's face in `SceneState.moods`: from the speaking
  event as a line starts, else from the message as it lands (an action, an older
  Gateway), seeded from history and from a line already being said when the
  scene opens, worn by a figure as it walks in, dropped when they leave. In
  reading mode a line's face, and its speaker's turn (who is drawn when not
  everyone fits), wait with the line: they change when the reader advances onto
  it (`show` in the director), so the picture never runs ahead of the text.

The character chooses the face, in the `send_message` call they are already
making, and everyone present sees it.

**Which tool.** There is no separate tool for speaking in person. `talk` only
turns to people where you are and returns the conversation's address
(`chat:huddle:<id>`); it carries no line. Every line, face to face or by text,
is a bubble of `send_message` to an address, and the address alone says which
medium it is. So `face` is a field of `send_message` bubbles and of nothing
else: `talk`, `create_group` and `manage_chat` say nothing and take no face. The
same call serves both media, so each bubble kind is kept in one and dropped in
the other, and `face` follows the rule already there:

| Bubble part      | Face to face (`chat:huddle:`, or the player's `aloud`) | Text chat (`chat:direct:`, `chat:group:`) |
| :--------------- | :----------------------------------------------------- | :---------------------------------------- |
| speech           | said, takes speaking time and the floor                | typed, takes typing time                  |
| `type: "action"` | kept, takes no time                                    | dropped                                   |
| `{ sticker }`    | dropped                                                | kept                                      |
| `face` (new)     | kept, shown and read                                   | dropped                                   |

**The field.** A text bubble object may carry `face`:

```json
{ "text": "I said no.", "face": "annoyed" }
```

- The value is a mood from the character's own set: the distinct moods across
  all their looks (the part of each sticker name after the outfit). About 20
  words for the largest imported sets, against about 80 full names.
- The list does not depend on what they are wearing or how they feel, so the
  tool definition never changes with state and stays in the cached prefix.
- A character with no looks has no `face` field at all, as with stickers.
- It applies from that bubble on. Most lines carry none. The wording
  (`kazusa-tools#send_message.messages.face`) follows the sticker's: set it when
  your face changes, not on every line. `in-person` gains two sentences.
- An unknown mood is dropped silently and the line is said. It never fails the
  call: a refused `send_message` costs a whole retry.
- Face to face only. In a text chat it is dropped, as actions are; a phone has
  stickers.
- An action bubble may carry it too ("looks away", `sad`).

**Resolving it.** With the outfit the character has on (§6.4; usual clothes
until that exists), the look is `<outfit>-<mood>`. If that outfit has no such
mood, the figure keeps the outfit and shows its neutral face; listeners still
read the mood. The resolved name is frozen on the delivery (`face: { name }`, as
`sticker` is), so an old line shows the outfit of its moment.

**What everyone reads.** People see faces, so listeners do too:

- The line a listener receives, and the same line in every ledger and in the
  decision model's context, carries the look in a few words when it changes: the
  `look` text from `stickers.json`, else the mood word. Wording and placement
  belong to `kazusa-deliveries`; as a shape:
  `- [Hoshino 12:03] (annoyed, a flat stare) I said no.`
- Frozen at send, like a sticker's text. Nobody makes a vision call.
- Only on change: a face equal to that speaker's previous one adds nothing.
- It is part of the line, not a message of its own, so it adds no stimulus and
  no attention decision.

**On the wire.** `ChatMessage.face?: { name: string }` and the same on the 6.2
event, so the figure's face changes as the line starts.

Why a field and not a sticker bubble: a sticker bubble is a message of its own,
and every message in a huddle is a stimulus and an attention decision for each
listener. The field reuses the sticker vocabulary without that cost. Why not the
decision model: a face that characters react to has to be the speaker's own, and
a judged face would also be one more answer to produce per send.

### 6.4 Outfit (M2, from the status system)

Clothes persist: nobody changes between two lines. What a character is wearing
is state, and it belongs to the planned status system, designed in
[status](../../kazusa/references/status.md). In short:

- `outfit` is the first attribute: a state on a character, whose possible values
  are the outfits their set declares plus their usual clothes.
- The character changes it in a call they already make: an optional parameter on
  `start_task`, since changing clothes happens at an activity boundary. No new
  call of any kind.
- The scene reads it through SSE and sets `Look.outfit`; stickers can use it to
  be picked by mood alone; people present read it in a few words.
- Until it exists, everyone wears their usual clothes. Nothing in M0 or M1 waits
  for it, and nothing built there has to change when it arrives: `Look` already
  has the field.

### 6.5 What does not change

- No new tool. No decision question added.
- No ticking push: reveal progress and the time of day are computed on the
  client from sim time, like desires and trips.
- No floor hold while the player types (§14).

## 7. Reading mode: advance on click

A toggle (the open book) for people who want to read at their own pace. It is a
client-side convenience and deliberately simple. Offered only to someone who may
control the clock (`manage`), because the world's time is one clock for
everyone.

- While on, new lines wait. The world runs while nothing is waiting and pauses
  as soon as a line is.
- An advance shows the next waiting line: a click or tap anywhere on the scene,
  or Space, Enter or →. When nothing else waits, the world runs again at the
  speed it had.
- A line counts as waiting from the moment it starts being said (§6.2), so the
  next line is usually there when the reader clicks. The world was paused as it
  started, so it is typed out from its start once the reader has it, the same as
  a line asked for before it came. If someone cuts in on it afterwards, the
  panel shortens to what was said.
- An advance while the panel's line is still being typed out shows that line
  whole; the next advance moves on.
- When the reader has asked and nothing waits, the panel says who is thinking or
  speaking, in words, and only what is known: someone whose line is already on
  screen is not "speaking" (its saying runs on after the reader has it), and
  with nobody speaking or thinking it says "Waiting for someone to speak", never
  that a line is coming.
- Turned on with the clock at 0, it starts the world at 1×, since it needs the
  world running to get a line. Turned off, it restores exactly the speed it
  found, 0 included.
- It turns itself off, showing everything that waited, when the rendering
  switches to the transcript, the chat is left, the huddle ends, or the speed is
  changed elsewhere (then nothing is set back).
- Replying shows what waited first, then sends.
- View state: never saved, never in the URL. Opening a chat cannot pause the
  world.

Not built, by decision: holding the clock inside Messaging, and jumping the
clock past the rest of a line on advance. They would shave a few seconds and
close one edge case, at the cost of new state in the code that owns pacing.

## 8. Assets

### 8.1 Character looks

Everything for a character stays in their workspace, under the same names:

```text
workspaces/<id>/
  avatar.webp
  stickers/                 # exists: face crops, 256 px
    happy.webp
    gym-happy.webp
    stickers.json           # the vocabulary: outfits, each look in words
  portraits/                # new: whole figures, same names as the stickers
    neutral.webp
    happy.webp
    gym-happy.webp
    portraits.json          # optional: size, eyeline, placement (below)
```

- A sticker and a portrait with the same name are the same look: one outfit, one
  mood. `stickers.json` describes both. No second vocabulary.
- **Scale is in the pixels.** The importer scales every picture by one factor
  (0.8) relative to a 1,920-high source canvas, so a sprite drawn on a taller or
  shorter canvas comes out the same size as the rest, and it never trims the
  canvas bottom, which is the floor every figure stands on. The renderer draws
  each picture at its natural size times one scene-wide factor. Sizing figures
  by eye position was tried and dropped: it enlarged short characters and gave
  one character's outfits different head sizes.
- **Placement is per outfit**, in `portraits.json`:
  `"placement": { "": { "centre": 0.52, "eyes": 0.17, "scale": 0.93 }, "gym": { "centre": 0.48, "floor": 0.95, "eyes": 0.15, "scale": 0.98, "offset": [0, -20] } }`.
  Keys are an outfit's word (`""` for pictures without one) or one picture's
  name, which wins.
  - `centre` is where the figure is across the picture (0 left edge, 1 right;
    the middle when absent): the importer writes the middle of the face the
    stickers were cut from. Taking the middle of the picture's bottom rows was
    tried and dropped: a wing tip, a bike wheel or one toe is often all that
    reaches them.
  - `floor` is where the figure stands down the picture (0 top edge, 1 bottom;
    the bottom edge when absent). The canvas bottom is usually the floor, but a
    wing, a weapon or a bike's wheel can reach lower than the shoes, and the
    figure then floats above everyone else's feet. The importer looks for the
    lowest row with enough solid picture just above it, within a stride of the
    figure's centre, so a tip or a strand doesn't count (36 of this cast's 357
    outfits stand above the bottom edge, most by 1–2%, the largest by 17%). A
    stride, not less: in a wide stance the nearer foot is the lower one in the
    picture and well out from under the head, and a narrower look took the far
    foot for the floor and sank the figure. Something solid within a stride that
    isn't a foot (a flag, a rifle's muzzle, a wheel) is corrected by hand (3
    outfits).
  - `eyes` is where the eyes are down the picture, the same way.
  - `scale` (1 when absent) draws the character as tall as they are. The source
    art fills its canvas from halo to shoes whoever it shows, so its pixels say
    nothing about height. The importer takes the character's height (the plan's
    `height`, or `--height`): while standing, the eyes are at one fraction of
    anyone's height, whatever the arms, wings, weapon or halo do, so
    `scale = 8.11 px/cm × height ÷ the pixels from floor to eyes`. For this cast
    that is 0.83 (128 cm) to 1.23, median 1.
  - The rule is wrong for a figure that isn't standing (seated, kneeling, lying,
    crouched): its eyes are low for another reason. Those are set by hand, to
    the value that makes the head as large as in the character's standing
    outfits (20 of this cast's outfits). The importer keeps a `scale`, `floor`
    or `offset` it finds, so a correction outlives a re-import; the world
    repository lists the ones made by hand, with reasons, in
    `art-sources/portraits/_placement-by-hand.json`. Head size within a
    character is checked by eye, heads side by side as drawn, and by the
    distance between the eyes where both show; the sticker's box was used first
    and ran 5–10% small.
  - `offset` is `[right, down]` in the picture's own pixels, by hand.
  - Sizing by face size across characters was tried twice (the sticker's box,
    and the area where expressions differ) and dropped: both vary too much
    between characters. Within one character they agree well enough to check one
    outfit against the others.
- **What the scene does with it** (`standFigure`): `centre` goes on the column's
  centre and `floor` on the scene's floor line, at `scale` times the scene's own
  factor. `FIGURE_HEIGHT` is that factor's one knob, the size of the whole cast:
  it is below 1 so that the tallest characters' heads stay in the scene, and no
  figure is ever shrunk on its own to fit. The one-slot scene (an upright phone)
  is framed by the `eyes` instead: a character of typical height's are at one
  place, and a fifth of the wide scene's height difference is kept
  (`BUST_HEIGHT_SHARE`), so a tall character's face is a little higher in the
  frame and a short or seated one's a little lower, without anyone's leaving it.
- `size` and `eyeline` are still written, from the `neutral` set, but nothing
  reads them.
- The default portrait, what the figure rests in, is in the usual clothes until
  outfits come (§6.4): `neutral`, else `calm`, `content` or `happy`, else the
  first by name. A character with no `portraits/`, or with pictures of outfits
  only, is not drawn in a scene at all. Built differently from the first plan
  (first by name, any outfit): a character with only swimsuit art stood in a
  meeting room in it, and one without `neutral` rested `angry`.

### 8.2 Backdrop sets

A place's pictures are a set, as a character's are, with the two axes that fit a
place: its **state** (like an outfit) and the **time of day** (like a mood).
Many places share one set, so sets live in one shared library:

```text
shared/backdrops/
  classroom/
    day.webp
    dusk.webp
    night.webp
    festival-day.webp       # later: a state of the place, as a name prefix
    backdrops.json          # optional: { "states": { "festival": "…" } }
  hallway/
    day.webp                # a set with one picture shows it at every hour
```

- A place page names a set: `backdrop: classroom`. Rooms inherit their
  building's unless they name their own.
- A name is `[<state>-]<time>`. A first word is a state only when
  `backdrops.json` declares it, the rule sticker names use for outfits.
- **Code picks the picture; no model is asked.** Time is deterministic:
  - The world declares its times of day once, in the plugin's config
    (`scene.times`, default `day` from 06:00, `dusk` from 17:00, `night` from
    19:00; a world sets its own names and hours).
  - The picture is the set's file for the current time. If the set has none for
    it, the nearest earlier time it does have, wrapping round the day.
  - The place's state is the default (no prefix) for now. When the status system
    gives places a state, the same pick tries `<state>-<time>` first.
- The pick is a pure function in `lib/scene/pick.ts`, evaluated from
  `useSimNow("minute")`, with a cross-fade when it changes.
- 16:9, about 1920 wide, WebP, `object-fit: cover`.

### 8.3 Distribution

Art ships in the world's repository, beside the stickers that are already there;
cloning it at setup is acceptable. The pilot (§8.4, step 7) measures the real
size before the full import. For scale: the 4,769 stickers at 256 px are most of
the Kivotos template's 75 MB, and whole-figure portraits will be several times
that per picture.

If the measured size turns out to be a problem, the reserve is to store one
whole figure per outfit plus a small face patch per mood (the imported pictures
differ only in the face) and stack them in the renderer. It is an optimization,
not part of the plan.

### 8.4 The import (run 2026-11-11 and 12)

The earlier sticker runs kept nothing but the 256 px crops, so the source files
and the mapping from file to sticker name were rebuilt.

- **Tools.** `scripts/portraits.mjs` (stage, then place) and
  `scripts/backdrops.mjs` (list, stage, place, assign, check). Originals are
  cached outside the repository and never fetched twice; plans, labels and place
  assignments are kept with the world under `art-sources/`.
- **Portraits.** Each downloaded picture is cut the way its sticker was and
  matched to the character's existing stickers by the face, within the set's
  outfit; anything unmatched or ambiguous is left out, never guessed. For the
  Kivotos world: 4,642 of 4,769 stickers have a portrait (97.3%), all 144
  characters, about 0.9 GB.
- **What the first run missed** (cross-checked against the stickers 2026-11-13).
  Where the stickers were cut is now settled to the pixel and, when nothing
  matches, searched for over the whole picture; a left-over picture just over
  the threshold takes the one sticker left when it is clearly no other. The
  match looks at the face only, so a series of another outfit can pass: staging
  flags a set whose pictures are far from their stickers outside the face: five
  outfits were drawn from another outfit's series, and five more had a series
  that could never match (two pairs were swapped). Three outfits whose stickers
  can't be matched by measure are named by eye, in
  `art-sources/portraits/_names-by-hand.json`. What is still missing: pictures
  the source doesn't have in that outfit's series, looks too alike to tell
  apart, and two outfits whose stickers were cut from other art.
- **Backdrops.** 1,363 files in the source category, 1,042 used, in 528 sets
  (361 with more than one time of day, 75 with states), about 130 MB. 321 places
  name a set, 382 more inherit one, 17 have none.

## 9. Rigs and 3D

Nothing in §5 or §6 is specific to flat pictures. That is the whole plan for 3D:
the state and the signals are the durable part, and a renderer is replaceable.

### 9.1 What carries over unchanged

| Need in 3D                        | Already supplied by                                                  |
| :-------------------------------- | :------------------------------------------------------------------- |
| Who is present, entering, leaving | `SceneState.figures[].presence`                                      |
| Who is speaking, and for how long | §6.2 (`from..until`): drives mouth movement without audio            |
| Expression                        | §6.3 `Look.mood`, mapped to the model's expressions                  |
| Outfit                            | §6.4 `Look.outfit`, mapped to a model variant                        |
| Gaze                              | The speaker (everyone looks at who is talking)                       |
| Where they stand                  | Slots now; later, spots within a place (Location already has `spot`) |
| Light and the place's condition   | The same time and state that pick a backdrop                         |

### 9.2 What is new

- **A renderer chunk.** `three` with `@pixiv/three-vrm`, loaded with
  `next/dynamic` (`ssr: false`) only when a scene's art has models, so worlds
  without them never download it. Dispose models on leave; the same cap on
  figures.
- **A model manifest** per character (`workspaces/<id>/model/model.json` beside
  `model.vrm`): mood → expression weights, outfit → model file or material set,
  height and eye height.
- **A mood map with defaults.** VRM's standard expressions are few (happy,
  angry, sad, relaxed, surprised, neutral). The shared mood vocabulary maps onto
  them by default, and `model.json` overrides per model. Unknown moods fall back
  to neutral.
- **Gestures.** A small shared pool of body animations (idle, explain, excited,
  arms crossed, thinking, nod). If chosen at all, chosen like the face: an
  optional field on the bubble, never a call of its own. Action bubbles stay
  narration text: free prose is not turned into animation.
- **Who a line is to.** Heads turning to the person addressed would need that
  fact. It is not planned; if it ever is, it rides a call that already happens.
- **Camera.** Deterministic shots from scene state, computed in the renderer.
- **The room.** First the same flat backdrop behind a transparent canvas. Then a
  panorama. Then a modelled place with named spots.
- **Fallback.** A character with no model is drawn as their portrait on an
  upright plane, so a world never needs every model before turning 3D on.

### 9.3 One renderer per scene

Flat rigs (Spine, Live2D) and 3D models do not share a canvas well. A scene
picks one renderer from its world's art (`dom`, `rig` or `three`) and every
figure falls back within it. The report is right about this.

### 9.4 Voice

Out of scope, but the seam is §6.2: speech has a start, a text and a duration. A
voice clip would start there, and its real length would have to become the
line's speaking time, which is a floor change with its own design.

## 10. Phases

One pull request per item (the project's rule), each usable alone.

**M0. A scene you can show.** No model changes.

1. Contract and plugin: portraits, backdrop sets and `scene.times`, `backdrop`
   on places, the `scene` domain, proxy allowlist and access policy. Built.
2. `lib/scene` (director, pick, layout, tests) and the Zustand store. Built.
3. DOM renderer, dialogue dock, `chats.as`, both chat views, full screen, the
   backlog, reading mode (§7). Built.
4. The portrait and backdrop importers, and the import (§8.4). Built and run.

**M1. It feels alive.**

5. Speech carried on the speaking event (§6.2); the reveal. Built.
6. `face` on spoken bubbles (§6.3): schema, delivery, what listeners read, the
   skills' wording, the client field. Built.

**M2. Clothes.**

7. The status system's first slice, `outfit`
   ([status](../../kazusa/references/status.md) §5), and the scene reading it.
8. Scene screenshot (the existing `modern-screenshot` path and credit footer).

**M3. Sharing.**

9. Replay a past huddle as a scene from canonical messages. Needs the said
   window stored on the message (pace is judged, so it cannot be recomputed).
10. A read-only link to a live or replayed scene in public visitor mode
    ([auth](../../kazusa/references/auth.md)).
11. Follow a character: the scene moves with them between huddles and places.
12. A place's state choosing backdrops, once places have one.

**M4. Rigs and 3D** (§9), when a world has the art.

## 11. Risks and what to measure

| Risk                                                | Measure or mitigation                                                                                                    |
| :-------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| Models set `face` on every line, or never           | Count faces per spoken line and distinct moods per character in a live run; tune the skill wording, as for stickers.     |
| `face` raises `send_message` failures               | Unknown moods are dropped, not refused. Compare the failure rate before and after.                                       |
| Seen faces make characters talk about faces         | Read a live table after M1. The look is shown only on change and in few words; cut it to the mood word if needed.        |
| Lines land late relative to the highlight in M0     | Known and accepted for M0; §6.2 is the first item of M1.                                                                 |
| Reading mode still feels slow                       | Measure click-to-line wait in a live huddle. If it is often over a second: a deeper buffer for watching, off by default. |
| A reading-mode hold left on freezes the world       | Not durable; released when the view closes; the top bar shows the pause.                                                 |
| The clock above 1x makes a live scene unreadable    | The catch-up buffer and "Jump to live".                                                                                  |
| Portrait sizes differ between characters and worlds | A `scale` per outfit from the character's height, corrected by hand for poses that aren't standing (§8.1).               |
| Repository size                                     | Pilot numbers before the full import; the reserve in §8.3.                                                               |

## 12. Open questions

1. **Rights**: full-size franchise art in a public repository is a larger
   exposure than 256 px stickers. Shipping it with the world is decided; this is
   only a flag.
2. **Is the player drawn?** Assumed no (first person).
3. **The name** "Scene" in the UI.
4. **"Assets placed together"** is read here as: a character's stickers and
   portraits side by side in their workspace under the same names, and one
   shared `shared/backdrops/` library. If it meant one top-level art folder for
   the whole world, §8.1 moves but nothing else changes.
5. **The status system's code name** and the rest of
   [status](../../kazusa/references/status.md) §6.

## 13. Decision log

- **A face's words are frozen only when it changes, decided at send**
  (2026-11-12, building §6.3). The name goes on every line that carries a face,
  so the figure is right however the scene was opened; what listeners read
  (`seen`) is set before the line is said, against the speaker's last face
  there, so the retained plan and a replay agree. Comparing when each listener
  is notified would need the order of deliveries at read time.

- **`face` is on `send_message`, the one tool that says anything** (2026-11-11,
  second review). `talk` opens or joins a face-to-face conversation and returns
  its address; lines still go through `send_message`. The field is kept face to
  face and dropped in text chats, mirroring how stickers are dropped face to
  face.
- **Relationship values are not frontmatter and not fixed** (2026-11-11, second
  review): generic pair attributes in the status system, with a design of their
  own ([status](../../kazusa/references/status.md) §4).
- **Faces are a bubble field, chosen by the speaker, and seen by listeners**
  (2026-11-11, review). The first draft had the decision model judge a face in
  the speech judgment and kept it invisible to characters. Review asked for
  characters to see faces and for the choice to come through the chat tool. A
  face characters react to must be the speaker's own, and a field costs no call.
  A sticker bubble in huddles was rejected: one more message, so one more
  attention decision per listener per face.
- **No new model or decision calls** (2026-11-11, review). Judged outfit and
  judged addressee were dropped. Outfit moved to the status system, set on
  `start_task`; who a line is to is not planned.
- **Backdrops are sets, like stickers** (2026-11-11, review): state × time of
  day, `[<state>-]<time>`, picked by code from the sim clock. Replaces "one
  picture and a colour tint". States exist in the naming now and switch later.
- **Outfit belongs to the status system** (2026-11-11, review), sketched in the
  kazusa skill's [status](../../kazusa/references/status.md) so the scene and
  stickers share one source.
- **Members without a slot are ignored** (2026-11-11, review). No chips, no
  "also here".
- **Five slots or one, balanced** (2026-11-11, third review, after seeing the
  prototype in a browser). Filling from the centre outward left a lone figure
  off-centre with an even slot count, and two-to-four-slot layouts on narrow
  screens overlapped badly. Now a wide scene always has five slots with the
  figures balanced about the centre (even counts skip the middle), and an
  upright phone shows one figure, the speaker.
- **The speaker is lit, not scaled** (2026-11-11, third review). Scaling from
  the feet lifted the speaker's eyes above everyone else's.
- **No portraits, no figure** (2026-11-11, third review). The avatar card stood
  in a slot among full figures and looked wrong; someone without art is not
  important enough to take one. Their lines still show.
- **Every huddle is a scene** (2026-11-11, third review). Without a backdrop the
  surface is transparent, slightly darkened; the figures in front are still
  worth seeing. The "has art" gate on the default is gone.
- **Art ships in the world's repository** (2026-11-11, review). The optional art
  pack was dropped; layered storage is only a reserve.
- **Reading mode** (2026-11-11, review): advance on click by holding the world
  one unheard line ahead, so the next line is there when the reader clicks.
- **No reduced-motion variant** (2026-11-11, review).
- **Scene state is a Zustand store** (2026-11-11, review), per the client's
  rules.

- **One line in the panel, echoes above it** (2026-11-12, after use). The
  three-line box put the newest speaker's name plate over an older line by
  someone else. Now the panel holds one line and earlier lines sit above the
  plate under their own names.
- **The reply row is in the panel; no Say | Do** (2026-11-12). The separate
  composer below the scene did not match its width and stopped the backdrop
  short. A reply wrapped in asterisks is an action.
- **Reading mode is client-side and simple** (2026-11-12). An Auto / Manual
  rework with quiet detection was built and withdrawn in favour of the first
  logic. The server-side hold and clock jump from the earlier §7 are dropped.
- **In reading mode the picture waits with the line** (2026-11-13, after use). A
  face changed as its line started, before the reader had advanced onto it, and
  a line already started was shown whole on an advance, so only a line asked for
  in advance was typed out. Now faces and turns change on the advance, every
  line is typed out, and a click while one is being typed shows it whole.
- **The lit figure follows the panel's line** (2026-11-12), not speaking events,
  which dimmed a speaker the moment their line finished.
- **Figures share one scale** (2026-11-12). Sizing by eye position rescaled
  every character; the importer's per-set height fit did too. Both are gone.
- **Figures are centred on the face** (2026-11-12), not the picture's box.
- **Figures are as tall as their characters** (2026-11-12): a `scale` per outfit
  from the character's height and the eye height in the picture, set by hand for
  the few poses that aren't standing. Matching face sizes across characters was
  tried and made sizes worse.
- **Figures stand on their feet** (2026-11-12), not on the picture's bottom
  edge: a wing, weapon or wheel that reaches lower left some of them floating.
- **One number sizes the whole cast** (2026-11-12): `FIGURE_HEIGHT`. Making the
  tallest fit is never done by shrinking individual figures.
- **No "…"** (2026-11-12): with the line delivered as it starts, a line being
  said is the typewriter.

## 14. Where the research report differs from this code

The report had no access to the repository. Corrections, so its details are not
copied by mistake:

| The report says                                                                | In this code                                                                                                                                                                    |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Places are `shared/locations/<loc>.md`                                         | `shared/wiki/entities/places/<place_id>.md`, parsed by `PLACE_FRONTMATTER`.                                                                                                     |
| A room holds 20 to 100 agents in one conversation                              | A place holds many huddles. A huddle is one small conversation; huddles never merge, and people split off side conversations.                                                   |
| `sub_clusters` in place frontmatter for "conversation islands"                 | Redundant: that is what a huddle is, created by `talk`, not by a place's configuration.                                                                                         |
| A 4-slot LRU cache is the core of the stage                                    | A one-line rule for the rare large huddle (§5.3).                                                                                                                               |
| A client "time-dilation playback queue" paces lines by word count              | The server paces speech: speaking time per writing system, a judged pace, one floor per huddle. The client only catches up above 1x.                                            |
| Lines clobber each other 200 ms apart                                          | A spoken line waits for the floor unless its speaker cuts in, which is a judged, visible event.                                                                                 |
| Focusing the input sends a floor-hold that pauses NPC turns                    | No such route, and the opposite design: the player is unpaced and can talk over anyone, to see who stops. Holding the world is reading mode's job, on a click, not on focus.    |
| Emotion comes from a `record_thought` tool and `[emotion]` tags, 5 or 6 values | No such tool. Looks are per character (`[outfit-]mood`, 50 to 84 each in the imported world) with outfits and face descriptions; the speaker picks a mood on the bubble (§6.3). |
| "Mask vs. motive" subtext under each line                                      | Monologues exist only on task transitions and are observer data. Showing minds goes through the lens layer, later.                                                              |
| A `visual:` block in `IDENTITY.md`                                             | `IDENTITY.md` is injected into every turn's system prompt. Art is files by convention in the workspace, like `avatar.*` and `stickers/`.                                        |
| Assets under `public/characters/<id>/` in the Next app                         | Art belongs to the world and is served by plugin routes through the proxy (D2). The app ships no world content (D1).                                                            |
| Backgrounds are `stage_backgrounds: { day, sunset, night }` URLs per place     | A place names a shared set; the set's files are named by state and time; code picks (§8.2).                                                                                     |
| "Zero-SQLite, file-first"                                                      | Machine state is in SQLite-backed keyed stores and Kazusa's own message database. Only qualitative content is Markdown.                                                         |
| Transport is "SSE / WebSocket / cached poll"                                   | One SSE stream per tab, `GET /kazusa/events`; no WebSocket from the browser.                                                                                                    |
| A new Zustand "Stage Director" store with its own roster, history and locks    | A Zustand store, yes (§5.2), holding only layout and lines. Roster, history and typing already live in existing stores and SWR caches.                                          |
| Phase 2 is PixiJS with Spine and Live2D; phase 3 is React Three Fiber          | Not scheduled. DOM covers static pictures. A canvas arrives with rigs or models (§9), and Spine and Live2D have licence terms to check first.                                   |
| A scroll lock and "Reading history" banner                                     | The transcript toggle is the backlog; the scene itself has no scrollback to lock.                                                                                               |
