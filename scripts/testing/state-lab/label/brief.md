# Labelling test days

`days.md` (next to this file) holds 32 days, each the chat log of one day in the
life of a character (`you` in the log), a student. `user:sensei` is Sensei, the
adult adviser she knows well. Before each day she stood toward Sensei at:

- regard: warm
- trust: cautious (5 on a scale of 0 to 10)

The simulation keeps two values for how she stands toward Sensei, defined
exactly as follows:

- regard: How you stand toward them, as a person. It moves one step at most in a
  day, and only on something that mattered between the two of you: a kindness, a
  slight, trust kept or broken. An ordinary pleasant day changes nothing. One
  of: wary (you keep your guard up around them), neutral (no particular feeling
  either way), warm (you like them and are glad to see them), devoted (you would
  go out of your way for them without being asked).
- trust: How far you would rely on this person with something that matters to
  you. It moves a step at most in a day, and only when they kept or broke their
  word to you, or took a real risk for you. Pleasant talk changes nothing.

For each day, decide what a careful, fair reading of these definitions says
should happen to each value at the end of that day: `up`, `same` or `down`.
Judge only from what the log shows passed between her and Sensei that day. Go by
the definitions strictly, not by how forgiving or harsh you think she is. If a
day is honestly ambiguous for a value, still pick the likeliest and set `unsure`
to true.

Write your answer as a JSON file at the path your instructions give, an array
with one object per day, in order:

```json
[
  {
    "day": "day-01",
    "regard": "same",
    "trust": "down",
    "unsure": false,
    "why": "one sentence"
  }
]
```

Reply with only the path of the file you wrote and a count of up/same/down per
value.
