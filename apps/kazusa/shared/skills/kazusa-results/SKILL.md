---
name: kazusa-results
description:
  "What a character is told when a tool call is refused, and what an activity
  change says (its record and its result). Each section is one result. Override
  only the sections you change."
user-invocable: false
disable-model-invocation: true
---

Facts only: what to do about them is the other skills' to say. `{placeholders}`
are filled by code. `{until}` is a sim time; `{notes}` is what Location adds
(where it happens, the way there), each starting with a space.

## lookup-limit

That's all you can find right now.

## second-activity

You chose your activity moments ago, so this did not run. You can change it in a
couple of minutes.

## out-of-time

You are out of time for this reaction, so this did not run. You can still speak.

## hard-limit

This reaction is over, so this did not run.

## aloud-on-the-way

You're on your way, so nobody is close enough to hear.

## aloud-not-here

{who} isn't here, so they can't hear you.

## aloud-not-there

You aren't there, so nobody in it can hear you.

## aloud-apart

{who} are in different conversations, so this did not run.

## aloud-self

You are already in your own conversation, so this did not run.

## conversation-over

That conversation is over, so this did not run.

## conversation-leave-only

A conversation in person can only be left, so this did not run.

## chat-not-joinable

That chat isn't open to join, so this did not run.

## outside-repository

{path} is outside the Kazusa repository, so this did not run.

## secret-file

{path} holds secrets, so this did not run.

## task-started

Started {type}: "{description}".{notes} Until {until} ({minutes} min).

## state-changed

Your {name} is now {value}.

## state-unchanged

Your {name} already is {value}.

## state-not-yours

{name} is not something you can change yourself.

## night-dreamt

You dreamt: {dream}

## night-slept

You slept on it.

## looked-back

You looked back on the last hours.

## reflect-awake

You only go over things like this as you fall asleep for the night.

## reflect-unread

Nothing changed yet. This is how you see {name} now:

{view}

A new view replaces it whole.

## reflect-kept

Kept, about {name}.

## reflect-self

Kept.

## reflect-states

Now {states}.

## reflect-states-left

Left as they were: {states}.

## reflect-no-day

The day needs a `view`: how it was, in a few sentences.

## reflect-day

The day is kept.

## page-unknown

Nothing kept yet. You have no page called {name}. These are the closest you
have:

{pages}

If it is one of them, say it again about that one, by the id in backticks. If it
is none of them, say it again with `new`: true.

## task-finished

Finished {type}. {started}

## task-stopped

Stopped {type}: "{description}".

## task-finished-summary

Finished {type}: "{summary}". {started}

## task-delayed

Extended: {minutes} more min, until {until}.{notes}

## task-delayed-reason

Extended: {minutes} more min, until {until}. Reason: {reason}{notes}

## task-no-estimate

Not extended: it needs `minutesLeft`, how many more minutes from now.

## where-which

More than one place you know could be "{where}": {places}. Say which one.
