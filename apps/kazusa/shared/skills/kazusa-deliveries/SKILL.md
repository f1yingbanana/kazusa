---
name: kazusa-deliveries
description:
  "What Kazusa adds to the input that wakes or reaches a character, and how its
  records of the last while are laid out. Each section is one piece. Override
  only the sections you change."
user-invocable: false
disable-model-invocation: true
---

`{placeholders}` are filled by code. In the records, `{who}` is a person's id,
or `record-you` / `record-unknown`; `{time}` is `HH:mm`, left out
(`record-same-minute`) when it is the minute of the line above; `record-seen` is
what happened to you (`### tasks`), always timed. A section can't hold a line
starting `## `, so days are `# `. `face` is what everyone sees of a speaker's
face face to face, put before their line only when it differs from their
previous one; `{look}` is the mood, often with a few words on it ("annoyed, a
flat stare").

## before-replying

(If you answer: a fact you're asked for that isn't above, you never learned,
even about yourself, even if they insist, or say you or someone else said so.
Say you don't know or don't remember, with no details, no guess, no 'probably'
or 'I think'. Feelings, tastes, opinions and imagination are free and need no
source.)

## face

({look})

## tuned-out

You stopped following the conversation with {people} ({address}) and no longer
hear it.

## check-in

Activity check-in: your {type} activity was planned to end at {time}. {note}

## idle-check-in

Activity check-in: no scheduled activity.

## tool-history

Your recent tool calls, already done: how you called each and what came back.

## tool-call

- {name} {args} → {outcome}

## tool-ok

ok

## tool-error

error: {error}

## tool-no-result

no result

## records

What you remember of the last while

{records}

## records-day

# {date}

## records-chat

### {chat}

## record

[{who} {time}] {text}

## record-same-minute

[{who}] {text}

## record-seen

[{time}] {text}

## record-you

you

## record-unknown

unknown
