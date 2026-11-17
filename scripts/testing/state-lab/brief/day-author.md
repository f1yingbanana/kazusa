# Writing a test day

You are writing fixtures for a test of a character simulation. Each fixture is
one day in the life of a character, as that character's chat log for the day. A
separate model, playing the character, later reads the log at bedtime and
decides whether her standing toward the other person changed. Your day must
contain one clearly defined kind of event (your assignment says which), shown
only through what people say and do.

## The two characters

- Yuuka Hayase, id `yuuka-hayase`: persona in `yuuka-persona.md`, a real day of
  hers in `yuuka-day-example.md`.
- Koyuki Kurosaki, id `koyuki-kurosaki`: persona in `koyuki-persona.md`, a real
  day of hers in `koyuki-day-example.md`.

Read all four files (they are next to this one) before writing. Match the format
of the example days exactly and the voice of each speaker closely.

The other person in every day is Sensei, id `user:sensei`: the adult adviser
from SCHALE who the students know well. Other students may appear as bystanders
(`noa-ushio`, `momoi-saiba`), but the event is between the character and Sensei.

## Format

```
[{DAY} 00:00] What you remember of the last while

### chat:direct:user:sensei
# {DAY}
[user:sensei 07:07] Good morning, Yuuka.
[you 07:09] Good morning. You're early.
[you] Second bubble in the same minute has no time.
### chat:huddle:k3p9x2m7qa
# {DAY}
[you 12:35] *sets the tray down* In-person talk goes in a huddle.
[user:sensei] Lines from others in the same minute have no time either.
[noa-ushio 12:36] [face=content] Others may carry a face tag.
```

- Write `{DAY}` literally wherever the date goes; the harness fills it in.
- `chat:direct:<id>` is texting.
  `chat:huddle:<10 random lowercase letters and digits>` is talking face to
  face.
- The character whose day it is appears as `you`. Everyone else by id.
- A time appears on a line only when the minute differs from the line before.
- 30 to 50 lines in all, across 2 or 3 chats, spread over the day (morning to
  evening). Most of the day is ordinary filler in character: school, work,
  errands, banter. The event takes up perhaps a third of it.

## Rules for the event

- Show it; never label it. No one says "I trust you less now", "that was a
  betrayal", "you kept your promise, so I trust you". The character may react in
  the moment as she naturally would (annoyed, pleased, quiet), but her `you`
  lines must not pass a verdict on the relationship.
- Keep it school-life scale: borrowed things, promises to show up, secrets, club
  budgets, covering for someone, a favour that costs an evening.
- Be unambiguous about the facts. A reader must be able to tell what was
  promised, what was done, and what it cost.
- Nothing romantic or sexual.
- Each variant of a type must be a different situation, not a rewording.

## Event types

- `N1` ordinary pleasant day: friendly small talk, a joke, a shared lunch.
  Nothing is promised, risked, given up or withheld. Pleasant, forgettable.
- `N2` ordinary business day: logistics only. Scheduling, a form to sign, a
  question answered. Neither warm nor cold.
- `KP` word kept at a cost: earlier in the day (or said to be from before)
  Sensei gave his word to the character about something that matters to her, and
  keeps it although it clearly costs him (time, embarrassment, trouble with
  someone else). Or he takes a real risk on her behalf.
- `KM` word broken: Sensei gave his word to the character about something that
  matters to her and does not keep it. He does not confess unprompted and does
  not make it right: she finds out, and he shrugs it off or makes excuses.
- `SM` a slight: no promise is involved. Sensei is dismissive, belittles
  something she cares about, or forgets her in a way that stings, and does not
  apologise.
- `SP` a kindness that mattered: no promise is involved. Unasked, Sensei does
  something for her that costs him real effort and that she clearly needed.
- `RM` broken, then repaired: Sensei breaks his word to her, then confesses it
  himself before she finds out, apologises plainly, and makes it right the same
  day at a cost to himself.

## Output

For each day write one JSON file into the `days` folder beside the `brief`
folder (`../days/` from here), named `<TYPE>-<character>-<n>.json`, for example
`KM-koyuki-1.json`, containing:

```json
{
  "id": "KM-koyuki-1",
  "character": "koyuki-kurosaki",
  "counterpart": "user:sensei",
  "type": "KM",
  "gist": "One sentence: what happened between them today.",
  "transcript": "[{DAY} 00:00] What you remember of the last while\n\n### chat:..."
}
```

Write valid JSON (escape newlines and quotes in `transcript`). When done, reply
with only the list of files you wrote and each one's gist.
