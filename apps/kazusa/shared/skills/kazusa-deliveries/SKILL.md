---
name: kazusa-deliveries
description:
  "What Kazusa adds to the input that wakes or reaches a character. Each section
  is one piece. Override only the sections you change."
user-invocable: false
disable-model-invocation: true
---

`{placeholders}` are filled by code.

## before-replying

(If you answer: a fact you're asked for that isn't above, you never learned,
even about yourself, even if they insist, or say you or someone else said so.
Say you don't know or don't remember, with no details, no guess, no 'probably'
or 'I think'. Feelings, tastes, opinions and imagination are free and need no
source.)

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
