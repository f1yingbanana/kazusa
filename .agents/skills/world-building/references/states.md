# Defining states

Read this before you add or change a state in `shared/stats.json`. What a state
is for, setting a value and outfits are in `SKILL.md` (States).

The file is a JSON array:

```json
[
  {
    "name": "money",
    "description": "What you have on you to spend. A meal costs about 1 and a nice gift about 6. It changes only when you actually pay for something or are given money.",
    "on": "character",
    "kind": "number",
    "min": 0,
    "max": 50,
    "initial": 20,
    "changedBy": "character",
    "shown": "self"
  },
  {
    "name": "warmth",
    "description": "How warmly you regard this person. It moves only on something that mattered between the two of you: a kindness, a slight. An ordinary pleasant day changes nothing.",
    "on": "pair",
    "kind": "number",
    "min": 0,
    "max": 23,
    "initial": 10,
    "bands": [
      {
        "name": "cold",
        "min": 0,
        "description": "You would rather avoid them"
      },
      { "name": "friendly", "min": 8, "description": "Glad to see them" },
      {
        "name": "close",
        "min": 16,
        "description": "You trust them and seek them out"
      }
    ],
    "changedBy": "reviewed",
    "shown": "self"
  }
]
```

The first is a fact, the second a meter.

- **`name`** is lowercase words joined by `_`, unique. `outfit` is taken (a
  built-in state: see Outfit in `SKILL.md`).
- **`description`** is the one thing a character is told about it, so write it
  to them. Say what moves it, by what happens: "only when they kept or broke
  their word to you". Give a fact its prices ("a meal costs about 1"). Do not
  say how far it moves ("a step at most in a day"): code holds to that. Each
  value of a choice can have its own.
- **`on`**: `character` (each has their own), `pair` (one person's value toward
  each other person, private to them), `world` (one for everyone) or `player`
  (only the human player has it, and sets it themselves; characters with the
  player read it).
- **`kind`**: `choice` with at least two `values` and an `initial` among them,
  or `number` with `min`, `max` and `initial`. Optional `bands` name ranges of a
  number, lowest first, each with an optional `description` of what standing
  there means. With bands a character reads the word, never the number, and
  moves it one `step` (1 unless you set it) up or down instead of choosing a
  number. Without bands they read and give the number itself, which suits a fact
  they count (money, health).
- **How fast a meter moves is how far apart you put its bands.** One thing that
  mattered moves it one step, so the steps between two bands are how many such
  things it takes to change the word. Put them about 8 apart, as above. Measured
  on written days: 3 apart, a fortnight where nothing happened moved a whole
  band; 8 apart it held, and a kept or a broken promise still moved it nearly
  every time. Never make a meter a `choice`: a character takes a whole word for
  too big a step, and it hardly moves either way.
- **`changedBy`**: `character` (they change it themselves as they act: a fact
  they handle, like money or what they wear), `reviewed` (their night's sleep
  looks back on the day and moves it one step if something that mattered
  happened: a meter) or `manual` (only you and the user: a chapter, a rank). A
  `world` or `player` state is `manual`; a `pair` state is `reviewed` or
  `manual`.
- **`shown`**: `self` (they read it; not for a `player` state), `everyone`
  (people with them see it too; not for a `pair`) or `nobody` (kept for the user
  and for you).
- A band's or a value's `name` is one line without a colon. The first band
  starts at `min` or below and none starts above `max`, so every value has a
  word.
- **Keep it small.** A character reads every state each turn and weighs each one
  they can change, so about 8 that reach characters is plenty. One meter toward
  someone is enough: two fed by the same events (liking and trust) move together
  however you word them. A sheet of numbers nobody acts on (strength, level)
  costs nothing as `manual` and `nobody`.
- A file that isn't valid reads as no states at all. Check your JSON, then set
  one value with `set_state`: it refuses a state that isn't defined. Removing a
  definition keeps its values; they return if it comes back.

## Working with meters

Three things a meter will not do by itself:

- **Start right.** Everyone starts at `initial` toward everyone. Where two
  people already have a history (old friends, rivals), set that pair when you
  make them, or the state says "no particular feeling" about someone their own
  page calls a best friend.
- **Change behaviour when you set it.** If you move a meter by hand, rewrite
  their page on that person to match
  (`workspaces/<id>/wiki/entities/characters/`), or nothing they do will follow.
  The other way round is fine: change the page and let their nights move the
  meter.
- **Make something happen at a level.** When the story should turn on a state (a
  scene that opens once they are close, a secret told once trust is high), read
  the state yourself and make it happen: set the scene, send the message, write
  it into their memory. Do not wait for the character to act the number.
